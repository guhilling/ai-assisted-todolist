// Command orphans is the hourly clean-up of objects in the attachment bucket that no attachment
// item refers to (#208, #552), run by EventBridge Scheduler; internal/orphans decides and logs.
//
// Settings, from the environment: TABLE_NAME, the DynamoDB table; TASKFEST_ATTACHMENTS_BUCKET,
// the attachment bucket; DYNAMODB_ENDPOINT and S3_ENDPOINT, set only for DynamoDB Local and
// LocalStack, and only together, or a local bucket is compared with a real table. Its log lines are JSON, so the alarm's metric filter can match the
// orphanSweepAlert field.
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/files"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/orphans"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/store"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
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
	items := store.NewInventory(client, os.Getenv("TABLE_NAME"))
	bucket := files.New(files.NewClient(cfg, os.Getenv("S3_ENDPOINT")), os.Getenv("TASKFEST_ATTACHMENTS_BUCKET"))
	lambda.Start(func(ctx context.Context) (orphans.Report, error) {
		return orphans.Sweep(ctx, items, bucket, time.Now())
	})
}
