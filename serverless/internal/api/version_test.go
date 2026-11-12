package api

import (
	"encoding/json"
	"net/http"
	"os"
	"regexp"
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

	if got, err := MinimumAppVersionIn(unset); got != "1.4.0" || err != nil {
		t.Errorf("unset: %q, %v", got, err)
	}
	if got, err := MinimumAppVersionIn(set); got != "2.0.0" || err != nil {
		t.Errorf("set: %q, %v", got, err)
	}
}

func TestAMinimumAppVersionTheAppCannotReadIsRefused(t *testing.T) {
	// The app reads only x.y.z; anything else would quietly never ask anyone to update.
	for _, bad := range []string{"1.5", " 1.5.0", "v1.5.0", "1.5.0-beta"} {
		if _, err := MinimumAppVersionIn(func(string) string { return bad }); err == nil {
			t.Errorf("%q was taken", bad)
		}
	}
}

func TestTheDefaultMinimumAppVersionIsQuarkuses(t *testing.T) {
	// Both backends announce it while both run; raising one alone would let one serve apps the
	// other turns away.
	raw, err := os.ReadFile("../../../backend/src/main/resources/application.properties")
	if err != nil {
		t.Fatal(err)
	}
	quarkus := regexp.MustCompile(`(?m)^taskfest\.minimum-app-version=\$\{TASKFEST_MINIMUM_APP_VERSION:([^}]+)\}$`).
		FindSubmatch(raw)
	if quarkus == nil || string(quarkus[1]) != minimumAppVersion {
		t.Errorf("Quarkus's default is %q, the Go backend's %q", quarkus, minimumAppVersion)
	}
}
