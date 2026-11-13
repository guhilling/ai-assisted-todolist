package main

import (
	"strings"
	"testing"
)

func TestTheReplayNeedsItsTableAndBucketAndMatchingEndpoints(t *testing.T) {
	for name, env := range map[string]map[string]string{
		"no table":     {"TASKFEST_ATTACHMENTS_BUCKET": "b"},
		"no bucket":    {"TABLE_NAME": "t"},
		"local table":  {"TABLE_NAME": "t", "TASKFEST_ATTACHMENTS_BUCKET": "b", "DYNAMODB_ENDPOINT": "http://localhost:8000"},
		"local bucket": {"TABLE_NAME": "t", "TASKFEST_ATTACHMENTS_BUCKET": "b", "S3_ENDPOINT": "http://localhost:4566"},
	} {
		if settings(func(k string) string { return env[k] }) == nil {
			t.Errorf("%s: started", name)
		}
	}
	both := map[string]string{"TABLE_NAME": "t", "TASKFEST_ATTACHMENTS_BUCKET": "b",
		"DYNAMODB_ENDPOINT": "http://localhost:8000", "S3_ENDPOINT": "http://localhost:4566"}
	if err := settings(func(k string) string { return both[k] }); err != nil {
		t.Error(err)
	}
}

func TestTheMFACodeIsAskedForOnStandardErrorAndReadAsOneLine(t *testing.T) {
	var prompt strings.Builder
	code, err := mfaCode(strings.NewReader(" 123456 \nmore\n"), &prompt)()
	if err != nil || code != "123456" {
		t.Errorf("read %q, %v", code, err)
	}
	if !strings.Contains(prompt.String(), "MFA") {
		t.Errorf("asked %q", prompt.String())
	}
	if _, err := mfaCode(strings.NewReader(""), &prompt)(); err == nil {
		t.Error("no code was taken as one")
	}
}
