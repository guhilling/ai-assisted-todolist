package main

import "testing"

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
