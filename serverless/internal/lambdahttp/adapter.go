// Package lambdahttp runs an ordinary net/http handler as a Lambda function behind API Gateway's
// HTTP API, so the same handler also serves plain HTTP locally and in the end-to-end tests. It is
// one of the two places Lambda's event types may appear (cmd/ is the other; serverless/CLAUDE.md).
package lambdahttp

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

type eventKey struct{}

// Event returns the API Gateway event a request came from, for what only the event carries: the
// claims API Gateway's JWT authorizer passed on. ok is false when the request did not come
// through Lambda.
func Event(ctx context.Context) (event events.APIGatewayV2HTTPRequest, ok bool) {
	event, ok = ctx.Value(eventKey{}).(events.APIGatewayV2HTTPRequest)
	return event, ok
}

// Handler adapts h to the HTTP API's payload format 2.0: the event becomes an http.Request, and
// what h writes becomes the response event. Cookies travel in their own fields in both
// directions, as that format requires.
func Handler(h http.Handler) func(context.Context, events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	return func(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
		req, err := request(context.WithValue(ctx, eventKey{}, event), event)
		if err != nil {
			return events.APIGatewayV2HTTPResponse{}, err
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return response(rec.Result().Header, rec.Code, rec.Body.Bytes()), nil
	}
}

func request(ctx context.Context, event events.APIGatewayV2HTTPRequest) (*http.Request, error) {
	body := []byte(event.Body)
	if event.IsBase64Encoded {
		decoded, err := base64.StdEncoding.DecodeString(event.Body)
		if err != nil {
			return nil, fmt.Errorf("decode the request body: %w", err)
		}
		body = decoded
	}
	target := event.RawPath
	if event.RawQueryString != "" {
		target += "?" + event.RawQueryString
	}
	req, err := http.NewRequestWithContext(ctx, event.RequestContext.HTTP.Method, target, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build the request: %w", err)
	}
	for name, value := range event.Headers {
		// The format joins repeated headers with commas; a handler reads them as one value.
		req.Header.Set(name, value)
	}
	if len(event.Cookies) > 0 {
		req.Header.Set("Cookie", strings.Join(event.Cookies, "; "))
	}
	req.Host = event.Headers["host"]
	req.RemoteAddr = event.RequestContext.HTTP.SourceIP
	return req, nil
}

func response(header http.Header, status int, body []byte) events.APIGatewayV2HTTPResponse {
	res := events.APIGatewayV2HTTPResponse{StatusCode: status, Body: string(body)}
	for name, values := range header {
		if name == "Set-Cookie" {
			res.Cookies = values
			continue
		}
		if res.Headers == nil {
			res.Headers = map[string]string{}
		}
		res.Headers[name] = strings.Join(values, ",")
	}
	return res
}
