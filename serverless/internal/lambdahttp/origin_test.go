package lambdahttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// served answers 204, so a test can tell a request let through from one refused.
var served = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })

func through(t *testing.T, h http.Handler, header string) int {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	if header != "" {
		r.Header.Set(OriginHeader, header)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code
}

func TestARequestCarryingCloudFrontsSecretIsServed(t *testing.T) {
	if got := through(t, FromOrigin("s3cret", served), "s3cret"); got != http.StatusNoContent {
		t.Errorf("status %d", got)
	}
}

func TestARequestWithoutTheSecretIsRefused(t *testing.T) {
	if got := through(t, FromOrigin("s3cret", served), ""); got != http.StatusForbidden {
		t.Errorf("status %d", got)
	}
}

func TestARequestWithAnotherSecretIsRefused(t *testing.T) {
	for _, wrong := range []string{"s3cre", "s3cret2", "S3CRET"} {
		if got := through(t, FromOrigin("s3cret", served), wrong); got != http.StatusForbidden {
			t.Errorf("%q: status %d", wrong, got)
		}
	}
}

func TestAnEmptySecretRefusesEveryRequest(t *testing.T) {
	// A request without the header carries an empty one, which would match an empty secret.
	if got := through(t, FromOrigin("", served), ""); got != http.StatusForbidden {
		t.Errorf("status %d", got)
	}
}
