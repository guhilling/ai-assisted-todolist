#!/usr/bin/env python3
"""
Derives the rest of the API contract from its source, `openapi.json`, and checks it.

`doc/api/openapi.json` is the contract (#559): a wire change starts there, edited by hand, and the
Go backend's routes and types (`go generate`) and the frontend's types and validators
(`npm run generate:api`) are generated from it. Run this after editing it:

    python3 doc/api/generate.py

A release runs it with `--version 1.2.3`, which writes that version into the documents instead of
main's `1.0.0-SNAPSHOT`, so the contract attached to the release says what it describes; nothing
commits that.

It checks the document is valid OpenAPI 3.1, then writes next to it:

    openapi.yaml                  the same document as YAML, for oasdiff and readers who prefer it
    schema/<Name>.schema.json     one standalone JSON Schema per component schema

Why the schemas are split out at all: the frontend compiles them into runtime validators, and
anything else consuming the contract wants one document per type rather than a whole API
description to index into. The split needs no conversion because OpenAPI 3.1's component schemas
are JSON Schema 2020-12 documents already -- which is why the document must stay on 3.1, and the
check below refuses anything else.

Why the `$id` and every `$ref` are relative: the same files are served from the filesystem,
from /api/main/ and from /api/v1.2.3/ on GitHub Pages. A relative reference resolves against
wherever the document was actually retrieved from, so one set of files works in all three
places. An absolute `$id` would have had to name one of them and be wrong in the others.

Why the derived files are committed rather than built on demand: they show a change to the wire
contract in the pull request that makes it, and the frontend build needs no Python. Contract CI
runs this and fails on any difference, so they cannot drift from the source.

Until #559 the contract was generated from the Quarkus backend's records; the tag
`pre-serverless` keeps that way of making it.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import yaml
from openapi_spec_validator import validate
from openapi_spec_validator.validation.exceptions import OpenAPIValidationError

HERE = pathlib.Path(__file__).parent
REPO = HERE.parent.parent
SOURCE = HERE / "openapi.json"
SCHEMA_DIR = HERE / "schema"

DIALECT = "https://json-schema.org/draft/2020-12/schema"
COMPONENT_PREFIX = "#/components/schemas/"


def schema_filename(name: str) -> str:
    """The file one component schema lives in, which is also its `$id` and how others cite it."""
    return f"{name}.schema.json"


def with_relative_refs(node: object) -> object:
    """
    Rewrites every in-document `$ref` to the file the referenced schema now lives in.

    Structural recursion rather than a search and replace on the text: a `$ref` is only a
    reference where it is a key, and the string could otherwise appear in a description or an
    example.
    """
    if isinstance(node, dict):
        return {
            key: (
                schema_filename(value[len(COMPONENT_PREFIX):])
                if key == "$ref" and isinstance(value, str) and value.startswith(COMPONENT_PREFIX)
                else with_relative_refs(value)
            )
            for key, value in node.items()
        }
    if isinstance(node, list):
        return [with_relative_refs(item) for item in node]
    return node


def standalone(name: str, schema: dict) -> dict:
    """One component schema as a document in its own right, dialect and identity declared."""
    return {"$schema": DIALECT, "$id": schema_filename(name), **with_relative_refs(schema)}


def write_json(path: pathlib.Path, document: dict) -> None:
    """Writes formatted JSON with a trailing newline, so the files read as text and diff well."""
    path.write_text(json.dumps(document, indent=2) + "\n")


def references(node: object) -> set[str]:
    """Every `$ref` target in a document, however deeply nested."""
    if isinstance(node, dict):
        found = {node["$ref"]} if isinstance(node.get("$ref"), str) else set()
        return found.union(*[references(value) for value in node.values()], set())
    if isinstance(node, list):
        return set().union(*[references(item) for item in node], set())
    return set()


def check_refs_resolve(directory: pathlib.Path) -> set[str]:
    """
    Names the references that point at no file, so a broken contract fails here.

    Nothing else would catch it. A relative `$ref` is only resolved when something tries to
    compile the schema, which happens in the frontend build -- a different job, in a different
    language, with a worse error message.
    """
    written = {path.name for path in directory.glob("*.schema.json")}
    return {
        ref
        for path in directory.glob("*.schema.json")
        for ref in references(json.loads(path.read_text()))
        if ref not in written
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--version", help="the release version to write into the documents")
    args = parser.parse_args()

    document = json.loads(SOURCE.read_text())
    if args.version:
        document["info"]["version"] = args.version
    if not str(document.get("openapi", "")).startswith("3.1"):
        print(f"{SOURCE.name} must be OpenAPI 3.1, whose schemas are JSON Schema 2020-12; "
              f"it says {document.get('openapi')!r}", file=sys.stderr)
        return 1
    try:
        validate(document)
    except OpenAPIValidationError as error:
        print(f"{SOURCE.name} is not valid OpenAPI 3.1: {error.message}", file=sys.stderr)
        return 1

    # Rewritten as it reads, so a hand edit's formatting does not linger as a diff.
    write_json(SOURCE, document)
    (HERE / "openapi.yaml").write_text(yaml.safe_dump(document, sort_keys=False, allow_unicode=True))

    schemas = document["components"]["schemas"]
    SCHEMA_DIR.mkdir(exist_ok=True)
    for name, schema in schemas.items():
        write_json(SCHEMA_DIR / schema_filename(name), standalone(name, schema))

    # A renamed or deleted schema would otherwise leave its file behind, and the frontend would
    # go on generating a validator for a type the contract no longer has.
    expected = {schema_filename(name) for name in schemas}
    for stale in sorted(path for path in SCHEMA_DIR.glob("*.schema.json") if path.name not in expected):
        stale.unlink()
        print(f"removed {stale.relative_to(REPO)}")

    unresolved = sorted(check_refs_resolve(SCHEMA_DIR))
    if unresolved:
        print(f"these references point at no file: {', '.join(unresolved)}", file=sys.stderr)
        return 1

    print(f"checked openapi.json; wrote openapi.yaml and {len(schemas)} schemas to {HERE.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
