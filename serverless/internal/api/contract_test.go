package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// The contract the Quarkus backend publishes, which the Go backend must answer to.
const contractPath = "../../../doc/api/openapi.json"

// contract is openapi.json, read once per test binary.
type contract struct {
	doc      map[string]any
	compiler *jsonschema.Compiler
}

func loadContract(t *testing.T) *contract {
	t.Helper()
	raw, err := os.ReadFile(contractPath)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource("openapi.json", doc); err != nil {
		t.Fatal(err)
	}
	return &contract{doc: doc.(map[string]any), compiler: c}
}

// pointer escapes one segment of a JSON pointer.
func pointer(s string) string {
	return strings.NewReplacer("~", "~0", "/", "~1").Replace(s)
}

// checkResponse fails the test unless body is what the contract says the operation answers with
// that status.
func (c *contract) checkResponse(t *testing.T, method, path string, status int, body []byte) {
	t.Helper()
	if err := c.mismatch(method, path, status, body); err != nil {
		t.Error(err)
	}
}

// mismatch says how a response departs from the contract: the status must be declared for the
// operation, and a JSON body must match its schema. It is nil for a response that matches.
func (c *contract) mismatch(method, path string, status int, body []byte) error {
	paths := c.doc["paths"].(map[string]any)
	op, ok := paths[path].(map[string]any)[strings.ToLower(method)].(map[string]any)
	if !ok {
		return fmt.Errorf("%s %s is not in the contract", method, path)
	}
	code := strconv.Itoa(status)
	declared, ok := op["responses"].(map[string]any)[code].(map[string]any)
	if !ok {
		return fmt.Errorf("%s %s: the contract declares no %d response", method, path, status)
	}
	content, _ := declared["content"].(map[string]any)
	if _, ok := content["application/json"]; !ok {
		if len(body) != 0 {
			return fmt.Errorf("%s %s %d: the contract declares no body, got %q", method, path, status, body)
		}
		return nil
	}
	schema, err := c.compiler.Compile("openapi.json#/paths/" + pointer(path) + "/" + strings.ToLower(method) +
		"/responses/" + code + "/content/application~1json/schema")
	if err != nil {
		return err
	}
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("%s %s %d: not JSON: %w", method, path, status, err)
	}
	if err := schema.Validate(value); err != nil {
		return fmt.Errorf("%s %s %d does not match the contract: %w", method, path, status, err)
	}
	return nil
}

var parameter = regexp.MustCompile(`\{[^}]+\}`)

func TestEveryRouteOfTheContractIsServed(t *testing.T) {
	c := loadContract(t)
	routes := Routes(&Server{Caller: nobody, Tasks: &fakeTasks{}})

	for path, ops := range c.doc["paths"].(map[string]any) {
		for method := range ops.(map[string]any) {
			method = strings.ToUpper(method)
			req := httptest.NewRequest(method, parameter.ReplaceAllString(path, "1"), nil)
			rec := httptest.NewRecorder()

			routes.ServeHTTP(rec, req)

			if rec.Code == http.StatusNotFound || rec.Code == http.StatusMethodNotAllowed {
				t.Errorf("%s %s: %d, not routed", method, path, rec.Code)
			}
		}
	}
}

func TestTheBoardMatchesTheContract(t *testing.T) {
	c := loadContract(t)
	routes := Routes(&Server{Caller: signedIn, Tasks: &fakeTasks{tasks: sampleTasks()}})
	rec := httptest.NewRecorder()

	routes.ServeHTTP(rec, httptest.NewRequest("GET", "/api/tasks", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d", rec.Code)
	}
	c.checkResponse(t, "GET", "/api/tasks", rec.Code, rec.Body.Bytes())
}

func TestTheContractCheckCatchesAWrongBody(t *testing.T) {
	c := loadContract(t)
	wrong, _ := json.Marshal([]map[string]any{{"id": "seven"}})

	if c.mismatch("GET", "/api/tasks", 200, wrong) == nil {
		t.Error("a task without description, due date or a numeric id passed the contract check")
	}
}
