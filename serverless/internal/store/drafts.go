package store

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// A draft is a DRAFT#<id> item in the user's partition, with an expiresAt that is the table's
// TTL attribute: the Quarkus backend's draft sweep becomes DynamoDB deleting it. TTL takes up to
// about two days, so a draft past its expiry is gone to every read and write here, not only once
// deleted.
//
// The limit (board.MaxOpenDrafts) is kept on the user's META item as openDrafts, each open draft's
// id with its expiry, and a draftsVersion that every change to it counts up. Starting a draft
// writes both in one transaction, on the condition that the version is still the one its count
// was read with, so two drafts started at once cannot both take the last place. A draft that
// expires leaves the map on its own, by its expiry, so nothing has to count it down when TTL
// deletes it.
const (
	openDrafts    = "openDrafts"
	draftsVersion = "draftsVersion"
	// draftAttempts bounds how often a draft write is tried again after losing a race.
	draftAttempts = 16
)

// draftItem is a draft as stored: no description or due date until it is added.
type draftItem struct {
	ID        int64 `dynamodbav:"id"`
	ExpiresAt int64 `dynamodbav:"expiresAt"`
}

// draftKey is the key of the user's draft with this id.
func draftKey(email string, id int64) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: OwnerKey(email)},
		"SK": &types.AttributeValueMemberS{Value: fmt.Sprintf("DRAFT#%08d", id)},
	}
}

// StartDraft starts a draft for the user and returns its id, the next on their count; started is
// false, and nothing written, when they have board.MaxOpenDrafts open already.
func (w *Writes) StartDraft(ctx context.Context, email string, now time.Time) (id int64, started bool, err error) {
	for range draftAttempts {
		open, version, err := w.openDraftsOf(ctx, email)
		if err != nil {
			return 0, false, err
		}
		live := map[string]int64{}
		for draft, expires := range open {
			if expires > now.Unix() {
				live[draft] = expires
			}
		}
		if len(live) >= board.MaxOpenDrafts {
			return 0, false, nil
		}
		// Counted once, after the limit is known to leave room: a retry keeps the id.
		if id == 0 {
			if id, err = w.nextID(ctx, email); err != nil {
				return 0, false, err
			}
		}
		expires := now.Add(board.DraftLifetime).Unix()
		live[strconv.FormatInt(id, 10)] = expires
		reasons, err := w.transact(ctx, w.recount(email, live, version), w.putDraft(email, id, expires))
		if err != nil {
			return 0, false, err
		}
		switch {
		case reasons == nil:
			return id, true, nil
		case failed(reasons, 1):
			// Taken by an item written around the count: the next id, as a create steps over it.
			slog.WarnContext(ctx, "a draft id was taken without being counted", "draft", id)
			id = 0
		}
		// Otherwise another write changed the drafts meanwhile: count again.
		pause()
	}
	return 0, false, errors.New("start a draft: lost every race for the count")
}

// AddDraft makes the user's draft t.ID the task t, with the draft's id. Adding it again, as a
// retry whose answer was lost does (#427), sets t's values on the task it became, its due time
// and zone too, which a create always sends. found is false when the user has neither a draft
// nor a task with this id, and nothing is written.
func (w *Writes) AddDraft(ctx context.Context, email string, t board.Task, now time.Time) (board.Task, bool, error) {
	item, err := attributevalue.MarshalMap(taskItemOf(t))
	if err != nil {
		return board.Task{}, false, fmt.Errorf("write the task: %w", err)
	}
	for k, v := range taskKey(email, t.ID) {
		item[k] = v
	}
	put := types.TransactWriteItem{Put: &types.Put{
		TableName: aws.String(w.table), Item: item,
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	}}
	for range draftAttempts {
		reasons, err := w.transact(ctx, w.takeDraft(email, t.ID, now), put, w.forget(email, t.ID))
		if err != nil {
			return board.Task{}, false, err
		}
		if reasons == nil {
			return t, true, nil
		}
		if failed(reasons, 0) || failed(reasons, 1) {
			// No open draft: a task with this id, if the user has one, takes the values.
			return w.Replace(ctx, email, t, false)
		}
		pause()
	}
	return board.Task{}, false, errors.New("add a draft: lost every race for the count")
}

// DiscardDraft deletes the user's open draft with this id; found is false when they have none,
// for a task with this id too, which stays.
func (w *Writes) DiscardDraft(ctx context.Context, email string, id int64, now time.Time) (bool, error) {
	for range draftAttempts {
		reasons, err := w.transact(ctx, w.takeDraft(email, id, now), w.forget(email, id))
		if err != nil {
			return false, err
		}
		if reasons == nil {
			return true, nil
		}
		if failed(reasons, 0) {
			return false, nil
		}
		pause()
	}
	return false, errors.New("discard a draft: lost every race for the count")
}

// openDraftsOf reads the user's open drafts and the version they were read at: nil before the
// user's first draft.
func (w *Writes) openDraftsOf(ctx context.Context, email string) (map[string]int64, *int64, error) {
	out, err := w.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(w.table), Key: metaKey(email), ConsistentRead: aws.Bool(true),
		ProjectionExpression:     aws.String("#open, #version"),
		ExpressionAttributeNames: map[string]string{"#open": openDrafts, "#version": draftsVersion},
	})
	if err != nil {
		return nil, nil, fmt.Errorf("count the drafts: %w", err)
	}
	var meta struct {
		Open    map[string]int64 `dynamodbav:"openDrafts"`
		Version *int64           `dynamodbav:"draftsVersion"`
	}
	if err := attributevalue.UnmarshalMap(out.Item, &meta); err != nil {
		return nil, nil, fmt.Errorf("count the drafts: %w", err)
	}
	return meta.Open, meta.Version, nil
}

// recount sets the user's open drafts to open, on the condition that they are still at version.
func (w *Writes) recount(email string, open map[string]int64, version *int64) types.TransactWriteItem {
	drafts, _ := attributevalue.Marshal(open) // a map of strings to numbers always marshals
	condition, next := "attribute_not_exists(#version)", int64(1)
	values := map[string]types.AttributeValue{":open": drafts}
	if version != nil {
		condition, next = "#version = :version", *version+1
		values[":version"] = &types.AttributeValueMemberN{Value: strconv.FormatInt(*version, 10)}
	}
	values[":next"] = &types.AttributeValueMemberN{Value: strconv.FormatInt(next, 10)}
	return types.TransactWriteItem{Update: &types.Update{
		TableName: aws.String(w.table), Key: metaKey(email),
		UpdateExpression:          aws.String("SET #open = :open, #version = :next"),
		ConditionExpression:       aws.String(condition),
		ExpressionAttributeNames:  map[string]string{"#open": openDrafts, "#version": draftsVersion},
		ExpressionAttributeValues: values,
	}}
}

// putDraft writes a new draft, on the condition that its id is free.
func (w *Writes) putDraft(email string, id, expires int64) types.TransactWriteItem {
	item, _ := attributevalue.MarshalMap(draftItem{ID: id, ExpiresAt: expires}) // two numbers always marshal
	for k, v := range draftKey(email, id) {
		item[k] = v
	}
	return types.TransactWriteItem{Put: &types.Put{
		TableName: aws.String(w.table), Item: item,
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	}}
}

// takeDraft deletes the user's draft, on the condition that it is there and open at now.
func (w *Writes) takeDraft(email string, id int64, now time.Time) types.TransactWriteItem {
	return types.TransactWriteItem{Delete: &types.Delete{
		TableName: aws.String(w.table), Key: draftKey(email, id),
		ConditionExpression: aws.String("attribute_exists(PK) AND expiresAt > :now"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":now": &types.AttributeValueMemberN{Value: strconv.FormatInt(now.Unix(), 10)},
		},
	}}
}

// forget takes a draft off the user's open drafts and counts their version up, so that a start
// that read them before cannot write back what it read.
func (w *Writes) forget(email string, id int64) types.TransactWriteItem {
	return types.TransactWriteItem{Update: &types.Update{
		TableName: aws.String(w.table), Key: metaKey(email),
		UpdateExpression: aws.String("REMOVE #open.#id ADD #version :one"),
		ExpressionAttributeNames: map[string]string{
			"#open": openDrafts, "#id": strconv.FormatInt(id, 10), "#version": draftsVersion,
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{":one": &types.AttributeValueMemberN{Value: "1"}},
	}}
}

// transact writes the items in one transaction. A transaction that was cancelled, by a condition or
// by another write to the same items, answers why, item by item, and no error.
func (w *Writes) transact(ctx context.Context, items ...types.TransactWriteItem) ([]types.CancellationReason, error) {
	_, err := w.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: items})
	var cancelled *types.TransactionCanceledException
	if errors.As(err, &cancelled) {
		return cancelled.CancellationReasons, nil
	}
	if err != nil {
		return nil, fmt.Errorf("write the draft: %w", err)
	}
	return nil, nil
}

// failed says whether the transaction's item i failed its condition.
func failed(reasons []types.CancellationReason, i int) bool {
	return i < len(reasons) && aws.ToString(reasons[i].Code) == "ConditionalCheckFailed"
}

// pause waits a few random milliseconds before a retry, so that requests that collided do not
// collide again in step.
func pause() {
	time.Sleep(time.Duration(5+rand.IntN(20)) * time.Millisecond)
}
