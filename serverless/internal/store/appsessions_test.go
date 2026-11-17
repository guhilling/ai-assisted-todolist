package store

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// startApp stores an app session for email, as trading an ID token does (#281).
func startApp(t *testing.T, s *Sessions, key, email string, created time.Time) {
	t.Helper()
	session := auth.Session{Identity: identity.Identity{Email: email, Provider: "apple", Subject: "s1"},
		Created: created, LastSeen: created, App: true}
	if err := s.PutSession(context.Background(), key, session, created.Add(auth.AppLifetime)); err != nil {
		t.Fatal(err)
	}
}

func TestAnAppSessionIsStoredAsOneAndLinkedForItsThirtyDays(t *testing.T) {
	client, table := localTable(t)
	s := NewSessions(client, table)
	me := "taskfest-test-one@example.com"
	created := time.Unix(time.Now().Unix(), 0)

	startApp(t, s, "app", me, created)
	signIn(t, s, "web", me)

	got, ok, err := s.GetSession(context.Background(), "app")
	if err != nil || !ok || !got.App || got.Email != me || !got.Created.Equal(created) {
		t.Fatalf("got %+v, %v, %v", got, ok, err)
	}
	web, ok, err := s.GetSession(context.Background(), "web")
	if err != nil || !ok {
		t.Fatalf("the website's session: %v, %v", ok, err)
	}
	if web.App {
		t.Error("the website's session reads as an app's")
	}
	want := map[string]time.Duration{"SESSION#app": auth.AppLifetime, "SESSION#web": auth.AbsoluteLifetime}
	links := partition(t, client, table, me)
	if len(links) != 2 {
		t.Fatalf("links: %v", links)
	}
	for _, link := range links {
		sk := link["SK"].(*types.AttributeValueMemberS).Value
		created, _ := strconv.ParseInt(link["created"].(*types.AttributeValueMemberN).Value, 10, 64)
		expires, _ := strconv.ParseInt(link["expiresAt"].(*types.AttributeValueMemberN).Value, 10, 64)
		if time.Duration(expires-created)*time.Second != want[sk] {
			t.Errorf("%s lasts %v; want %v", sk, time.Duration(expires-created)*time.Second, want[sk])
		}
	}
}

func TestDeletingAnAccountEndsItsAppSessions(t *testing.T) {
	client, table := localTable(t)
	ctx := context.Background()
	sessions := NewSessions(client, table)
	me := "taskfest-test-one@example.com"
	startApp(t, sessions, "phone", me, time.Now().Add(-time.Minute))
	accounts := NewAccounts(client, table)

	if err := accounts.Mark(ctx, me); err != nil {
		t.Fatal(err)
	}
	if err := accounts.Finish(ctx, me); err != nil {
		t.Fatal(err)
	}

	if _, ok, err := sessions.GetSession(ctx, "phone"); err != nil || ok {
		t.Errorf("the app session outlived the account: %v, %v", ok, err)
	}
	if left := partition(t, client, table, me); len(left) != 0 {
		t.Errorf("left: %v", left)
	}
}

func TestEndingAnAppSessionDeletesItAndItsLink(t *testing.T) {
	client, table := localTable(t)
	sessions := NewSessions(client, table)
	me := "taskfest-test-one@example.com"
	startApp(t, sessions, "phone", me, time.Now())

	if err := sessions.DeleteSession(context.Background(), "phone"); err != nil {
		t.Fatal(err)
	}

	if _, ok, err := sessions.GetSession(context.Background(), "phone"); err != nil || ok {
		t.Errorf("the app session outlived its end: %v, %v", ok, err)
	}
	if left := partition(t, client, table, me); len(left) != 0 {
		t.Errorf("left: %v", left)
	}
}

func TestAnIDTokenCanBeClaimedForAnAppSessionOnce(t *testing.T) {
	client, table := localTable(t)
	s := NewSessions(client, table)
	ctx := context.Background()
	until := time.Now().Add(time.Hour)

	if first, err := s.ClaimIDToken(ctx, "token-hash", until); err != nil || !first {
		t.Fatalf("first claim: %v, %v", first, err)
	}
	if first, err := s.ClaimIDToken(ctx, "token-hash", until); err != nil || first {
		t.Fatalf("second claim: %v, %v", first, err)
	}
	if first, err := s.ClaimIDToken(ctx, "another-hash", until); err != nil || !first {
		t.Fatalf("another token: %v, %v", first, err)
	}
}
