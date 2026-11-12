package api

import (
	"fmt"
	"net/http"
	"regexp"
)

// minimumAppVersion is the oldest app release served unless TASKFEST_MINIMUM_APP_VERSION says
// otherwise: the Quarkus backend's own default (taskfest.minimum-app-version), kept in step by
// hand while both backends run.
const minimumAppVersion = "1.4.0"

// appVersion is the only form the app reads a version in (mobile/src/appVersion.ts).
var appVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)

// MinimumAppVersionIn is the oldest app release this deployment serves, by the environment as
// getenv reads it (#268): an older app asks its user to update. A value the app could not read is
// an error, since it would silently never ask anyone to update.
func MinimumAppVersionIn(getenv func(string) string) (string, error) {
	v := getenv("TASKFEST_MINIMUM_APP_VERSION")
	if v == "" {
		return minimumAppVersion, nil
	}
	if !appVersion.MatchString(v) {
		return "", fmt.Errorf("TASKFEST_MINIMUM_APP_VERSION %q is no x.y.z version", v)
	}
	return v, nil
}

// GetApiVersion says which release this is and the oldest app it serves, to anyone who asks:
// the release workflow reads it without credentials (#215), the app before anyone signs in.
func (s *Server) GetApiVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(r.Context(), w, http.StatusOK, VersionResponse{Version: s.Version, MinimumAppVersion: s.MinimumAppVersion})
}
