package store

import (
	"context"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// fakeQuery answers Query from pages prepared by the test, and records what it was asked.
type fakeQuery struct {
	pages []*dynamodb.QueryOutput
	asked []*dynamodb.QueryInput
}

func (f *fakeQuery) Query(_ context.Context, in *dynamodb.QueryInput, _ ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error) {
	f.asked = append(f.asked, in)
	page := f.pages[0]
	f.pages = f.pages[1:]
	return page, nil
}

func item(id, due string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK":          &types.AttributeValueMemberS{Value: "USER#x"},
		"SK":          &types.AttributeValueMemberS{Value: "TASK#" + id},
		"id":          &types.AttributeValueMemberN{Value: id},
		"description": &types.AttributeValueMemberS{Value: "Renew the passport"},
		"dueDate":     &types.AttributeValueMemberS{Value: due},
		"importance":  &types.AttributeValueMemberS{Value: "HIGH"},
		"state":       &types.AttributeValueMemberS{Value: "TODO"},
		"createdAt":   &types.AttributeValueMemberS{Value: "2026-11-09T20:00:00Z"},
	}
}

func TestOwnerKeyIsAHashOfTheEmailNotTheEmail(t *testing.T) {
	key := OwnerKey("taskfest-test-one@example.com")

	if want := "USER#"; key[:len(want)] != want || len(key) != len(want)+64 {
		t.Errorf("got %q, want USER# and 64 hex digits", key)
	}
	if OwnerKey("taskfest-test-one@example.com") != key {
		t.Error("the key is not stable")
	}
}

func TestTasksQueriesTheOwnersPartitionAndFollowsPages(t *testing.T) {
	fake := &fakeQuery{pages: []*dynamodb.QueryOutput{
		{Items: []map[string]types.AttributeValue{item("1", "2026-11-30")},
			LastEvaluatedKey: map[string]types.AttributeValue{"PK": &types.AttributeValueMemberS{Value: "next"}}},
		{Items: []map[string]types.AttributeValue{item("2", "2026-12-01")}},
	}}
	s := New(fake, "taskfest-qa-spike")

	tasks, err := s.Tasks(context.Background(), "taskfest-test-one@example.com")

	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 2 || tasks[0].ID != 1 || tasks[1].ID != 2 || tasks[0].Description != "Renew the passport" {
		t.Fatalf("got %+v", tasks)
	}
	first := fake.asked[0]
	if aws.ToString(first.TableName) != "taskfest-qa-spike" {
		t.Errorf("table %q", aws.ToString(first.TableName))
	}
	pk := first.ExpressionAttributeValues[":pk"].(*types.AttributeValueMemberS).Value
	if pk != OwnerKey("taskfest-test-one@example.com") {
		t.Errorf("partition %q", pk)
	}
	if fake.asked[1].ExclusiveStartKey == nil {
		t.Error("the second page did not start where the first ended")
	}
}
