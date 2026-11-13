package logship

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

var at = time.Date(2026, 11, 13, 18, 30, 0, 0, time.UTC)

func event(message string) Line {
	return Line{Timestamp: at.UnixMilli(), Message: message}
}

func one(t *testing.T, group, message string) Record {
	t.Helper()
	records := Convert("qa", group, []Line{event(message)})
	if len(records) != 1 {
		t.Fatalf("%d records from %q", len(records), message)
	}
	return records[0]
}

func TestEachRecordIsLabelledWithTheProjectTheEnvironmentAndWhereItCameFrom(t *testing.T) {
	for group, source := range map[string]string{
		"/aws/lambda/taskfest-qa-api":     "api",
		"/aws/lambda/taskfest-qa-streams": "streams",
		"/aws/apigateway/taskfest-qa-api": "api-access",
	} {
		r := one(t, group, "plain words")
		if r["project"] != "taskfest" || r["env"] != "qa" || r["source"] != source {
			t.Errorf("%s: %v", group, r)
		}
		if r["_time"] != "2026-11-13T18:30:00Z" || r["_msg"] != "plain words" {
			t.Errorf("%s: %v", group, r)
		}
	}
}

func TestAJSONLogLineKeepsItsFieldsAndItsMessage(t *testing.T) {
	r := one(t, "/aws/lambda/taskfest-qa-api",
		`{"time":"2026-11-13T18:29:59Z","level":"WARN","msg":"asking Gravatar failed","error":"timeout"}`+"\n")
	if r["_msg"] != "asking Gravatar failed" || r["level"] != "WARN" || r["error"] != "timeout" {
		t.Errorf("%v", r)
	}
	if _, kept := r["time"]; kept {
		t.Errorf("the line's own time is kept beside _time: %v", r)
	}
}

func TestAJSONLineCannotOverwriteTheLabels(t *testing.T) {
	r := one(t, "/aws/lambda/taskfest-qa-api", `{"msg":"m","env":"prod","source":"x","project":"y"}`)
	if r["env"] != "qa" || r["source"] != "api" || r["project"] != "taskfest" {
		t.Errorf("%v", r)
	}
}

func TestTheAccessLogBecomesARouteAStatusAndALatency(t *testing.T) {
	r := one(t, "/aws/apigateway/taskfest-qa-api",
		`{"requestId":"r1","time":"13/Nov/2026:18:30:00 +0000","method":"PUT",`+
			`"path":"/api/tasks/01JC8Z/attachments/9f1c/confirm","status":"200","latency":"42","error":"-"}`)
	want := Record{"route": "/api/tasks/{id}/attachments/{id}/confirm", "method": "PUT", "status": "200",
		"latencyMs": 42, "requestId": "r1", "_msg": "PUT /api/tasks/{id}/attachments/{id}/confirm 200"}
	for k, v := range want {
		if r[k] != v {
			t.Errorf("%s: %v, not %v", k, r[k], v)
		}
	}
	for _, k := range []string{"path", "error", "time", "latency"} {
		if _, kept := r[k]; kept {
			t.Errorf("%s kept: %v", k, r)
		}
	}
}

func TestARouteKeepsItsWordsAndHidesItsIds(t *testing.T) {
	for path, route := range map[string]string{
		"/api/tasks":                                 "/api/tasks",
		"/api/tasks/drafts":                          "/api/tasks/drafts",
		"/api/tasks/drafts/abc/add":                  "/api/tasks/drafts/{id}/add",
		"/api/tasks/12/attachments/links":            "/api/tasks/{id}/attachments/links",
		"/api/tasks/12/attachments/x/thumbnail-link": "/api/tasks/{id}/attachments/{id}/thumbnail-link",
		"/api/auth/login/google":                     "/api/auth/login/google",
		"/api/tasks/12/":                             "/api/tasks/{id}/",
	} {
		if got := Route(path); got != route {
			t.Errorf("%s: %s, not %s", path, got, route)
		}
	}
}

func TestAReportLineBecomesTheInvocationsFigures(t *testing.T) {
	r := one(t, "/aws/lambda/taskfest-qa-api", "REPORT RequestId: r2\tDuration: 12.34 ms\t"+
		"Billed Duration: 13 ms\tMemory Size: 512 MB\tMax Memory Used: 40 MB\tInit Duration: 80.5 ms\t\n")
	want := Record{"requestId": "r2", "durationMs": 12.34, "billedDurationMs": 13.0, "memorySizeMB": 512.0,
		"maxMemoryUsedMB": 40.0, "initDurationMs": 80.5, "_msg": "REPORT"}
	for k, v := range want {
		if r[k] != v {
			t.Errorf("%s: %v (%T), not %v", k, r[k], r[k], v)
		}
	}
}

func TestAReportLineSaysWhenAnInvocationDidNotEndWell(t *testing.T) {
	r := one(t, "/aws/lambda/taskfest-qa-api", "REPORT RequestId: r4\tDuration: 30000.00 ms\t"+
		"Billed Duration: 30000 ms\tMemory Size: 512 MB\tMax Memory Used: 60 MB\tStatus: timeout\n")
	if r["invocationStatus"] != "timeout" || r["durationMs"] != 30000.0 {
		t.Errorf("%v", r)
	}
}

func TestStartEndAndInitLinesAreLeftOut(t *testing.T) {
	records := Convert("qa", "/aws/lambda/taskfest-qa-api", []Line{
		event("START RequestId: r3 Version: 4\n"),
		event("END RequestId: r3\n"),
		event("INIT_START Runtime Version: provided:al2023.v100\tRuntime Version ARN: x\n"),
	})
	if len(records) != 0 {
		t.Errorf("%v", records)
	}
}

func TestLinesAreOneJSONObjectEach(t *testing.T) {
	body, err := Lines([]Record{{"_msg": "a"}, {"_msg": "b"}})
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(string(body), "\n"), "\n")
	if len(lines) != 2 || !json.Valid([]byte(lines[0])) || !json.Valid([]byte(lines[1])) {
		t.Errorf("%q", body)
	}
}

func TestSendPostsToVictoriaLogsWithItsStreamFieldsAndBasicAuth(t *testing.T) {
	var got *http.Request
	var body string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		b, _ := io.ReadAll(r.Body)
		body = string(b)
	}))
	defer server.Close()
	s := Sender{Client: server.Client(), Endpoint: server.URL + "/", User: "taskfest-qa", Password: "pw"}
	if err := s.Send(context.Background(), []byte("{}\n")); err != nil {
		t.Fatal(err)
	}
	user, password, ok := got.BasicAuth()
	if !ok || user != "taskfest-qa" || password != "pw" {
		t.Errorf("auth %q %q %v", user, password, ok)
	}
	q := got.URL.Query()
	if got.Method != http.MethodPost || got.URL.Path != "/insert/jsonline" ||
		q.Get("_stream_fields") != "project,env,source" || q.Get("_time_field") != "_time" ||
		q.Get("_msg_field") != "_msg" || body != "{}\n" {
		t.Errorf("%s %s %q", got.Method, got.URL, body)
	}
}

func TestSendFailsWhenVictoriaLogsRefuses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	s := Sender{Client: server.Client(), Endpoint: server.URL, User: "u", Password: "p"}
	if err := s.Send(context.Background(), []byte("{}\n")); err == nil {
		t.Error("a 401 was taken")
	}
}
