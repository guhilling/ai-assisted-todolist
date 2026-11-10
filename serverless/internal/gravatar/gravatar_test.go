package gravatar

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestTheURLIsTheTrimmedLowerCasedAddressHashed(t *testing.T) {
	a := URL(DefaultBase, " Person@Example.com ")
	b := URL(DefaultBase, "person@example.com")

	if a != b || !strings.HasPrefix(a, DefaultBase) || !strings.HasSuffix(a, "?d=404&s=200") {
		t.Errorf("got %q and %q", a, b)
	}
	if strings.Contains(a, "person") {
		t.Error("the address itself is in the URL")
	}
}

func gravatarAnswering(status int, asked *atomic.Int32) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked.Add(1)
		if r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(status)
	}))
}

func TestAPictureThatExistsIsFoundAndRemembered(t *testing.T) {
	var asked atomic.Int32
	srv := gravatarAnswering(http.StatusOK, &asked)
	defer srv.Close()
	g := New(true, srv.URL+"/avatar/")

	first := g.Lookup(context.Background(), "person@example.com")
	second := g.Lookup(context.Background(), "person@example.com")

	if first == "" || first != second || !strings.HasPrefix(first, srv.URL) {
		t.Errorf("got %q then %q", first, second)
	}
	if asked.Load() != 1 {
		t.Errorf("asked Gravatar %d times; want once", asked.Load())
	}
}

func TestNoPictureIsNoAnswerAndRememberedToo(t *testing.T) {
	var asked atomic.Int32
	srv := gravatarAnswering(http.StatusNotFound, &asked)
	defer srv.Close()
	g := New(true, srv.URL+"/avatar/")

	if got := g.Lookup(context.Background(), "person@example.com"); got != "" {
		t.Errorf("got %q", got)
	}
	g.Lookup(context.Background(), "person@example.com")
	if asked.Load() != 1 {
		t.Errorf("asked %d times", asked.Load())
	}
}

func TestAFailureIsNoPictureButNotRemembered(t *testing.T) {
	var asked atomic.Int32
	srv := gravatarAnswering(http.StatusServiceUnavailable, &asked)
	defer srv.Close()
	g := New(true, srv.URL+"/avatar/")

	if got := g.Lookup(context.Background(), "person@example.com"); got != "" {
		t.Errorf("got %q", got)
	}
	g.Lookup(context.Background(), "person@example.com")
	if asked.Load() != 2 {
		t.Errorf("asked %d times; a failure must be asked again", asked.Load())
	}
}

func TestBeingToldToSlowDownIsNoAnswer(t *testing.T) {
	var asked atomic.Int32
	srv := gravatarAnswering(http.StatusTooManyRequests, &asked)
	defer srv.Close()
	g := New(true, srv.URL+"/avatar/")

	if got := g.Lookup(context.Background(), "person@example.com"); got != "" {
		t.Errorf("got %q", got)
	}
	g.Lookup(context.Background(), "person@example.com")
	if asked.Load() != 2 {
		t.Errorf("asked %d times; only a 200 or a 404 is an answer", asked.Load())
	}
}

func TestAnUnreachableGravatarIsNoPicture(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	srv.Close()

	if got := New(true, srv.URL+"/avatar/").Lookup(context.Background(), "person@example.com"); got != "" {
		t.Errorf("got %q", got)
	}
}

func TestSwitchedOffItNeverAsks(t *testing.T) {
	var asked atomic.Int32
	srv := gravatarAnswering(http.StatusOK, &asked)
	defer srv.Close()

	if got := New(false, srv.URL+"/avatar/").Lookup(context.Background(), "person@example.com"); got != "" || asked.Load() != 0 {
		t.Errorf("got %q after %d requests", got, asked.Load())
	}
}
