package lambdahttp

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func event(method, path string) events.APIGatewayV2HTTPRequest {
	e := events.APIGatewayV2HTTPRequest{RawPath: path, Headers: map[string]string{}}
	e.RequestContext.HTTP.Method = method
	return e
}

func TestTheRequestCarriesMethodPathQueryHeadersAndCookies(t *testing.T) {
	var got *http.Request
	h := Handler(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { got = r }))
	e := event("PUT", "/api/tasks/7")
	e.RawQueryString = "a=1&b=2"
	e.Headers = map[string]string{"host": "taskfest.example.com", "x-requested-with": "fetch"}
	e.Cookies = []string{"q_session=abc", "other=1"}

	if _, err := h(context.Background(), e); err != nil {
		t.Fatal(err)
	}

	if got.Method != "PUT" || got.URL.Path != "/api/tasks/7" || got.URL.Query().Get("b") != "2" {
		t.Errorf("got %s %s", got.Method, got.URL)
	}
	if got.Host != "taskfest.example.com" || got.Header.Get("X-Requested-With") != "fetch" {
		t.Errorf("host %q, headers %v", got.Host, got.Header)
	}
	if c, err := got.Cookie("q_session"); err != nil || c.Value != "abc" {
		t.Errorf("cookie %v, %v", c, err)
	}
}

func TestABase64BodyIsDecoded(t *testing.T) {
	var body string
	h := Handler(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		body = string(b)
	}))
	e := event("POST", "/api/tasks")
	e.Body, e.IsBase64Encoded = base64.StdEncoding.EncodeToString([]byte(`{"a":1}`)), true

	if _, err := h(context.Background(), e); err != nil {
		t.Fatal(err)
	}

	if body != `{"a":1}` {
		t.Errorf("got %q", body)
	}
}

func TestTheResponseCarriesStatusHeadersBodyAndCookiesApart(t *testing.T) {
	h := Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		http.SetCookie(w, &http.Cookie{Name: "q_session", Value: "x"})
		http.SetCookie(w, &http.Cookie{Name: "other", Value: "y"})
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":1}`))
	}))

	res, err := h(context.Background(), event("POST", "/api/tasks"))

	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 201 || res.Body != `{"id":1}` || res.Headers["Content-Type"] != "application/json" {
		t.Errorf("got %+v", res)
	}
	if len(res.Cookies) != 2 || res.Cookies[0] != "q_session=x" {
		t.Errorf("cookies %v", res.Cookies)
	}
	if _, ok := res.Headers["Set-Cookie"]; ok {
		t.Error("Set-Cookie must travel in Cookies, not in Headers")
	}
}

func TestTheHandlerCanReadTheEvent(t *testing.T) {
	var claims map[string]string
	h := Handler(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		if e, ok := Event(r.Context()); ok {
			claims = e.RequestContext.Authorizer.JWT.Claims
		}
	}))
	e := event("GET", "/api/tasks")
	e.RequestContext.Authorizer = &events.APIGatewayV2HTTPRequestContextAuthorizerDescription{
		JWT: &events.APIGatewayV2HTTPRequestContextAuthorizerJWTDescription{Claims: map[string]string{"email": "a@example.com"}},
	}

	if _, err := h(context.Background(), e); err != nil {
		t.Fatal(err)
	}

	if claims["email"] != "a@example.com" {
		t.Errorf("claims %v", claims)
	}
}

func TestOutsideLambdaThereIsNoEvent(t *testing.T) {
	if _, ok := Event(context.Background()); ok {
		t.Error("found an event in a plain context")
	}
}
