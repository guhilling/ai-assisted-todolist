package main

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/aws/aws-lambda-go/events"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

type fakeTasks struct {
	tasks []board.Task
	err   error
	email string
}

func (f *fakeTasks) Tasks(_ context.Context, email string) ([]board.Task, error) {
	f.email = email
	return f.tasks, f.err
}

func request(claims map[string]string) events.APIGatewayV2HTTPRequest {
	r := events.APIGatewayV2HTTPRequest{RouteKey: "GET /api/tasks"}
	if claims != nil {
		r.RequestContext.Authorizer = &events.APIGatewayV2HTTPRequestContextAuthorizerDescription{
			JWT: &events.APIGatewayV2HTTPRequestContextAuthorizerJWTDescription{Claims: claims},
		}
	}
	return r
}

func TestWithoutAnEmailClaimTheCallerIsNotSignedIn(t *testing.T) {
	h := handler{tasks: &fakeTasks{}}

	res, err := h.handle(context.Background(), request(nil))

	if err != nil || res.StatusCode != 401 {
		t.Errorf("got %d, %v; want 401", res.StatusCode, err)
	}
}

func TestAnUnverifiedEmailIsNotSignedIn(t *testing.T) {
	h := handler{tasks: &fakeTasks{}}

	for _, verified := range []string{"", "false", "False"} {
		claims := map[string]string{"email": "taskfest-test-one@example.com"}
		if verified != "" {
			claims["email_verified"] = verified
		}
		res, err := h.handle(context.Background(), request(claims))
		if err != nil || res.StatusCode != 401 {
			t.Errorf("email_verified %q: got %d, %v; want 401", verified, res.StatusCode, err)
		}
	}
}

func signedIn() map[string]string {
	return map[string]string{"email": "taskfest-test-one@example.com", "email_verified": "true"}
}

func TestTheBoardIsTheCallersTasksInBoardOrderAsTheAPISendsThem(t *testing.T) {
	zone, at := "Europe/Berlin", "10:00"
	fake := &fakeTasks{tasks: []board.Task{
		{ID: 2, Description: "Later", DueDate: "2026-12-01", Importance: board.ImportanceHigh, State: board.StateTodo},
		{ID: 1, Description: "Sooner", DueDate: "2026-11-30", DueTime: &at, TimeZone: &zone,
			Importance: board.ImportanceLow, State: board.StateDone},
	}}
	h := handler{tasks: fake}

	res, err := h.handle(context.Background(), request(signedIn()))

	if err != nil || res.StatusCode != 200 {
		t.Fatalf("got %d, %v", res.StatusCode, err)
	}
	if fake.email != "taskfest-test-one@example.com" {
		t.Errorf("asked for %q's tasks", fake.email)
	}
	if res.Headers["Content-Type"] != "application/json" {
		t.Errorf("content type %q", res.Headers["Content-Type"])
	}
	var body []map[string]any
	if err := json.Unmarshal([]byte(res.Body), &body); err != nil {
		t.Fatal(err)
	}
	if len(body) != 2 || body[0]["id"] != 1.0 || body[1]["id"] != 2.0 {
		t.Fatalf("got %v", body)
	}
	first := body[0]
	if first["dueAt"] != "2026-11-30T09:00:00Z" || first["timeZone"] != zone || first["state"] != "DONE" {
		t.Errorf("first task %v", first)
	}
	if body[1]["dueAt"] != nil || body[1]["dueTime"] != nil {
		t.Errorf("an all-day task has a null dueTime and dueAt: %v", body[1])
	}
	if atts, ok := first["attachments"].([]any); !ok || len(atts) != 0 {
		t.Errorf("attachments are always sent, as an empty list here: %v", first["attachments"])
	}
}

func TestAStoreFailureIsAServerErrorWithoutDetail(t *testing.T) {
	h := handler{tasks: &fakeTasks{err: errors.New("table gone")}}

	res, err := h.handle(context.Background(), request(signedIn()))

	if err != nil || res.StatusCode != 500 || res.Body != "" {
		t.Errorf("got %d %q, %v; want an empty 500", res.StatusCode, res.Body, err)
	}
}
