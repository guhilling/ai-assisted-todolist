package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// fakeDeleter is the account deletion as the callback hands a confirmed one on: it records whose
// account it was asked to delete, and revokes as the real one does once the account is marked.
type fakeDeleter struct {
	deleted []string
	fail    error
}

func (d *fakeDeleter) DeleteAccount(ctx context.Context, email string, revocation Revocation) error {
	if d.fail != nil {
		return d.fail
	}
	d.deleted = append(d.deleted, email)
	return revocation(ctx)
}

// websiteAppleSession is a deployment offering Apple beside its main provider, and a browser
// signed in to the website with Apple.
func websiteAppleSession(t *testing.T) (*Service, *fakeApple, *fakeDeleter, *browser) {
	t.Helper()
	apple := newFakeApple(t)
	s, store := serviceFor(newFakeProvider(t), apple.provider())
	s.cfg.SecureCookies = true
	d := &fakeDeleter{}
	s.DeleteAccountsWith(d)
	now := time.Now()
	err := store.PutSession(context.Background(), hash("website-session"), Session{
		Identity: identity.Identity{Email: "person@example.com", Provider: "apple", Subject: "apple-subject"},
		Created:  now, LastSeen: now,
	}, expiry(now, now))
	if err != nil {
		t.Fatal(err)
	}
	b := newBrowser()
	b.cookies[SessionCookie] = &http.Cookie{Name: SessionCookie, Value: "website-session"}
	return s, apple, d, b
}

// confirmAtApple asks where the browser confirms deleting its account, and returns what Apple is
// asked for there.
func confirmAtApple(t *testing.T, s *Service, b *browser) url.Values {
	t.Helper()
	var at string
	res := b.do(func(w http.ResponseWriter, r *http.Request) {
		var err error
		if at, err = s.ConfirmDeletionAtApple(w, r, "person@example.com"); err != nil {
			t.Fatal(err)
		}
	}, b.request("DELETE", "/api/account"))
	_ = res.Body.Close()
	to, err := url.Parse(at)
	if err != nil || at == "" {
		t.Fatalf("confirm at %q, %v; want Apple's sign-in", at, err)
	}
	return to.Query()
}

// appleCallback posts Apple's answer to the website's callback, as Apple's page does.
func appleCallback(s *Service, b *browser, code, state string) *http.Response {
	return b.post(func(w http.ResponseWriter, r *http.Request) { s.Callback(w, r, "apple") },
		MainCallbackPath+"/apple", url.Values{"code": {code}, "state": {state}})
}

func TestTheWebsiteDeletesAnAppleAccountOnceAppleConfirmsItAndRevokesTheWebsitesToken(t *testing.T) {
	s, apple, d, b := websiteAppleSession(t)

	asked := confirmAtApple(t, s, b)
	if asked.Get("client_id") != "services-id" || asked.Get("response_mode") != "form_post" ||
		asked.Get("nonce") == "" || b.cookies[SignInCookie] == nil {
		t.Fatalf("asked Apple %v, cookies %v; want the website's own sign-in", asked, b.cookies)
	}
	apple.codes["code-1"] = appleCode{client: "services-id", subject: "apple-subject",
		nonce: asked.Get("nonce"), email: "person@example.com"}

	res := appleCallback(s, b, "code-1", asked.Get("state"))

	if len(d.deleted) != 1 || d.deleted[0] != "person@example.com" {
		t.Errorf("deleted %v; want the account Apple confirmed", d.deleted)
	}
	if len(apple.revoked) != 1 || apple.revoked[0].Get("token") != "refresh-1" ||
		apple.revoked[0].Get("client_id") != "services-id" {
		t.Errorf("revoked %v; want the refresh token revoked as the website's client", apple.revoked)
	}
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "/" {
		t.Errorf("got %d to %q; want back to the app", res.StatusCode, res.Header.Get("Location"))
	}
	if b.cookies[SessionCookie] != nil || b.cookies[SignInCookie] != nil {
		t.Errorf("cookies %v; want the session and the sign-in cleared", b.cookies)
	}
}

func TestAnotherAppleIDsConfirmationOnTheWebsiteDeletesNothing(t *testing.T) {
	s, apple, d, b := websiteAppleSession(t)
	asked := confirmAtApple(t, s, b)
	apple.codes["code-1"] = appleCode{client: "services-id", subject: "someone-else",
		nonce: asked.Get("nonce"), email: "someone@example.com"}

	res := appleCallback(s, b, "code-1", asked.Get("state"))

	if len(d.deleted) != 0 || len(apple.revoked) != 0 {
		t.Errorf("deleted %v, revoked %v; want nothing", d.deleted, apple.revoked)
	}
	if res.StatusCode != http.StatusSeeOther || b.cookies[SessionCookie] == nil {
		t.Errorf("got %d, cookies %v; want back to the app, still signed in", res.StatusCode, b.cookies)
	}
}

func TestAWebsiteDeletionThatFailsAfterAppleConfirmedKeepsThePersonSignedIn(t *testing.T) {
	s, apple, d, b := websiteAppleSession(t)
	d.fail = errors.New("marking an account deleted failed")
	asked := confirmAtApple(t, s, b)
	apple.codes["code-1"] = appleCode{client: "services-id", subject: "apple-subject",
		nonce: asked.Get("nonce"), email: "person@example.com"}

	res := appleCallback(s, b, "code-1", asked.Get("state"))

	if len(apple.revoked) != 0 {
		t.Errorf("revoked %v; want Apple left as it was", apple.revoked)
	}
	if res.StatusCode != http.StatusSeeOther || b.cookies[SessionCookie] == nil {
		t.Errorf("got %d, cookies %v; want back to the app, still signed in", res.StatusCode, b.cookies)
	}
}

func TestAnAppsDeletionIsNotConfirmedOnTheWebsite(t *testing.T) {
	s, _, r := appleService(t)
	rec := httptest.NewRecorder()

	at, err := s.ConfirmDeletionAtApple(rec, r, "person@example.com")

	if at != "" || err != nil || len(rec.Result().Cookies()) != 0 {
		t.Errorf("confirm at %q, %v, cookies %v; want nothing: the app confirms with its own sheet",
			at, err, rec.Result().Cookies())
	}
}

func TestAPlainSignInWithAppleDeletesNothing(t *testing.T) {
	s, apple, d, _ := websiteAppleSession(t)
	b := newBrowser()
	asked := startSignIn(t, s, b, "apple")
	apple.codes["code-1"] = appleCode{client: "services-id", subject: "apple-subject",
		nonce: asked.Get("nonce"), email: "person@example.com"}

	appleCallback(s, b, "code-1", asked.Get("state"))

	if len(d.deleted) != 0 || len(apple.revoked) != 0 || b.cookies[SessionCookie] == nil {
		t.Errorf("deleted %v, revoked %v, cookies %v; want signed in and nothing else",
			d.deleted, apple.revoked, b.cookies)
	}
}

func TestAWebsiteRequestWithACodeIsStillSentToApplesSignIn(t *testing.T) {
	s, apple, _, b := websiteAppleSession(t)
	apple.codes["code-1"] = appleCode{client: "bundle-id", subject: "apple-subject"}

	revocation, err := s.RevocationForDeletion(b.request("DELETE", "/api/account"), "code-1")

	if !errors.Is(err, ErrAppleConfirmationNeeded) || revocation != nil {
		t.Errorf("revocation %v, err %v; want the website sent to Apple's sign-in", revocation != nil, err)
	}
}

func TestNobodyIsSentToAppleWhereNothingWouldDeleteTheAccount(t *testing.T) {
	s, _, _, b := websiteAppleSession(t)
	s.DeleteAccountsWith(nil)
	rec := httptest.NewRecorder()

	at, err := s.ConfirmDeletionAtApple(rec, b.request("DELETE", "/api/account"), "person@example.com")

	if at != "" || err == nil || len(rec.Result().Cookies()) != 0 {
		t.Errorf("confirm at %q, %v; want an error before any sign-in starts", at, err)
	}
}
