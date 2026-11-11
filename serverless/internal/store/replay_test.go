package store

import (
	"context"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// metaOf reads the user's META item, or nil when there is none.
func metaOf(t *testing.T, client *dynamodb.Client, table, email string) map[string]any {
	t.Helper()
	out, err := client.GetItem(context.Background(), &dynamodb.GetItemInput{
		TableName: aws.String(table), Key: metaKey(email), ConsistentRead: aws.Bool(true)})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Item) == 0 {
		return nil
	}
	var m map[string]any
	if err := attributevalue.UnmarshalMap(out.Item, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// signInAt stores a session for email begun at created, as the website's sign-in does.
func signInAt(t *testing.T, s *Sessions, key, email string, created time.Time) {
	t.Helper()
	err := s.PutSession(context.Background(), key, auth.Session{
		Identity: identity.Identity{Email: email, Provider: "google"}, Created: created, LastSeen: created,
	}, created.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
}

func TestTheFirstIDStampsWhenTheAccountBeganAndLaterOnesKeepIt(t *testing.T) {
	client, table := localTable(t)
	w := NewWrites(client, table)
	began := time.Unix(1_800_000_000, 0)
	w.clock = func() time.Time { return began }
	ctx := context.Background()

	if _, err := w.Create(ctx, one, newTask("First")); err != nil {
		t.Fatal(err)
	}
	w.clock = func() time.Time { return began.Add(time.Hour) }
	if _, err := w.Create(ctx, one, newTask("Second")); err != nil {
		t.Fatal(err)
	}

	if got := metaOf(t, client, table, one)["createdAt"]; got != float64(began.Unix()) {
		t.Errorf("createdAt %v; want %d", got, began.Unix())
	}
}

func TestAnAccountARestoreBroughtBackIsDeletedAgain(t *testing.T) {
	client, table := localTable(t)
	ctx := context.Background()
	deleted := time.Unix(1_800_000_000, 0)
	put(t, client, table, map[string]any{"PK": OwnerKey(one), "SK": "META", "lastTaskId": 1,
		"createdAt": deleted.Add(-24 * time.Hour).Unix()})
	put(t, client, table, map[string]any{"PK": OwnerKey(one), "SK": "TASK#00000001", "id": 1})
	put(t, client, table, map[string]any{"PK": OwnerKey(two), "SK": "TASK#00000001", "id": 1})

	again, err := NewAccounts(client, table).Reapply(ctx, identity.EmailHash(one), deleted)

	if err != nil || !again {
		t.Fatalf("reapplied %v, %v", again, err)
	}
	if left := partition(t, client, table, one); len(left) != 0 {
		t.Errorf("left: %v", left)
	}
	if left := partition(t, client, table, two); len(left) != 1 {
		t.Errorf("someone else's: %v", left)
	}
}

func TestAnAccountWithoutItsCreationTimeCountsAsOlderThanTheDeletion(t *testing.T) {
	client, table := localTable(t)
	put(t, client, table, map[string]any{"PK": OwnerKey(one), "SK": "META", "lastTaskId": 1})
	put(t, client, table, map[string]any{"PK": OwnerKey(one), "SK": "TASK#00000001", "id": 1})

	again, err := NewAccounts(client, table).Reapply(context.Background(), identity.EmailHash(one), time.Unix(1_800_000_000, 0))

	if err != nil || !again || len(partition(t, client, table, one)) != 0 {
		t.Errorf("reapplied %v, %v; left %v", again, err, partition(t, client, table, one))
	}
}

func TestAnAccountBegunAfterTheDeletionIsKept(t *testing.T) {
	client, table := localTable(t)
	deleted := time.Unix(1_800_000_000, 0)
	put(t, client, table, map[string]any{"PK": OwnerKey(one), "SK": "META", "lastTaskId": 1,
		"createdAt": deleted.Add(time.Minute).Unix()})
	put(t, client, table, map[string]any{"PK": OwnerKey(one), "SK": "TASK#00000001", "id": 1})

	again, err := NewAccounts(client, table).Reapply(context.Background(), identity.EmailHash(one), deleted)

	if err != nil || again {
		t.Errorf("reapplied %v, %v", again, err)
	}
	if left := partition(t, client, table, one); len(left) != 2 {
		t.Errorf("left: %v", left)
	}
}

func TestWhatADeletionLeftWithoutMetaGoesButASessionBegunSinceStays(t *testing.T) {
	client, table := localTable(t)
	ctx := context.Background()
	sessions := NewSessions(client, table)
	deleted := time.Now().Add(-time.Hour).Truncate(time.Second)
	put(t, client, table, map[string]any{"PK": OwnerKey(one), "SK": "TASK#00000042", "id": 42})
	signInAt(t, sessions, "before", one, deleted.Add(-time.Minute))
	signInAt(t, sessions, "since", one, deleted.Add(time.Minute))

	again, err := NewAccounts(client, table).Reapply(ctx, identity.EmailHash(one), deleted)

	if err != nil || !again {
		t.Fatalf("reapplied %v, %v", again, err)
	}
	if left := partition(t, client, table, one); len(left) != 1 {
		t.Errorf("left: %v", left)
	}
	if _, ok, _ := sessions.GetSession(ctx, "before"); ok {
		t.Error("a session from before the deletion survived it")
	}
	if _, ok, _ := sessions.GetSession(ctx, "since"); !ok {
		t.Error("a session begun after the deletion was ended")
	}
}

func TestNothingLeftOfADeletionIsNothingToReapply(t *testing.T) {
	client, table := localTable(t)

	again, err := NewAccounts(client, table).Reapply(context.Background(), identity.EmailHash(one), time.Now())

	if err != nil || again {
		t.Errorf("reapplied %v, %v", again, err)
	}
	if metaOf(t, client, table, one) != nil {
		t.Error("a record with nothing left of its account wrote to it")
	}
}

func TestSigningInAgainWhileADeletionIsLeftHalfWayKeepsTheNewSession(t *testing.T) {
	client, table := localTable(t)
	ctx := context.Background()
	accounts, sessions := NewAccounts(client, table), NewSessions(client, table)
	marked := time.Now().Add(-time.Hour).Truncate(time.Second)
	accounts.now = func() time.Time { return marked }
	put(t, client, table, map[string]any{"PK": OwnerKey(one), "SK": "TASK#00000001", "id": 1})
	if err := accounts.Mark(ctx, one); err != nil {
		t.Fatal(err)
	}
	signInAt(t, sessions, "again", one, marked.Add(time.Minute))

	if _, err := accounts.Settle(ctx, one); err != nil {
		t.Fatal(err)
	}

	if _, ok, _ := sessions.GetSession(ctx, "again"); !ok {
		t.Error("the session signed in after the deletion was ended by finishing it")
	}
	if metaOf(t, client, table, one) != nil {
		t.Error("META outlived the deletion")
	}
}
