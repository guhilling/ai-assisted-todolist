package main

import "testing"

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
