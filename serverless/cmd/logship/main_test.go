package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	"github.com/aws/aws-sdk-go-v2/service/ssm/types"
)

func TestTheShipperIsOffWithoutAnEndpointAndNeedsEverythingWithOne(t *testing.T) {
	off := map[string]string{"TASKFEST_ENV": "prod"}
	if on, err := settings(func(k string) string { return off[k] }); on || err != nil {
		t.Errorf("without an endpoint: %v, %v", on, err)
	}
	full := map[string]string{"TASKFEST_ENV": "qa", "TASKFEST_MONITORING_ENDPOINT": "https://m.example.com",
		"TASKFEST_MONITORING_USER": "taskfest-qa", "TASKFEST_MONITORING_PASSWORD_PARAMETER": "/p"}
	if on, err := settings(func(k string) string { return full[k] }); !on || err != nil {
		t.Errorf("with everything: %v, %v", on, err)
	}
	for _, missing := range []string{"TASKFEST_ENV", "TASKFEST_MONITORING_USER", "TASKFEST_MONITORING_PASSWORD_PARAMETER"} {
		env := map[string]string{}
		for k, v := range full {
			if k != missing {
				env[k] = v
			}
		}
		if _, err := settings(func(k string) string { return env[k] }); err == nil {
			t.Errorf("started without %s", missing)
		}
	}
	plain := map[string]string{"TASKFEST_ENV": "qa", "TASKFEST_MONITORING_ENDPOINT": "http://m.example.com",
		"TASKFEST_MONITORING_USER": "u", "TASKFEST_MONITORING_PASSWORD_PARAMETER": "/p"}
	if _, err := settings(func(k string) string { return plain[k] }); err == nil {
		t.Error("would send the password over plain HTTP")
	}
}

// parameters is a fake of SSM's GetParameter: the password, or the failure, it is set to answer.
type parameters struct {
	calls  int
	answer *ssm.GetParameterOutput
	err    error
}

func (p *parameters) GetParameter(_ context.Context, in *ssm.GetParameterInput, _ ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
	p.calls++
	if aws.ToString(in.Name) != "/taskfest/qa/monitoring-password" || !aws.ToBool(in.WithDecryption) {
		return nil, errors.New("asked for the wrong parameter")
	}
	return p.answer, p.err
}

func password(value string) *ssm.GetParameterOutput {
	return &ssm.GetParameterOutput{Parameter: &types.Parameter{Value: aws.String(value)}}
}

// batch is a CloudWatch Logs event as Lambda hands it over: gzipped JSON, base64-encoded.
func batch(t *testing.T, messageType, logGroup string, messages ...string) events.CloudwatchLogsEvent {
	t.Helper()
	data := events.CloudwatchLogsData{MessageType: messageType, LogGroup: logGroup}
	for i, m := range messages {
		data.LogEvents = append(data.LogEvents, events.CloudwatchLogsLogEvent{ID: fmt.Sprint(i), Timestamp: 1, Message: m})
	}
	raw, _ := json.Marshal(data)
	var zipped bytes.Buffer
	w := gzip.NewWriter(&zipped)
	_, _ = w.Write(raw)
	_ = w.Close()
	return events.CloudwatchLogsEvent{AWSLogs: events.CloudwatchLogsRawData{Data: base64.StdEncoding.EncodeToString(zipped.Bytes())}}
}

func server(t *testing.T, bodies *[]string) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, pw, _ := r.BasicAuth(); pw != "pw" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		b, _ := io.ReadAll(r.Body)
		*bodies = append(*bodies, string(b))
	}))
	t.Cleanup(s.Close)
	return s
}

func TestThePasswordIsReadOnceAndEveryBatchSent(t *testing.T) {
	var bodies []string
	p := &parameters{answer: password("pw")}
	s := &shipper{env: "qa", parameters: p, parameter: "/taskfest/qa/monitoring-password",
		endpoint: server(t, &bodies).URL, user: "taskfest-qa", client: http.DefaultClient}
	for range 2 {
		if err := s.handle(context.Background(), batch(t, "DATA_MESSAGE", "/aws/lambda/taskfest-qa-api", "hello")); err != nil {
			t.Fatal(err)
		}
	}
	if p.calls != 1 || len(bodies) != 2 || !strings.Contains(bodies[0], `"source":"api"`) {
		t.Errorf("%d reads, %q", p.calls, bodies)
	}
}

func TestAFailedReadIsTriedAgainWithTheNextBatch(t *testing.T) {
	var bodies []string
	p := &parameters{err: errors.New("throttled")}
	s := &shipper{env: "qa", parameters: p, parameter: "/taskfest/qa/monitoring-password",
		endpoint: server(t, &bodies).URL, user: "taskfest-qa", client: http.DefaultClient}
	event := batch(t, "DATA_MESSAGE", "/aws/lambda/taskfest-qa-api", "hello")
	if err := s.handle(context.Background(), event); err == nil {
		t.Error("a failed read was taken")
	}
	p.answer, p.err = password("pw"), nil
	if err := s.handle(context.Background(), event); err != nil || p.calls != 2 || len(bodies) != 1 {
		t.Errorf("%v, %d reads, %q", err, p.calls, bodies)
	}
}

func TestAParameterWithoutAValueIsAFailureNotAPanic(t *testing.T) {
	p := &parameters{answer: &ssm.GetParameterOutput{}}
	s := &shipper{env: "qa", parameters: p, parameter: "/taskfest/qa/monitoring-password",
		endpoint: "https://m.example.com", user: "u", client: http.DefaultClient}
	if err := s.handle(context.Background(), batch(t, "DATA_MESSAGE", "/aws/lambda/taskfest-qa-api", "x")); err == nil {
		t.Error("no password was taken as one")
	}
}

func TestCloudWatchsHealthCheckIsNotSent(t *testing.T) {
	var bodies []string
	p := &parameters{answer: password("pw")}
	s := &shipper{env: "qa", parameters: p, parameter: "/taskfest/qa/monitoring-password",
		endpoint: server(t, &bodies).URL, user: "u", client: http.DefaultClient}
	event := batch(t, "CONTROL_MESSAGE", "", "CWL CONTROL MESSAGE: Checking health of destination Lambda function.")
	if err := s.handle(context.Background(), event); err != nil || p.calls != 0 || len(bodies) != 0 {
		t.Errorf("%v, %d reads, %q", err, p.calls, bodies)
	}
}
