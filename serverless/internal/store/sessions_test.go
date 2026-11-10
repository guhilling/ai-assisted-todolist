package store

import (
	"context"
	"testing"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

func TestASessionIsStoredReadTouchedAndDeleted(t *testing.T) {
	client, table := localTable(t)
	s := NewSessions(client, table)
	ctx := context.Background()
	created := time.Unix(time.Now().Unix(), 0)
	session := auth.Session{
		Identity: identity.Identity{Email: "person@example.com", Name: "Person", Provider: "google", Subject: "s1"},
		Created:  created, LastSeen: created,
	}

	if err := s.PutSession(ctx, "k1", session, created.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	got, ok, err := s.GetSession(ctx, "k1")
	if err != nil || !ok || got.Identity != session.Identity || !got.Created.Equal(created) {
		t.Fatalf("got %+v, %v, %v", got, ok, err)
	}
	later := created.Add(10 * time.Minute)
	if err := s.TouchSession(ctx, "k1", later, later.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if got, _, _ := s.GetSession(ctx, "k1"); !got.LastSeen.Equal(later) {
		t.Errorf("last seen %v; want %v", got.LastSeen, later)
	}
	if err := s.DeleteSession(ctx, "k1"); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := s.GetSession(ctx, "k1"); ok {
		t.Error("the session outlived its deletion")
	}
}

func TestTouchingAnEndedSessionDoesNotBringItBack(t *testing.T) {
	client, table := localTable(t)
	s := NewSessions(client, table)
	now := time.Now()

	if err := s.TouchSession(context.Background(), "gone", now, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := s.GetSession(context.Background(), "gone"); ok {
		t.Error("a touch created a session")
	}
}

func TestASignInUnderWayCanBeTakenOnceAndNotLate(t *testing.T) {
	client, table := localTable(t)
	s := NewSessions(client, table)
	ctx := context.Background()
	pending := auth.PendingSignIn{Provider: "google", Verifier: "v", Nonce: "n"}

	if err := s.PutPendingSignIn(ctx, "st", pending, time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	got, ok, err := s.TakePendingSignIn(ctx, "st")
	if err != nil || !ok || got != pending {
		t.Fatalf("got %+v, %v, %v", got, ok, err)
	}
	if _, ok, _ := s.TakePendingSignIn(ctx, "st"); ok {
		t.Error("taken twice")
	}
	if err := s.PutPendingSignIn(ctx, "late", pending, time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := s.TakePendingSignIn(ctx, "late"); ok {
		t.Error("an expired sign-in was taken")
	}
}
