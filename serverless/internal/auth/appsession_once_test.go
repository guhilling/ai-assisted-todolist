package auth

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestAnIDTokenIsTradedForOneAppSessionOnly(t *testing.T) {
	// "Once" is enforced, not only meant (#630): an ID token that leaked could otherwise be traded
	// for any number of thirty-day sessions while it is valid.
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	idToken := f.sign(nil)

	startApp(t, s, idToken)
	if _, err := s.StartAppSession(withBearer(idToken)); !errors.Is(err, ErrRefused) {
		t.Fatalf("a second trade of the same ID token: %v", err)
	}
	// A new sign-in brings a new ID token, which trades as the first did.
	startApp(t, s, f.sign(map[string]any{"iat": time.Now().Unix() + 1}))
}

func TestAnAppSessionEndsOnTheSecondItIsStoredWith(t *testing.T) {
	// The store keeps whole seconds; the end the app is told must be the end the backend keeps.
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	now := time.Date(2026, 11, 16, 9, 30, 0, 987654321, time.UTC)
	s.now = func() time.Time { return now }

	started := startApp(t, s, f.sign(nil))

	if want := now.Truncate(time.Second).Add(AppLifetime); !started.Ends.Equal(want) {
		t.Errorf("ends %v; want %v", started.Ends, want)
	}
}

func TestAnIDTokenSpelledAnotherWayIsTheSameToken(t *testing.T) {
	// Found by CodeRabbit on #630: go-jose strips whitespace before it checks a signature, and
	// base64url's last character carries bits nobody reads, so one token can be spelled in more
	// ways than one; each spelling must not trade for a session of its own.
	f := newFakeProvider(t)
	idToken := f.sign(nil)
	dot := strings.LastIndex(idToken, ".")
	signature := idToken[dot+1:]
	last := strings.IndexByte(base64URLAlphabet, signature[len(signature)-1])
	spellings := map[string]string{
		"with a space": idToken[:dot+11] + " " + idToken[dot+11:],
		"with unread bits set otherwise": idToken[:len(idToken)-1] +
			string(base64URLAlphabet[last^1]),
	}
	for name, spelling := range spellings {
		t.Run(name, func(t *testing.T) {
			// The spelling is a valid token in its own right, or this test would prove nothing.
			fresh, _ := serviceFor(f)
			startApp(t, fresh, spelling)

			s, _ := serviceFor(f)
			startApp(t, s, idToken)
			if _, err := s.StartAppSession(withBearer(spelling)); !errors.Is(err, ErrRefused) {
				t.Fatalf("the same ID token spelled %s traded again: %v", name, err)
			}
		})
	}
}

func TestATradedIDTokenIsRememberedUntilItExpires(t *testing.T) {
	// Found by CodeRabbit on #630: a provider whose ID tokens last longer than the day a trade is
	// remembered would otherwise see the same token traded again once the day is over.
	f := newFakeProvider(t)
	expires := time.Now().Add(72 * time.Hour).Truncate(time.Second)
	s, store := serviceFor(f)

	startApp(t, s, f.sign(map[string]any{"exp": expires.Unix()}))

	if len(store.claimed) != 1 {
		t.Fatalf("%d claims; want 1", len(store.claimed))
	}
	for _, until := range store.claimed {
		if until.Before(expires) {
			t.Errorf("remembered until %v; the token is valid until %v", until, expires)
		}
	}
}

func TestATradeIsRememberedForADayAtLeast(t *testing.T) {
	f := newFakeProvider(t)
	s, store := serviceFor(f)
	now := time.Now()
	s.now = func() time.Time { return now }

	startApp(t, s, f.sign(map[string]any{"exp": now.Add(10 * time.Minute).Unix()}))

	for _, until := range store.claimed {
		if until.Before(now.Add(idTokenClaimLifetime)) {
			t.Errorf("remembered until %v; want a day at least", until)
		}
	}
}

// base64URLAlphabet is base64url's, in the order of the values its characters stand for.
const base64URLAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
