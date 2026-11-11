// Command api is the TaskFest backend in Go (#547): every route of doc/api/openapi.json, the
// unported ones answering 501. On Lambda it serves API Gateway's HTTP API; anywhere else it is a
// plain HTTP server, for local development and the end-to-end tests, so both run the same code.
//
// Settings, from the environment: TABLE_NAME, the DynamoDB table; DYNAMODB_ENDPOINT, set only for
// DynamoDB Local; TASKFEST_ATTACHMENTS_BUCKET, the attachment bucket, as for the Quarkus backend;
// S3_ENDPOINT, set only for LocalStack; PORT, for the HTTP server, 8080 by default; sign-in's,
// which auth.LoadConfig lists, where a client secret X_SECRET may instead be X_SECRET_ARN, the
// Secrets Manager secret holding it (internal/secrets); TASKFEST_GRAVATAR_ENABLED, "false" to
// never ask Gravatar; on Lambda, TASKFEST_ORIGIN_SECRET, the value CloudFront sends in
// lambdahttp.OriginHeader.
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
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"

	// Lambda's provided.al2023 image has no zone database, and a task's due time is in a zone.
	_ "time/tzdata"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/api"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/files"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/gravatar"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/lambdahttp"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/secrets"
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
	bucketName := os.Getenv("TASKFEST_ATTACHMENTS_BUCKET")
	bucket := files.New(files.NewClient(cfg, os.Getenv("S3_ENDPOINT")), bucketName)
	// A client secret comes from Secrets Manager where the setting names one (#554).
	settings, err := secrets.Resolve(context.Background(), os.Environ(), secretsmanager.NewFromConfig(cfg))
	if err != nil {
		slog.Error("reading the secrets failed", "error", err)
		os.Exit(1)
	}
	authConfig, err := auth.LoadConfig(settings)
	if err != nil {
		slog.Error("the sign-in configuration is wrong", "error", err)
		os.Exit(1)
	}
	avatars := gravatar.New(os.Getenv("TASKFEST_GRAVATAR_ENABLED") != "false", gravatar.DefaultBase)
	signIn := auth.New(authConfig, store.NewSessions(client, table), avatars)
	accounts := store.NewAccounts(client, table)
	server := &api.Server{Tasks: tasks, Writes: writes, Attachments: writes, Files: bucket, SignIn: signIn,
		Accounts: accounts,
		Caller: api.Settled(func(r *http.Request) (string, bool) {
			id, ok := signIn.Identify(r)
			return id.Email, ok
		}, accounts)}
	if bucketName != "" {
		// Without a bucket, as in a local stack with none, an account is deleted without a record.
		server.Records = bucket
	}
	routes := api.Routes(server)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	if err := tasks.Prime(ctx); err != nil {
		// Only slower: the first request opens the connection instead.
		slog.Warn("priming the DynamoDB connection failed", "error", err)
	}
	cancel()

	if os.Getenv("AWS_LAMBDA_RUNTIME_API") != "" {
		secret := os.Getenv("TASKFEST_ORIGIN_SECRET")
		if secret == "" {
			// FromOrigin would refuse every request; better a start that fails and says why.
			slog.Error("TASKFEST_ORIGIN_SECRET is not set")
			os.Exit(1)
		}
		lambda.Start(lambdahttp.Handler(lambdahttp.FromOrigin(secret, routes)))
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
