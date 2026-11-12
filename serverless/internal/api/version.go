package api

import (
	"net/http"
)

// minimumAppVersion is the oldest app release served unless TASKFEST_MINIMUM_APP_VERSION says
// otherwise: the Quarkus backend's own default (taskfest.minimum-app-version), kept in step by
// hand while both backends run.
const minimumAppVersion = "1.4.0"

// MinimumAppVersionIn is the oldest app release this deployment serves, by the environment as
// getenv reads it (#268): an older app asks its user to update.
func MinimumAppVersionIn(getenv func(string) string) string {
	if v := getenv("TASKFEST_MINIMUM_APP_VERSION"); v != "" {
		return v
	}
	return minimumAppVersion
}

// GetApiVersion says which release this is and the oldest app it serves, to anyone who asks:
// the release workflow reads it without credentials (#215), the app before anyone signs in.
func (s *Server) GetApiVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(r.Context(), w, http.StatusOK, VersionResponse{Version: s.Version, MinimumAppVersion: s.MinimumAppVersion})
}
