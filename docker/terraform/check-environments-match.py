#!/usr/bin/env python3
"""
Fails when the environment roots have stopped being the same Terraform.

Run it from anywhere:

    python3 docker/terraform/check-environments-match.py

"prod is merely a config change from qa" is the design of this directory, and it is the kind of
claim that stays true for exactly as long as nobody is in a hurry. The tempting shortcut -- add
the resource to qa now, port it to prod later -- produces two environments that look alike and
behave differently, and the difference surfaces at the worst moment, during a prod deploy of a
change that worked in qa.

So the rule is mechanical: every environment root contains the same files, and all of them are
byte-identical except

    terraform.tfvars   the values, which are the entire intended difference
    backend.tf         which may differ in its state key and nowhere else

Anything that must vary between environments therefore has to become a module variable, which
is the outcome this check exists to force.
"""

import pathlib
import re
import sys

# Both are per-environment by nature; the rest of the root is shared Terraform.
VALUES_FILE = "terraform.tfvars"
BACKEND_FILE = "backend.tf"

# The one line backend.tf is allowed to disagree on. Terraform's S3 backend takes no variables
# and no interpolation, so this cannot be factored out the way everything else can -- the key
# has to be written per environment, and this check is what keeps it to the key.
BACKEND_VARYING_LINE = re.compile(r'^\s*key\s*=')

ENVIRONMENTS = pathlib.Path(__file__).resolve().parent / "environments"


def files_of(root):
    """
    Every file in one environment root that is part of the Terraform, relative to it.

    Dot-prefixed paths are skipped, which is not a stylistic choice: `.terraform/` is init's
    local cache and an editor's `.main.tf.swp` is neither environment's business. Both are
    already gitignored, and a check that fails because somebody has a file open is a check
    people learn to ignore.
    """
    return sorted(
        str(path.relative_to(root))
        for path in root.rglob("*")
        if path.is_file()
        and not any(part.startswith(".") for part in path.relative_to(root).parts)
    )


def backend_shape(root):
    """backend.tf with its key line removed -- what must be identical everywhere."""
    lines = (root / BACKEND_FILE).read_text().splitlines()
    return [line for line in lines if not BACKEND_VARYING_LINE.match(line)]


def main():
    roots = sorted(path for path in ENVIRONMENTS.iterdir() if path.is_dir())
    if len(roots) < 2:
        # One environment cannot drift from anything, but it also means this check has silently
        # stopped checking, which is worth saying out loud rather than passing.
        print(f"Only {len(roots)} environment root(s) under {ENVIRONMENTS}; nothing to compare.")
        return 0

    reference, *others = roots
    problems = []

    for root in others:
        missing = set(files_of(reference)) ^ set(files_of(root))
        if missing:
            problems.append(
                f"{reference.name} and {root.name} do not contain the same files: "
                + ", ".join(sorted(missing))
            )
            continue

        for name in files_of(reference):
            if name == VALUES_FILE:
                continue

            if name == BACKEND_FILE:
                if backend_shape(reference) != backend_shape(root):
                    problems.append(
                        f"{root.name}/{BACKEND_FILE} differs from {reference.name}/{BACKEND_FILE} "
                        "in more than the state key."
                    )
                continue

            if (reference / name).read_bytes() != (root / name).read_bytes():
                problems.append(
                    f"{root.name}/{name} differs from {reference.name}/{name}. "
                    f"Anything that must differ between environments belongs in {VALUES_FILE} "
                    "as a module variable."
                )

    if problems:
        print("The environment roots have drifted apart:\n", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(
            f"\nSee the docstring in {pathlib.Path(__file__).name} for why this is enforced.",
            file=sys.stderr,
        )
        return 1

    names = ", ".join(root.name for root in roots)
    print(f"{names}: same files, identical apart from {VALUES_FILE} and the state key.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
