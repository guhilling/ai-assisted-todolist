// Command tasks is the spike's Lambda function (#535): GET /api/tasks, a user's board, read from
// DynamoDB and sent as the API's TaskResponse list. It exists to measure a cold start in
// Frankfurt; doc/deployment/serverless.md says what counts as success.
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	// Lambda's provided.al2023 image has no zone database, and a task's due time is in a zone.
	_ "time/tzdata"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/store"
)

// tasksSource is where the handler gets a user's tasks from: the DynamoDB store, or a test's.
type tasksSource interface {
	Tasks(ctx context.Context, email string) ([]board.Task, error)
}

// handler answers API Gateway's HTTP API events. The caller is whoever API Gateway's JWT
// authorizer let through; the spike is invoked with the claims it would pass on.
type handler struct {
	tasks tasksSource
}

// taskResponse is the API's TaskResponse, as doc/api/openapi.json defines it.
type taskResponse struct {
	ID          int64      `json:"id"`
	Description string     `json:"description"`
	DueDate     string     `json:"dueDate"`
	DueTime     *string    `json:"dueTime"`
	TimeZone    *string    `json:"timeZone"`
	DueAt       *time.Time `json:"dueAt"`
	Importance  string     `json:"importance"`
	State       string     `json:"state"`
	Attachments []struct{} `json:"attachments"`
}

func (h handler) handle(ctx context.Context, req events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	email := ""
	if a := req.RequestContext.Authorizer; a != nil && a.JWT != nil {
		email = a.JWT.Claims["email"]
	}
	if email == "" {
		return events.APIGatewayV2HTTPResponse{StatusCode: http.StatusUnauthorized}, nil
	}

	tasks, err := h.tasks.Tasks(ctx, email)
	if err != nil {
		slog.ErrorContext(ctx, "reading the board failed", "error", err)
		return events.APIGatewayV2HTTPResponse{StatusCode: http.StatusInternalServerError}, nil
	}
	board.Sort(tasks)

	out := make([]taskResponse, 0, len(tasks))
	for _, t := range tasks {
		at, err := board.DueAt(t)
		if err != nil {
			slog.ErrorContext(ctx, "a stored due time does not parse", "task", t.ID, "error", err)
		}
		out = append(out, taskResponse{
			ID: t.ID, Description: t.Description, DueDate: t.DueDate, DueTime: t.DueTime,
			TimeZone: t.TimeZone, DueAt: at, Importance: string(t.Importance), State: string(t.State),
			Attachments: []struct{}{},
		})
	}
	body, err := json.Marshal(out)
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	return events.APIGatewayV2HTTPResponse{
		StatusCode: http.StatusOK,
		Headers:    map[string]string{"Content-Type": "application/json"},
		Body:       string(body),
	}, nil
}

func main() {
	// Once per cold start, outside the handler, so that warm invocations reuse the client.
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("loading the AWS configuration failed", "error", err)
		os.Exit(1)
	}
	h := handler{tasks: store.New(dynamodb.NewFromConfig(cfg), os.Getenv("TABLE_NAME"))}
	lambda.Start(h.handle)
}
