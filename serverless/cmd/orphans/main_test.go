package main

import "testing"

func TestTheTableAndTheBucketAreBothLocalOrBothReal(t *testing.T) {
	// One local and one real would compare a table with a bucket it does not describe, and
	// delete files of the real one (CodeRabbit on #571).
	for _, c := range []struct {
		dynamo, s3 string
		ok         bool
	}{{"", "", true}, {"http://localhost:8000", "http://localhost:4566", true},
		{"http://localhost:8000", "", false}, {"", "http://localhost:4566", false}} {
		env := map[string]string{"DYNAMODB_ENDPOINT": c.dynamo, "S3_ENDPOINT": c.s3}
		if err := endpoints(func(k string) string { return env[k] }); (err == nil) != c.ok {
			t.Errorf("%+v: %v", c, err)
		}
	}
}
