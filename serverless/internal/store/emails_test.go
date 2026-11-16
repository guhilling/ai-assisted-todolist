package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// noReads is a table that fails any read, for what must be answered without one.
type noReads struct{ AccountsAPI }

func (noReads) GetItem(context.Context, *dynamodb.GetItemInput, ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error) {
	return nil, errors.New("read the table")
}

func TestAnEmailInLowerCaseKeysItsAccountWithoutARead(t *testing.T) {
	got, err := NewAccounts(noReads{}, "table").AccountEmail(context.Background(), "gunnar@example.com")
	if err != nil || got != "gunnar@example.com" {
		t.Errorf("got %q, %v", got, err)
	}
}

func TestAnUnreadableTableKeysNoAccountForAnEmailWithCapitals(t *testing.T) {
	if _, err := NewAccounts(noReads{}, "table").AccountEmail(context.Background(), "Gunnar@Example.com"); err == nil {
		t.Error("an account was keyed without reading whether the email as sent has one")
	}
}

func TestAnEmailWithCapitalsKeysTheAccountOfItsLowerCase(t *testing.T) {
	client, table := localTable(t)

	got, err := NewAccounts(client, table).AccountEmail(context.Background(), "Gunnar@Example.com")

	if err != nil || got != "gunnar@example.com" {
		t.Errorf("got %q, %v; want the lower-cased email", got, err)
	}
}

func TestAnAccountBegunUnderTheEmailAsSentKeepsItsPartition(t *testing.T) {
	// Before #622 the partition was the hash of the email exactly as the provider sent it.
	client, table := localTable(t)
	put(t, client, table, map[string]any{"PK": OwnerKey("Gunnar@Example.com"), "SK": "META", "lastTaskId": 1})
	put(t, client, table, map[string]any{"PK": OwnerKey("Gunnar@Example.com"), "SK": "TASK#00000001", "id": 1,
		"description": "Mine", "dueDate": "2026-11-30", "importance": "HIGH", "state": "TODO"})

	got, err := NewAccounts(client, table).AccountEmail(context.Background(), "Gunnar@Example.com")
	if err != nil || got != "Gunnar@Example.com" {
		t.Fatalf("got %q, %v; want the email as sent", got, err)
	}
	tasks, err := New(client, table).Tasks(context.Background(), got)
	if err != nil || len(tasks) != 1 {
		t.Errorf("the board has %d task(s), %v; want the one it had", len(tasks), err)
	}
}

func TestAnAccountUnderTheEmailAsSentWinsOverOneUnderItsLowerCase(t *testing.T) {
	// Both can exist when another provider sent the address in lower case before #622: the older
	// one stays reachable rather than hidden behind the other.
	client, table := localTable(t)
	put(t, client, table, map[string]any{"PK": OwnerKey("Gunnar@Example.com"), "SK": "META", "lastTaskId": 1})
	put(t, client, table, map[string]any{"PK": OwnerKey("gunnar@example.com"), "SK": "META", "lastTaskId": 1})

	got, err := NewAccounts(client, table).AccountEmail(context.Background(), "Gunnar@Example.com")

	if err != nil || got != "Gunnar@Example.com" {
		t.Errorf("got %q, %v; want the email as sent", got, err)
	}
}

func TestAnEmailInAnotherCaseKeysTheLowerCasedAccount(t *testing.T) {
	client, table := localTable(t)
	put(t, client, table, map[string]any{"PK": OwnerKey("gunnar@example.com"), "SK": "META", "lastTaskId": 1})

	got, err := NewAccounts(client, table).AccountEmail(context.Background(), "GUNNAR@example.com")

	if err != nil || got != "gunnar@example.com" {
		t.Errorf("got %q, %v", got, err)
	}
}

// links is the session links in the partition of email.
func links(t *testing.T, client *dynamodb.Client, table, email string) []string {
	t.Helper()
	var keys []string
	for _, item := range partition(t, client, table, email) {
		if sk, ok := item["SK"].(*types.AttributeValueMemberS); ok && sk.Value != "META" {
			keys = append(keys, sk.Value)
		}
	}
	return keys
}

func TestASessionSignedInWithCapitalsIsLinkedFromTheAccountItUses(t *testing.T) {
	client, table := localTable(t)
	sessions := NewSessions(client, table)
	signIn(t, sessions, "new", "Ada@Example.com")
	put(t, client, table, map[string]any{"PK": OwnerKey("Gunnar@Example.com"), "SK": "META", "lastTaskId": 1})
	signIn(t, sessions, "legacy", "Gunnar@Example.com")

	if got := links(t, client, table, "ada@example.com"); len(got) != 1 || got[0] != "SESSION#new" {
		t.Errorf("links under the lower-cased email: %v", got)
	}
	if got := links(t, client, table, "Gunnar@Example.com"); len(got) != 1 || got[0] != "SESSION#legacy" {
		t.Errorf("links under the email as sent: %v", got)
	}
	got, _, err := sessions.GetSession(context.Background(), "new")
	if err != nil || got.Email != "Ada@Example.com" {
		t.Errorf("the session's email is %q, %v; want it as the provider sent it", got.Email, err)
	}
}

func TestSigningOutWithCapitalsDeletesTheLinkFromTheAccountItUses(t *testing.T) {
	client, table := localTable(t)
	sessions := NewSessions(client, table)
	signIn(t, sessions, "new", "Ada@Example.com")

	if err := sessions.DeleteSession(context.Background(), "new"); err != nil {
		t.Fatal(err)
	}
	if got := links(t, client, table, "ada@example.com"); len(got) != 0 {
		t.Errorf("links left: %v", got)
	}
}

func TestSigningOutOfASessionBegunBeforeCaseWasIgnoredDeletesItsLink(t *testing.T) {
	// Such a session's item names no account: its link is under the email as sent.
	client, table := localTable(t)
	put(t, client, table, map[string]any{"PK": OwnerKey("Ada@Example.com"), "SK": "SESSION#old", "created": 1})
	put(t, client, table, map[string]any{"PK": "SESSION#old", "SK": "SESSION", "email": "Ada@Example.com",
		"provider": "google", "created": 1, "lastSeen": 1, "expiresAt": time.Now().Add(time.Hour).Unix()})

	if err := NewSessions(client, table).DeleteSession(context.Background(), "old"); err != nil {
		t.Fatal(err)
	}
	if got := links(t, client, table, "Ada@Example.com"); len(got) != 0 {
		t.Errorf("links left: %v", got)
	}
}

func TestDeletingAnAccountBegunUnderTheEmailAsSentDeletesThatPartitionAndEndsItsSessions(t *testing.T) {
	client, table := localTable(t)
	ctx := context.Background()
	const sent = "Gunnar@Example.com"
	put(t, client, table, map[string]any{"PK": OwnerKey(sent), "SK": "META", "lastTaskId": 1})
	put(t, client, table, map[string]any{"PK": OwnerKey(sent), "SK": "TASK#00000001", "id": 1})
	sessions := NewSessions(client, table)
	signIn(t, sessions, "phone", sent)
	accounts := NewAccounts(client, table)

	email, err := accounts.AccountEmail(ctx, sent)
	if err != nil {
		t.Fatal(err)
	}
	if err := accounts.Mark(ctx, email); err != nil {
		t.Fatal(err)
	}
	if err := accounts.Finish(ctx, email); err != nil {
		t.Fatal(err)
	}

	if left := partition(t, client, table, sent); len(left) != 0 {
		t.Errorf("%d item(s) left: %v", len(left), left)
	}
	if _, ok, _ := sessions.GetSession(ctx, "phone"); ok {
		t.Error("the session outlived the account")
	}
	if next, err := accounts.AccountEmail(ctx, sent); err != nil || next != "gunnar@example.com" {
		t.Errorf("after the deletion the email keys %q, %v; want a new account under its lower case", next, err)
	}
}

func TestTheReplayDeletesAgainAnAccountBegunUnderTheEmailAsSent(t *testing.T) {
	// The deletion record is named by the hash of the email the account is keyed by.
	client, table := localTable(t)
	ctx := context.Background()
	const sent = "Gunnar@Example.com"
	put(t, client, table, map[string]any{"PK": OwnerKey(sent), "SK": "META", "lastTaskId": 1, "createdAt": 1})
	put(t, client, table, map[string]any{"PK": OwnerKey(sent), "SK": "TASK#00000001", "id": 1})
	accounts := NewAccounts(client, table)
	email, err := accounts.AccountEmail(ctx, sent)
	if err != nil {
		t.Fatal(err)
	}

	again, err := accounts.Reapply(ctx, identity.EmailHash(email), time.Unix(2, 0))

	if err != nil || !again {
		t.Fatalf("reapplied %v, %v", again, err)
	}
	if left := partition(t, client, table, sent); len(left) != 0 {
		t.Errorf("%d item(s) left: %v", len(left), left)
	}
}
