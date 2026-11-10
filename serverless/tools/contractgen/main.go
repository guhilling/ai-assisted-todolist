// Command contractgen generates the API's wire types and routing from doc/api/openapi.json, the
// contract the Quarkus backend publishes, so that the Go backend never restates it by hand.
//
// It runs oapi-codegen (a tool dependency in go.mod) on a copy of the contract with one rule added:
// a property that may be null is written as null when it is, rather than left out. That is what
// the Quarkus backend's JSON does, so the wire stays the same; a property that may only be absent
// (an attachment's url, an upload's thumbnail link) is still left out.
//
//	go run ./tools/contractgen <openapi.json> <output.go>
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: contractgen <openapi.json> <output.go>")
		os.Exit(2)
	}
	if err := run(os.Args[1], os.Args[2]); err != nil {
		fmt.Fprintln(os.Stderr, "contractgen:", err)
		os.Exit(1)
	}
}

func run(specPath, outPath string) error {
	raw, err := os.ReadFile(specPath)
	if err != nil {
		return err
	}
	var spec map[string]any
	if err := json.Unmarshal(raw, &spec); err != nil {
		return fmt.Errorf("%s: %w", specPath, err)
	}
	writeNulls(spec)

	dir, err := os.MkdirTemp("", "contractgen")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	marked := filepath.Join(dir, "openapi.json")
	data, err := json.Marshal(spec)
	if err != nil {
		return err
	}
	if err := os.WriteFile(marked, data, 0o600); err != nil {
		return err
	}

	out, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer out.Close()
	cmd := exec.Command("go", "tool", "oapi-codegen",
		"-generate", "types,std-http-server", "-package", "api", marked)
	cmd.Stdout, cmd.Stderr = out, os.Stderr
	return cmd.Run()
}

// writeNulls marks every schema property whose type admits null with x-omitempty: false, which
// tells oapi-codegen to write it as null instead of leaving it out.
func writeNulls(spec map[string]any) {
	components, _ := spec["components"].(map[string]any)
	schemas, _ := components["schemas"].(map[string]any)
	for _, s := range schemas {
		schema, _ := s.(map[string]any)
		properties, _ := schema["properties"].(map[string]any)
		for _, p := range properties {
			property, _ := p.(map[string]any)
			if types, ok := property["type"].([]any); ok && slices.Contains(types, any("null")) {
				property["x-omitempty"] = false
			}
		}
	}
}
