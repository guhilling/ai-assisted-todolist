package auth

import (
	"errors"
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
