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
		// Nothing subscribes it where no server is named. Invoked all the same, it runs a version
		// published before the endpoint was set, which a deploy replaces (observability.md).
		lambda.Start(func(ctx context.Context, _ events.CloudwatchLogsEvent) error {
			slog.WarnContext(ctx, "invoked without a monitoring endpoint; the lines are not sent until a deploy publishes the settings")
			return nil
		})
		return
	}
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("loading the AWS configuration failed", "error", err)
		os.Exit(1)
	}
	s := &shipper{env: os.Getenv("TASKFEST_ENV"), parameters: ssm.NewFromConfig(cfg),
		parameter: os.Getenv("TASKFEST_MONITORING_PASSWORD_PARAMETER"),
		endpoint:  os.Getenv("TASKFEST_MONITORING_ENDPOINT"), user: os.Getenv("TASKFEST_MONITORING_USER"),
		client: &http.Client{Timeout: 10 * time.Second}}
	lambda.Start(s.handle)
}

// passwords is the one SSM call logship makes.
type passwords interface {
	GetParameter(ctx context.Context, in *ssm.GetParameterInput, opts ...func(*ssm.Options)) (*ssm.GetParameterOutput, error)
}

// shipper converts each batch and sends it, reading the password on the first batch, and again
// after a failure to read it.
type shipper struct {
	env        string
	parameters passwords
	parameter  string
	endpoint   string
	user       string
	client     *http.Client

	mu     sync.Mutex
	sender *logship.Sender
}

// handle sends one batch of lines, leaving out CloudWatch Logs' health check of the destination,
// and fails when they could not be sent, so that Lambda tries again.
func (s *shipper) handle(ctx context.Context, event events.CloudwatchLogsEvent) error {
	data, err := event.AWSLogs.Parse()
	if err != nil {
		return err
	}
	if data.MessageType != "DATA_MESSAGE" {
		return nil
	}
	lines := make([]logship.Line, len(data.LogEvents))
	for i, e := range data.LogEvents {
		lines[i] = logship.Line{Timestamp: e.Timestamp, Message: e.Message}
	}
	records := logship.Convert(s.env, data.LogGroup, lines)
	if len(records) == 0 {
		return nil
	}
	body, err := logship.Lines(records)
	if err != nil {
		return err
	}
	sender, err := s.senderFor(ctx)
	if err != nil {
		slog.ErrorContext(ctx, "reading the monitoring password failed", "error", err)
		return err
	}
	if err := sender.Send(ctx, body); err != nil {
		slog.WarnContext(ctx, "sending logs to the monitoring server failed", "error", err,
			"logGroup", data.LogGroup, "lines", len(records))
		return err
	}
	return nil
}

func (s *shipper) senderFor(ctx context.Context) (*logship.Sender, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sender != nil {
		return s.sender, nil
	}
	out, err := s.parameters.GetParameter(ctx, &ssm.GetParameterInput{
		Name: aws.String(s.parameter), WithDecryption: aws.Bool(true)})
	if err != nil {
		return nil, err
	}
	if out.Parameter == nil || aws.ToString(out.Parameter.Value) == "" {
		return nil, errors.New("the monitoring password's parameter has no value")
	}
	s.sender = &logship.Sender{Client: s.client, Endpoint: s.endpoint, User: s.user,
		Password: aws.ToString(out.Parameter.Value)}
	return s.sender, nil
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
