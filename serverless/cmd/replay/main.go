// Command replay deletes again any account a restore of the table brought back, and prunes the
// deletion records no restore can need any more (#213, #553); internal/replay decides and logs.
// EventBridge Scheduler runs it daily on Lambda. The restore procedure runs it once from a shell,
// against the restored table, before the API is switched to it (doc/deployment/serverless.md).
//
// Settings, from the environment: TABLE_NAME, the DynamoDB table; TASKFEST_ATTACHMENTS_BUCKET,
// the attachment bucket that holds the records; DYNAMODB_ENDPOINT and S3_ENDPOINT, set only for
// DynamoDB Local and LocalStack, and only together, or local records would decide about a real
// table. Its log lines are JSON. From a shell it asks for an MFA code when the profile's role
// needs one, on standard error, so the administrator's profile can be named as it is.
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
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
	cfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithAssumeRoleCredentialOptions(func(o *stscreds.AssumeRoleOptions) {
			o.TokenProvider = mfaCode(os.Stdin, os.Stderr)
		}))
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
	records := files.New(files.NewClient(cfg, os.Getenv("S3_ENDPOINT")), os.Getenv("TASKFEST_ATTACHMENTS_BUCKET"))
	accounts := store.NewAccounts(client, table).WithFiles(records)
	points := store.NewRestorePoints(client, table)
	run := func(ctx context.Context) (replay.Report, error) {
		return replay.Run(ctx, time.Now(), records, accounts, points)
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

// mfaCode asks for the MFA code of a role the profile assumes, and reads it as one line. The SDK
// has no prompt of its own, and stscreds.StdinTokenProvider's goes to standard output, among the
// JSON log lines. On Lambda nothing assumes a role with MFA, so it is never asked.
func mfaCode(in io.Reader, out io.Writer) func() (string, error) {
	return func() (string, error) {
		fmt.Fprint(out, "MFA code: ")
		line, err := bufio.NewReader(in).ReadString('\n')
		code := strings.TrimSpace(line)
		if code == "" {
			return "", errors.Join(errors.New("no MFA code given"), err)
		}
		return code, nil
	}
}
