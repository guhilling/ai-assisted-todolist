// Command replay deletes again any account a restore of the table brought back, and prunes the
// deletion records no restore can need any more (#213, #553); internal/replay decides and logs.
// EventBridge Scheduler runs it daily on Lambda. The restore procedure runs it once from a shell,
// against the restored table, before the API is switched to it (doc/deployment/serverless.md).
//
// Settings, from the environment: TABLE_NAME, the DynamoDB table; TASKFEST_ATTACHMENTS_BUCKET,
// the attachment bucket that holds the records; DYNAMODB_ENDPOINT and S3_ENDPOINT, set only for
// DynamoDB Local and LocalStack, and only together, or local records would decide about a real
// table. Its log lines are JSON.
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/files"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/replay"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/store"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := settings(os.Getenv); err != nil {
		slog.Error("the settings are wrong", "error", err)
		os.Exit(1)
	}
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
	accounts := store.NewAccounts(client, table)
	points := store.NewRestorePoints(client, table)
	records := files.New(files.NewClient(cfg, os.Getenv("S3_ENDPOINT")), os.Getenv("TASKFEST_ATTACHMENTS_BUCKET"))
	run := func(ctx context.Context) (replay.Report, error) {
		return replay.Run(ctx, records, accounts, points)
	}
	if os.Getenv("AWS_LAMBDA_RUNTIME_API") != "" {
		lambda.Start(run)
		return
	}
	// From a shell, once, as the restore procedure runs it.
	if _, err := run(context.Background()); err != nil {
		slog.Error("the replay failed", "error", err)
		os.Exit(1)
	}
}

// settings says why the run must not start: no table or bucket, or one of the two local and the
// other real.
func settings(getenv func(string) string) error {
	switch {
	case getenv("TABLE_NAME") == "" || getenv("TASKFEST_ATTACHMENTS_BUCKET") == "":
		return errors.New("set TABLE_NAME and TASKFEST_ATTACHMENTS_BUCKET")
	case (getenv("DYNAMODB_ENDPOINT") == "") != (getenv("S3_ENDPOINT") == ""):
		return errors.New("set DYNAMODB_ENDPOINT and S3_ENDPOINT both, or neither")
	}
	return nil
}
