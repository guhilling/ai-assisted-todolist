// Package logship sends an environment's logs to the shared monitoring server's VictoriaLogs
// (#508), where Perses shows them beside its other workloads. CloudWatch Logs hands each batch of
// the functions' and the HTTP API's log lines to cmd/logship through a subscription filter;
// CloudWatch keeps them as before, for the alarms' metric filters and as the record.
//
// Each line becomes one JSON object for VictoriaLogs' jsonline API, labelled with the project,
// the environment and its source, which are the stream. The Go backend publishes no metrics, so
// what the dashboard draws comes from the lines themselves: the access log's route, status and
// latency, and the figures of each invocation's REPORT line. A route names its ids {id}, so the
// dashboard can group requests by it. The rest of a JSON line is kept as it was: the ids of the
// tasks and attachments some lines name, and the sign-in's `user`, which is why the privacy texts
// name the server.
package logship

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Line is one log line as CloudWatch Logs hands it over: when it was written, in milliseconds
// since the epoch, and what.
type Line struct {
	Timestamp int64
	Message   string
}

// Record is one log line as VictoriaLogs takes it: _time and _msg, and fields beside them.
type Record map[string]any

// labels are the fields that say where a line came from; nothing in the line can overwrite them.
var labels = []string{"project", "env", "source"}

// Convert turns one batch of logGroup's lines into records, leaving out the lines that only mark
// an invocation's start and end.
func Convert(env, logGroup string, lines []Line) []Record {
	source := Source(logGroup)
	records := make([]Record, 0, len(lines))
	for _, line := range lines {
		message := strings.TrimRight(line.Message, "\n")
		if noise(message) {
			continue
		}
		var r Record
		switch {
		case source == "api-access":
			r = access(message)
		case strings.HasPrefix(message, "REPORT "):
			r = report(message)
		default:
			r = plain(message)
		}
		r["_time"] = time.UnixMilli(line.Timestamp).UTC().Format(time.RFC3339Nano)
		r["project"], r["env"], r["source"] = "taskfest", env, source
		records = append(records, r)
	}
	return records
}

// Source names a log group by what writes to it: a function by its short name, the HTTP API's
// access log as api-access.
func Source(logGroup string) string {
	if strings.HasPrefix(logGroup, "/aws/apigateway/") {
		return "api-access"
	}
	name := logGroup[strings.LastIndex(logGroup, "/")+1:]
	// taskfest-<env>-<function>
	if parts := strings.SplitN(name, "-", 3); len(parts) == 3 && parts[0] == "taskfest" {
		return parts[2]
	}
	return name
}

func noise(message string) bool {
	return strings.HasPrefix(message, "START RequestId: ") || strings.HasPrefix(message, "END RequestId: ") ||
		strings.HasPrefix(message, "INIT_START ")
}

// plain keeps a JSON line's fields, its msg as the message, or takes any other line as it is.
func plain(message string) Record {
	var fields map[string]any
	if json.Unmarshal([]byte(message), &fields) != nil {
		return Record{"_msg": message}
	}
	r := Record{"_msg": message}
	for k, v := range fields {
		r[k] = v
	}
	if msg, ok := fields["msg"].(string); ok {
		r["_msg"] = msg
		delete(r, "msg")
	}
	delete(r, "time")
	for _, k := range labels {
		delete(r, k)
	}
	return r
}

// access is a line of the HTTP API's access log (serverless.tf): the path becomes its route, and
// the latency a number.
func access(message string) Record {
	var line struct {
		RequestID string `json:"requestId"`
		Method    string `json:"method"`
		Path      string `json:"path"`
		Status    string `json:"status"`
		Latency   string `json:"latency"`
		Error     string `json:"error"`
	}
	if json.Unmarshal([]byte(message), &line) != nil {
		return Record{"_msg": message}
	}
	route := Route(line.Path)
	r := Record{"_msg": line.Method + " " + route + " " + line.Status, "requestId": line.RequestID,
		"method": line.Method, "route": route, "status": line.Status}
	if latency, err := strconv.Atoi(line.Latency); err == nil {
		r["latencyMs"] = latency
	}
	if line.Error != "" && line.Error != "-" {
		r["error"] = line.Error
	}
	return r
}

// owners are the path words whose next segment is an id, and words the ids that follow them,
// which are part of the route.
var (
	owners = map[string]bool{"tasks": true, "drafts": true, "attachments": true}
	words  = map[string]bool{"drafts": true, "links": true}
)

// Route is a path with its ids replaced by {id}: /api/tasks/{id}/attachments/{id}/confirm.
func Route(path string) string {
	segments := strings.Split(path, "/")
	for i := 1; i < len(segments); i++ {
		if owners[segments[i-1]] && segments[i] != "" && !words[segments[i]] {
			segments[i] = "{id}"
		}
	}
	return strings.Join(segments, "/")
}

// reportFields are the figures of a REPORT line, by the name the dashboard uses.
var reportFields = map[string]string{
	"Duration":        "durationMs",
	"Billed Duration": "billedDurationMs",
	"Memory Size":     "memorySizeMB",
	"Max Memory Used": "maxMemoryUsedMB",
	"Init Duration":   "initDurationMs",
}

// reportWords are the REPORT line's fields that are words: how an invocation that did not end
// well ended, such as timeout.
var reportWords = map[string]string{
	"Status":     "invocationStatus",
	"Error Type": "errorType",
}

// report is the line Lambda writes after each invocation: its time, what was billed, its memory,
// and on a cold start how long the start took.
func report(message string) Record {
	r := Record{"_msg": "REPORT"}
	for _, part := range strings.Split(strings.TrimPrefix(message, "REPORT "), "\t") {
		key, value, ok := strings.Cut(part, ": ")
		if !ok {
			continue
		}
		if key == "RequestId" {
			r["requestId"] = value
			continue
		}
		if name, ok := reportWords[key]; ok {
			r[name] = value
			continue
		}
		name, known := reportFields[key]
		number, _, _ := strings.Cut(value, " ")
		if f, err := strconv.ParseFloat(number, 64); known && err == nil {
			r[name] = f
		}
	}
	return r
}

// Lines is records as VictoriaLogs' jsonline API takes them, one JSON object a line.
func Lines(records []Record) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	for _, r := range records {
		if err := enc.Encode(r); err != nil {
			return nil, err
		}
	}
	return b.Bytes(), nil
}

// Sender posts lines to the monitoring server, which takes them only with this sender's password
// (the server's Caddy, guhilling/monitoring).
type Sender struct {
	Client   *http.Client
	Endpoint string
	User     string
	Password string
}

// Send posts one batch, and fails unless VictoriaLogs took it.
func (s Sender) Send(ctx context.Context, body []byte) error {
	query := url.Values{"_stream_fields": {strings.Join(labels, ",")}, "_time_field": {"_time"}, "_msg_field": {"_msg"}}
	target := strings.TrimSuffix(s.Endpoint, "/") + "/insert/jsonline?" + query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/stream+json")
	req.SetBasicAuth(s.User, s.Password)
	resp, err := s.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("the monitoring server answered %s", resp.Status)
	}
	return nil
}
