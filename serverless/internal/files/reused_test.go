package files

import (
	"fmt"
	"testing"
	"time"
)

// ReusedLinksTest, case for case: a link handed out again while it is fresh (#236), so the
// browser's cache, which is keyed by the URL, keeps what it fetched.

var (
	noon     = time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	lifetime = time.Hour
)

type signer struct{ signed int }

func (s *signer) at(when time.Time) func() (Link, error) {
	return func() (Link, error) {
		s.signed++
		return Link{URL: fmt.Sprintf("https://bucket/x?n=%d", s.signed), ExpiresAt: when.Add(lifetime)}, nil
	}
}

func get(r *reused, key string, now time.Time, sign func() (Link, error)) Link {
	link, _ := r.get(key, now, sign)
	return link
}

func TestTheSameLinkIsHandedOutWhileAtLeastHalfItsLifetimeIsLeft(t *testing.T) {
	r, s := newReused(lifetime), &signer{}

	first := get(r, "key", noon, s.at(noon))
	later := get(r, "key", noon.Add(30*time.Minute), s.at(noon))

	if first.URL != later.URL || s.signed != 1 {
		t.Errorf("%v, %v, signed %d", first, later, s.signed)
	}
}

func TestANewLinkIsSignedOnceLessThanHalfIsLeft(t *testing.T) {
	r, s := newReused(lifetime), &signer{}
	first := get(r, "key", noon, s.at(noon))

	then := noon.Add(31 * time.Minute)
	if get(r, "key", then, s.at(then)).URL == first.URL {
		t.Error("reused")
	}
}

func TestEachObjectsLinkIsKeptApart(t *testing.T) {
	r, s := newReused(lifetime), &signer{}

	if get(r, "one", noon, s.at(noon)).URL == get(r, "two", noon, s.at(noon)).URL {
		t.Error("shared")
	}
}

func TestTheBrowserMayKeepTheAnswerUntilTheLinkWouldBeSignedAnew(t *testing.T) {
	r, s := newReused(lifetime), &signer{}
	link := get(r, "key", noon, s.at(noon))

	for after, want := range map[time.Duration]time.Duration{0: 30 * time.Minute,
		20 * time.Minute: 10 * time.Minute, 45 * time.Minute: 0} {
		if got := KeepFor(link, noon.Add(after)); got != want {
			t.Errorf("after %v: %v; want %v", after, got, want)
		}
	}
}

func TestExpiredLinksAreForgottenAndTheRestKept(t *testing.T) {
	r, s := newReused(lifetime), &signer{}
	get(r, "old", noon, s.at(noon))
	later := noon.Add(50 * time.Minute)
	get(r, "new", later, s.at(later))

	r.forgetExpired(noon.Add(61 * time.Minute))

	if len(r.links) != 1 {
		t.Errorf("%d kept", len(r.links))
	}
}

func TestALinkWhoseCredentialsExpireSoonIsNeitherReusedNorKept(t *testing.T) {
	// A presigned URL dies with the session that signed it: one signed ten minutes before the
	// credentials rotate says so in its expiry, and is signed anew.
	r, s := newReused(lifetime), &signer{}
	soon := get(r, "key", noon, func() (Link, error) {
		return Link{URL: "https://short", ExpiresAt: noon.Add(10 * time.Minute)}, nil
	})

	if KeepFor(soon, noon) != 0 {
		t.Error("kept")
	}
	if get(r, "key", noon, s.at(noon)).URL == soon.URL {
		t.Error("reused")
	}
}

func TestTidyingThatFreesNothingRaisesTheMark(t *testing.T) {
	// So a busy backend does not scan on every request while many links are still fresh.
	r, s := newReused(lifetime), &signer{}
	for i := 0; i <= 1000; i++ {
		get(r, fmt.Sprintf("fresh-%d", i), noon, s.at(noon))
	}
	get(r, "one-more", noon, s.at(noon))

	if r.tidyAbove != 2002 {
		t.Error(r.tidyAbove)
	}
}

func TestExpiredLinksAreClearedOutOnceThereAreMany(t *testing.T) {
	r, s := newReused(lifetime), &signer{}
	for i := 0; i <= 1000; i++ {
		get(r, fmt.Sprintf("old-%d", i), noon, s.at(noon))
	}
	muchLater := noon.Add(2 * time.Hour)

	get(r, "new", muchLater, s.at(muchLater))

	if len(r.links) != 1 {
		t.Errorf("%d kept", len(r.links))
	}
}

func TestNothingIsClearedOutWhileThereAreFew(t *testing.T) {
	r, s := newReused(lifetime), &signer{}
	for i := 0; i < 1000; i++ {
		get(r, fmt.Sprintf("old-%d", i), noon, s.at(noon))
	}
	muchLater := noon.Add(2 * time.Hour)

	get(r, "new", muchLater, s.at(muchLater))

	if len(r.links) != 1001 {
		t.Errorf("%d kept", len(r.links))
	}
}
