// Command streams handles the table's stream (#552): it deletes the file and thumbnail of every
// attachment item that goes, whether removed, discarded with its draft or deleted by TTL once
// expired. This is what the Quarkus backend's attachment sweep did with the object after the row.
// A record whose files fail to go is answered as a failure, which Lambda tries again on its own;
// deleting what is already gone is no error.
//
// Settings, from the environment: TASKFEST_ATTACHMENTS_BUCKET, the attachment bucket. The stream
// must carry old images, which hold the object key.
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/files"
)

// deleter is the bucket as the handler uses it.
type deleter interface {
	Delete(ctx context.Context, key string) error
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("loading the AWS configuration failed", "error", err)
		os.Exit(1)
	}
	bucket := files.New(files.NewClient(cfg, os.Getenv("S3_ENDPOINT")), os.Getenv("TASKFEST_ATTACHMENTS_BUCKET"))
	lambda.Start(func(ctx context.Context, event events.DynamoDBEvent) (events.DynamoDBEventResponse, error) {
		return handle(ctx, bucket, event), nil
	})
}

// handle deletes the files of the attachment items the event removes, and answers the records
// that failed, by sequence number, for Lambda to try again.
func handle(ctx context.Context, bucket deleter, event events.DynamoDBEvent) events.DynamoDBEventResponse {
	var out events.DynamoDBEventResponse
	for _, r := range event.Records {
		if r.EventName != string(events.DynamoDBOperationTypeRemove) ||
			!strings.HasPrefix(r.Change.Keys["SK"].String(), "ATT#") {
			continue
		}
		key, ok := r.Change.OldImage["objectKey"]
		if !ok {
			continue // a link
		}
		if err := errors.Join(bucket.Delete(ctx, key.String()), bucket.Delete(ctx, board.ThumbnailKey(key.String()))); err != nil {
			slog.WarnContext(ctx, "an attachment's files could not be deleted; tried again",
				"key", key.String(), "error", err)
			out.BatchItemFailures = append(out.BatchItemFailures,
				events.DynamoDBBatchItemFailure{ItemIdentifier: r.Change.SequenceNumber})
		}
	}
	return out
}
