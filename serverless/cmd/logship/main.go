// Command logship sends the environment's logs on to the shared monitoring server (#508);
// internal/logship converts and posts them. CloudWatch Logs invokes it with each batch of the
// functions' and the HTTP API's lines, through the subscription filters the module sets where the
// environment names a monitoring server. A batch that fails is retried twice by Lambda, then
// dropped: CloudWatch keeps every line, and the monitoring server is not the record.
//
// Settings, from the environment: TASKFEST_ENV, the environment; TASKFEST_MONITORING_ENDPOINT,
// the server's HTTPS address, left empty where nothing is sent; TASKFEST_MONITORING_USER and
// TASKFEST_MONITORING_PASSWORD_PARAMETER, the sender's name and the SSM SecureString that holds its
// password, read once per cold start. Its own log lines are JSON, and are not sent on.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ssm"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/logship"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	on, err := settings(os.Getenv)
	if err != nil {
		slog.Error("the settings are wrong", "error", err)
		os.Exit(1)
	}
	if !on {
		// No monitoring server for this environment: nothing subscribes it, so this is not invoked.
		lambda.Start(func(context.Context, events.CloudwatchLogsEvent) error { return nil })
		return
	}
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("loading the AWS configuration failed", "error", err)
		os.Exit(1)
	}
	parameters := ssm.NewFromConfig(cfg)
	var (
		mu     sync.Mutex
		sender *logship.Sender
	)
	// The password is read on the first batch, and again after a failure to read it.
	senderFor := func(ctx context.Context) (*logship.Sender, error) {
		mu.Lock()
		defer mu.Unlock()
		if sender != nil {
			return sender, nil
		}
		out, err := parameters.GetParameter(ctx, &ssm.GetParameterInput{
			Name: aws.String(os.Getenv("TASKFEST_MONITORING_PASSWORD_PARAMETER")), WithDecryption: aws.Bool(true)})
		if err != nil {
			return nil, err
		}
		sender = &logship.Sender{Client: &http.Client{Timeout: 10 * time.Second},
			Endpoint: os.Getenv("TASKFEST_MONITORING_ENDPOINT"), User: os.Getenv("TASKFEST_MONITORING_USER"),
			Password: aws.ToString(out.Parameter.Value)}
		return sender, nil
	}
	env := os.Getenv("TASKFEST_ENV")
	lambda.Start(func(ctx context.Context, event events.CloudwatchLogsEvent) error {
		data, err := event.AWSLogs.Parse()
		if err != nil {
			return err
		}
		records := logship.Convert(env, data.LogGroup, data.LogEvents)
		if len(records) == 0 {
			return nil
		}
		body, err := logship.Lines(records)
		if err != nil {
			return err
		}
		s, err := senderFor(ctx)
		if err != nil {
			slog.ErrorContext(ctx, "reading the monitoring password failed", "error", err)
			return err
		}
		if err := s.Send(ctx, body); err != nil {
			slog.WarnContext(ctx, "sending logs to the monitoring server failed", "error", err,
				"logGroup", data.LogGroup, "lines", len(records))
			return err
		}
		return nil
	})
}

// settings says whether logs are sent at all -- only where an endpoint is set -- and why the run
// must not start: an endpoint without the rest, or one that would carry the password in the clear.
func settings(getenv func(string) string) (bool, error) {
	endpoint := getenv("TASKFEST_MONITORING_ENDPOINT")
	switch {
	case endpoint == "":
		return false, nil
	case !strings.HasPrefix(endpoint, "https://"):
		return false, errors.New("TASKFEST_MONITORING_ENDPOINT must be HTTPS")
	case getenv("TASKFEST_ENV") == "" || getenv("TASKFEST_MONITORING_USER") == "" ||
		getenv("TASKFEST_MONITORING_PASSWORD_PARAMETER") == "":
		return false, errors.New("set TASKFEST_ENV, TASKFEST_MONITORING_USER and TASKFEST_MONITORING_PASSWORD_PARAMETER")
	}
	return true, nil
}
