// Command api is the TaskFest backend in Go (#547): every route of doc/api/openapi.json, the
// unported ones answering 501. On Lambda it serves API Gateway's HTTP API; anywhere else it is a
// plain HTTP server, for local development and the end-to-end tests, so both run the same code.
//
// Settings, from the environment: TABLE_NAME, the DynamoDB table; DYNAMODB_ENDPOINT, set only for
// DynamoDB Local; TASKFEST_ATTACHMENTS_BUCKET, the attachment bucket, as for the Quarkus backend;
// S3_ENDPOINT, set only for LocalStack; PORT, for the HTTP server, 8080 by default; sign-in's, which auth.LoadConfig
// lists; TASKFEST_GRAVATAR_ENABLED, "false" to never ask Gravatar.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	// Lambda's provided.al2023 image has no zone database, and a task's due time is in a zone.
	_ "time/tzdata"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/api"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/files"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/gravatar"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/lambdahttp"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/store"
)

func main() {
	// Once per cold start, outside any request, so that warm requests reuse the client.
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("loading the AWS configuration failed", "error", err)
		os.Exit(1)
	}
	client := dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) {
		if endpoint := os.Getenv("DYNAMODB_ENDPOINT"); endpoint != "" {
			o.BaseEndpoint = &endpoint
		}
	})
	table := os.Getenv("TABLE_NAME")
	tasks := store.New(client, table)
	writes := store.NewWrites(client, table)
	bucket := files.New(files.NewClient(cfg, os.Getenv("S3_ENDPOINT")), os.Getenv("TASKFEST_ATTACHMENTS_BUCKET"))
	authConfig, err := auth.LoadConfig(os.Getenv)
	if err != nil {
		slog.Error("the sign-in configuration is wrong", "error", err)
		os.Exit(1)
	}
	avatars := gravatar.New(os.Getenv("TASKFEST_GRAVATAR_ENABLED") != "false", gravatar.DefaultBase)
	signIn := auth.New(authConfig, store.NewSessions(client, table), avatars)
	server := &api.Server{Tasks: tasks, Writes: writes, Attachments: writes, Files: bucket, SignIn: signIn,
		Caller: func(r *http.Request) (string, bool) {
			id, ok := signIn.Identify(r)
			return id.Email, ok
		}}
	routes := api.Routes(server)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	if err := tasks.Prime(ctx); err != nil {
		// Only slower: the first request opens the connection instead.
		slog.Warn("priming the DynamoDB connection failed", "error", err)
	}
	cancel()

	if os.Getenv("AWS_LAMBDA_RUNTIME_API") != "" {
		lambda.Start(lambdahttp.Handler(routes))
		return
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	slog.Info("serving HTTP", "port", port)
	srv := &http.Server{Addr: ":" + port, Handler: routes, ReadHeaderTimeout: 10 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("the HTTP server stopped", "error", err)
		os.Exit(1)
	}
}
