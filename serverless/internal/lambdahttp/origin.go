package lambdahttp

import (
	"crypto/subtle"
	"net/http"
)

// OriginHeader is the header CloudFront adds to every request it sends to the HTTP API (#554).
const OriginHeader = "X-Origin-Verify"

// FromOrigin serves only the requests that carry secret in OriginHeader, which CloudFront adds,
// and refuses the rest with 403: the HTTP API's own address is public, and a request sent to it
// directly would bypass what CloudFront does in front of it. The comparison takes the same time
// whatever the header holds, so the secret cannot be guessed a character at a time. An empty
// secret refuses everything, since a request without the header would match it.
func FromOrigin(secret string, next http.Handler) http.Handler {
	want := []byte(secret)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(want) == 0 || subtle.ConstantTimeCompare([]byte(r.Header.Get(OriginHeader)), want) != 1 {
			http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
