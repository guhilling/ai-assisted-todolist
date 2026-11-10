package store

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// Writes changes a user's tasks in the table: create, replace and delete (#550). Each is
// conditional on the item, so a task that is not the caller's, or not there, is not found rather
// than written, and every write stays in the caller's own partition.
type Writes struct {
	client ItemAPI
	table  string
}

// NewWrites returns the writes on the named table.
func NewWrites(client ItemAPI, table string) *Writes {
	return &Writes{client: client, table: table}
}

// lastTaskID is the attribute of the user's META item that counts the ids given so far. Drafts
// will take theirs from it too (#551), since a draft keeps its id when it is added.
const lastTaskID = "lastTaskId"

func taskKey(email string, id int64) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: OwnerKey(email)},
		"SK": &types.AttributeValueMemberS{Value: fmt.Sprintf("TASK#%08d", id)},
	}
}

func notThere(err error) bool {
	var failed *types.ConditionalCheckFailedException
	return errors.As(err, &failed)
}

// collisionsBeforeGivingUp bounds how many ids a create steps over that are taken by tasks
// written around the count (spike/measure.sh seeds some); normally there are none.
const collisionsBeforeGivingUp = 32

// Create stores a new task for the user, with the next id their META item gives. The two are
// separate writes rather than one transaction: the count goes up first and atomically, so an id
// is never given twice, and a create that fails after it only leaves a gap, which nothing minds.
// A deleted task's id is not given again either. An id already taken by a task written around
// the count is stepped over.
func (w *Writes) Create(ctx context.Context, email string, t board.Task) (board.Task, error) {
	for range collisionsBeforeGivingUp {
		id, err := w.nextID(ctx, email)
		if err != nil {
			return board.Task{}, err
		}
		t.ID = id
		item, err := attributevalue.MarshalMap(taskItemOf(t))
		if err != nil {
			return board.Task{}, fmt.Errorf("write the task: %w", err)
		}
		for k, v := range taskKey(email, t.ID) {
			item[k] = v
		}
		_, err = w.client.PutItem(ctx, &dynamodb.PutItemInput{
			TableName: aws.String(w.table), Item: item,
			ConditionExpression: aws.String("attribute_not_exists(PK)"),
		})
		if notThere(err) {
			slog.WarnContext(ctx, "a task id was taken without being counted", "task", t.ID)
			continue
		}
		if err != nil {
			return board.Task{}, fmt.Errorf("write the task: %w", err)
		}
		return t, nil
	}
	return board.Task{}, errors.New("write the task: every id tried was taken")
}

// nextID counts the user's next task id on their META item.
func (w *Writes) nextID(ctx context.Context, email string) (int64, error) {
	out, err := w.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(w.table),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: OwnerKey(email)},
			"SK": &types.AttributeValueMemberS{Value: "META"},
		},
		UpdateExpression:          aws.String("ADD #last :one"),
		ExpressionAttributeNames:  map[string]string{"#last": lastTaskID},
		ExpressionAttributeValues: map[string]types.AttributeValue{":one": &types.AttributeValueMemberN{Value: "1"}},
		ReturnValues:              types.ReturnValueUpdatedNew,
	})
	if err != nil {
		return 0, fmt.Errorf("count the task: %w", err)
	}
	n, ok := out.Attributes[lastTaskID].(*types.AttributeValueMemberN)
	if !ok {
		return 0, errors.New("count the task: no count came back")
	}
	id, err := strconv.ParseInt(n.Value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("count the task: %w", err)
	}
	return id, nil
}

// Replace sets every field of the user's task t.ID to t's, but for the due time and zone when
// keepTime is set (#497): then the stored ones stay. found is false when the user has no such
// task, and nothing is written.
func (w *Writes) Replace(ctx context.Context, email string, t board.Task, keepTime bool) (board.Task, bool, error) {
	set := "SET #description = :d, #dueDate = :dd, #importance = :i, #state = :s"
	// Every name through a placeholder: DynamoDB reserves several, state and timeZone among them.
	names := map[string]string{"#description": "description", "#dueDate": "dueDate",
		"#importance": "importance", "#state": "state"}
	values := map[string]types.AttributeValue{
		":d":  &types.AttributeValueMemberS{Value: t.Description},
		":dd": &types.AttributeValueMemberS{Value: t.DueDate},
		":i":  &types.AttributeValueMemberS{Value: string(t.Importance)},
		":s":  &types.AttributeValueMemberS{Value: string(t.State)},
	}
	var remove []string
	field := func(name string, v *string) {
		names["#"+name] = name
		if v == nil {
			remove = append(remove, "#"+name)
			return
		}
		set += ", #" + name + " = :" + name
		values[":"+name] = &types.AttributeValueMemberS{Value: *v}
	}
	if !keepTime {
		field("dueTime", t.DueTime)
		field("timeZone", t.TimeZone)
	}
	expr := set
	if len(remove) > 0 {
		expr += " REMOVE " + strings.Join(remove, ", ")
	}
	out, err := w.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(w.table),
		Key:                       taskKey(email, t.ID),
		UpdateExpression:          aws.String(expr),
		ConditionExpression:       aws.String("attribute_exists(PK)"),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
		ReturnValues:              types.ReturnValueAllNew,
	})
	if notThere(err) {
		return board.Task{}, false, nil
	}
	if err != nil {
		return board.Task{}, false, fmt.Errorf("replace the task: %w", err)
	}
	var stored taskItem
	if err := attributevalue.UnmarshalMap(out.Attributes, &stored); err != nil {
		return board.Task{}, false, fmt.Errorf("read the replaced task: %w", err)
	}
	return stored.task(), true, nil
}

// Delete deletes the user's task with this id; found is false when they have none.
func (w *Writes) Delete(ctx context.Context, email string, id int64) (bool, error) {
	_, err := w.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName:           aws.String(w.table),
		Key:                 taskKey(email, id),
		ConditionExpression: aws.String("attribute_exists(PK)"),
	})
	if notThere(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("delete the task: %w", err)
	}
	return true, nil
}
