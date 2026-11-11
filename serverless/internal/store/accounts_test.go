package store

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// partition is every item under the user's partition key.
func partition(t *testing.T, client *dynamodb.Client, table, email string) []map[string]types.AttributeValue {
	t.Helper()
	out, err := client.Query(context.Background(), &dynamodb.QueryInput{
		TableName: aws.String(table), ConsistentRead: aws.Bool(true),
		KeyConditionExpression:    aws.String("PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":pk": &types.AttributeValueMemberS{Value: OwnerKey(email)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return out.Items
}

// signIn stores a session for email, as the website's sign-in does.
func signIn(t *testing.T, s *Sessions, key, email string) {
	t.Helper()
	now := time.Now()
	err := s.PutSession(context.Background(), key, auth.Session{
		Identity: identity.Identity{Email: email, Provider: "google"}, Created: now, LastSeen: now,
	}, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
}

func TestDeletingAnAccountRemovesEverythingItHoldsAndEndsItsSessions(t *testing.T) {
	client, table := localTable(t)
	ctx := context.Background()
	me, them := "taskfest-test-one@example.com", "taskfest-test-two@example.com"
	// More than one page of deletes: DynamoDB writes at most 25 items in one batch.
	for i := 1; i <= 30; i++ {
		put(t, client, table, map[string]any{"PK": OwnerKey(me), "SK": fmt.Sprintf("TASK#%08d", i), "id": i,
			"description": "Mine", "dueDate": "2026-11-30", "importance": "HIGH", "state": "TODO"})
	}
	put(t, client, table, map[string]any{"PK": OwnerKey(me), "SK": "META", "lastTaskId": 31})
	put(t, client, table, map[string]any{"PK": OwnerKey(me), "SK": "DRAFT#00000031", "id": 31})
	put(t, client, table, map[string]any{"PK": OwnerKey(me), "SK": "ATT#00000001", "id": 1, "objectKey": "k"})
	put(t, client, table, map[string]any{"PK": OwnerKey(them), "SK": "TASK#00000001", "id": 1})
	sessions := NewSessions(client, table)
	signIn(t, sessions, "phone", me)
	signIn(t, sessions, "laptop", me)
	signIn(t, sessions, "theirs", them)
	accounts := NewAccounts(client, table)

	if err := accounts.Mark(ctx, me); err != nil {
		t.Fatal(err)
	}
	if err := accounts.Finish(ctx, me); err != nil {
		t.Fatal(err)
	}

	if left := partition(t, client, table, me); len(left) != 0 {
		t.Errorf("%d item(s) left: %v", len(left), left)
	}
	for _, key := range []string{"phone", "laptop"} {
		if _, ok, _ := sessions.GetSession(ctx, key); ok {
			t.Errorf("the session on the %s outlived the account", key)
		}
	}
	if _, ok, _ := sessions.GetSession(ctx, "theirs"); !ok {
		t.Error("someone else's session ended")
	}
	if left := partition(t, client, table, them); len(left) != 2 {
		t.Errorf("someone else's items: %v", left)
	}
}

func TestAnAccountThatHoldsNothingIsDeleted(t *testing.T) {
	client, table := localTable(t)
	ctx := context.Background()
	accounts := NewAccounts(client, table)
	me := "taskfest-test-one@example.com"

	if err := accounts.Mark(ctx, me); err != nil {
		t.Fatal(err)
	}
	if err := accounts.Finish(ctx, me); err != nil {
		t.Fatal(err)
	}

	if left := partition(t, client, table, me); len(left) != 0 {
		t.Errorf("left: %v", left)
	}
}

func TestADeletionLeftHalfWayIsFinishedBeforeTheAccountIsUsedAgain(t *testing.T) {
	client, table := localTable(t)
	ctx := context.Background()
	accounts := NewAccounts(client, table)
	me := "taskfest-test-one@example.com"
	put(t, client, table, map[string]any{"PK": OwnerKey(me), "SK": "TASK#00000001", "id": 1})
	if err := accounts.Mark(ctx, me); err != nil {
		t.Fatal(err)
	}

	if err := accounts.Settle(ctx, me); err != nil {
		t.Fatal(err)
	}

	if left := partition(t, client, table, me); len(left) != 0 {
		t.Errorf("left: %v", left)
	}
}

func TestAnAccountInUseIsLeftAloneBySettling(t *testing.T) {
	client, table := localTable(t)
	ctx := context.Background()
	accounts := NewAccounts(client, table)
	me := "taskfest-test-one@example.com"
	put(t, client, table, map[string]any{"PK": OwnerKey(me), "SK": "META", "lastTaskId": 1})
	put(t, client, table, map[string]any{"PK": OwnerKey(me), "SK": "TASK#00000001", "id": 1})

	if err := accounts.Settle(ctx, me); err != nil {
		t.Fatal(err)
	}
	if err := accounts.Settle(ctx, "nobody@example.com"); err != nil {
		t.Fatal(err)
	}

	if left := partition(t, client, table, me); len(left) != 2 {
		t.Errorf("left: %v", left)
	}
}
