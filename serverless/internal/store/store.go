// Package store reads the board from DynamoDB: one table, the user as the partition, the kind of
// item in the sort key (doc/deployment/serverless.md). The spike reads tasks only.
package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// QueryAPI is the one DynamoDB call the store makes, so that tests can answer it.
type QueryAPI interface {
	Query(ctx context.Context, in *dynamodb.QueryInput, opts ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
}

// Store is a user's tasks in one DynamoDB table.
type Store struct {
	client QueryAPI
	table  string
}

// New returns a store on the named table.
func New(client QueryAPI, table string) *Store {
	return &Store{client: client, table: table}
}

// OwnerKey is the partition key of a user's items: a hash of the email that identifies them, so
// that the table's keys, which show up in logs and metrics, carry no address.
func OwnerKey(email string) string {
	sum := sha256.Sum256([]byte(email))
	return "USER#" + hex.EncodeToString(sum[:])
}

// taskItem is a task as stored.
type taskItem struct {
	ID          int64   `dynamodbav:"id"`
	Description string  `dynamodbav:"description"`
	DueDate     string  `dynamodbav:"dueDate"`
	DueTime     *string `dynamodbav:"dueTime,omitempty"`
	TimeZone    *string `dynamodbav:"timeZone,omitempty"`
	Importance  string  `dynamodbav:"importance"`
	State       string  `dynamodbav:"state"`
	CreatedAt   string  `dynamodbav:"createdAt"`
}

// Tasks returns every task of the user with this email, unordered: one Query on their partition,
// page after page.
func (s *Store) Tasks(ctx context.Context, email string) ([]board.Task, error) {
	in := &dynamodb.QueryInput{
		TableName:              aws.String(s.table),
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :task)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":   &types.AttributeValueMemberS{Value: OwnerKey(email)},
			":task": &types.AttributeValueMemberS{Value: "TASK#"},
		},
	}
	var tasks []board.Task
	for {
		out, err := s.client.Query(ctx, in)
		if err != nil {
			return nil, fmt.Errorf("query tasks: %w", err)
		}
		var items []taskItem
		if err := attributevalue.UnmarshalListOfMaps(out.Items, &items); err != nil {
			return nil, fmt.Errorf("read tasks: %w", err)
		}
		for _, it := range items {
			created, _ := time.Parse(time.RFC3339, it.CreatedAt)
			tasks = append(tasks, board.Task{
				ID: it.ID, Description: it.Description, DueDate: it.DueDate,
				DueTime: it.DueTime, TimeZone: it.TimeZone,
				Importance: board.Importance(it.Importance), State: board.State(it.State),
				CreatedAt: created,
			})
		}
		if len(out.LastEvaluatedKey) == 0 {
			return tasks, nil
		}
		in.ExclusiveStartKey = out.LastEvaluatedKey
	}
}
