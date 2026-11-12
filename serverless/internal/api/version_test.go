package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestTheVersionIsAnsweredToAnyoneAsTheContractSays(t *testing.T) {
	// Public, as in Quarkus: the release workflow asks it without credentials (#215), and the app
	// before anyone signs in (#268).
	rec := get(&Server{Caller: nobody, Version: "1.2.3", MinimumAppVersion: "1.4.0"}, "/api/version")

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d", rec.Code)
	}
	loadContract(t).checkResponse(t, "GET", "/api/version", rec.Code, rec.Body.Bytes())
	var got VersionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil ||
		got != (VersionResponse{Version: "1.2.3", MinimumAppVersion: "1.4.0"}) {
		t.Errorf("answered %s", rec.Body.String())
	}
}

func TestTheMinimumAppVersionIsQuarkusesUnlessSet(t *testing.T) {
	unset := func(string) string { return "" }
	set := func(name string) string {
		if name == "TASKFEST_MINIMUM_APP_VERSION" {
			return "2.0.0"
		}
		return ""
	}

	if got := MinimumAppVersionIn(unset); got != "1.4.0" {
		t.Errorf("unset: %q", got)
	}
	if got := MinimumAppVersionIn(set); got != "2.0.0" {
		t.Errorf("set: %q", got)
	}
}
