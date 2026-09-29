#!/usr/bin/env python3
"""
Turns the backend's generated OpenAPI document into the committed API contract.

Run it after changing anything a REST resource or a response record says:

    cd backend && ./mvnw -B package -DskipTests
    python3 doc/api/generate.py

It writes three things next to itself:

    openapi.json, openapi.yaml    the document as the backend generated it
    schema/<Name>.schema.json     one standalone JSON Schema per component schema

Why the schemas are split out at all: the frontend compiles them into runtime validators, and
anything else consuming the contract wants one document per type rather than a whole API
description to index into. The split is possible because the backend emits **OpenAPI 3.1**,
whose component schemas are JSON Schema 2020-12 documents already -- there is no conversion
here, only extraction. `OpenApiContractTest` guards that version, because on 3.0 this would
quietly produce something that is not JSON Schema.

Why the `$id` and every `$ref` are relative: the same files are served from the filesystem,
from /api/main/ and from /api/v1.2.3/ on GitHub Pages. A relative reference resolves against
wherever the document was actually retrieved from, so one set of files works in all three
places. An absolute `$id` would have had to name one of them and be wrong in the others.

Why generated output is committed rather than built on demand: it makes a change to the wire
contract visible in the pull request that causes it, and it lets the frontend build depend on
the contract without depending on a Java toolchain. Backend CI regenerates and fails on any
difference, so the committed copy cannot drift from the code.
"""
from __future__ import annotations

import json
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).parent
REPO = HERE.parent.parent
GENERATED = REPO / "backend" / "target" / "openapi"
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
    source = GENERATED / "openapi.json"
    if not source.exists():
        print(
            f"{source} does not exist.\n"
            "The backend build writes it (quarkus.smallrye-openapi.store-schema-directory). Run:\n"
            "    cd backend && ./mvnw -B package -DskipTests",
            file=sys.stderr,
        )
        return 1

    document = json.loads(source.read_text())
    write_json(HERE / "openapi.json", document)
    shutil.copyfile(GENERATED / "openapi.yaml", HERE / "openapi.yaml")

    schemas = document["components"]["schemas"]
    SCHEMA_DIR.mkdir(exist_ok=True)
    for name, schema in schemas.items():
        write_json(SCHEMA_DIR / schema_filename(name), standalone(name, schema))

    # A renamed or deleted record would otherwise leave its schema behind, and the frontend
    # would go on generating a validator for a type the backend no longer has.
    expected = {schema_filename(name) for name in schemas}
    for stale in sorted(path for path in SCHEMA_DIR.glob("*.schema.json") if path.name not in expected):
        stale.unlink()
        print(f"removed {stale.relative_to(REPO)}")

    unresolved = sorted(check_refs_resolve(SCHEMA_DIR))
    if unresolved:
        print(f"these references point at no file: {', '.join(unresolved)}", file=sys.stderr)
        return 1

    print(f"wrote openapi.json, openapi.yaml and {len(schemas)} schemas to {HERE.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
