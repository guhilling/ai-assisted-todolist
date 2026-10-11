"""
Fails when a workflow lets any branch save Maven's or npm's cache (#308).

setup-java's and setup-node's own `cache:` input saves an entry from every branch, one per change
to a pom.xml or a package-lock.json; Renovate's pull requests alone filled the 10 GB Actions cache
that way. So those caches are restored with actions/cache/restore and saved with actions/cache/save
only on main, which every branch can read from. This names a setup step with a `cache:` input, and
a save step whose condition does not keep it to main.

The workflows are read by indentation, without a YAML parser, which the script tests do without:
a step is a `- ` line and everything indented deeper below it.

    check-workflow-caches.py [WORKFLOW ...]     defaults to .github/workflows/*.yml
"""

import pathlib
import re
import sys

MAIN_ONLY = "github.ref == 'refs/heads/main'"


def steps(text):
    """Each step's lines, for every `- ` item that has a `uses:` or `run:` of its own."""
    lines = text.splitlines()
    found = []
    for i, line in enumerate(lines):
        start = re.match(r"^(\s*)- ", line)
        if not start:
            continue
        indent = len(start.group(1))
        body = [line]
        for following in lines[i + 1:]:
            if following.strip() and len(following) - len(following.lstrip()) <= indent:
                break
            body.append(following)
        if any(re.match(r"^\s*(- )?(uses|run):", part) for part in body):
            found.append(body)
    return found


def _value(step, key):
    """The key's value; a block scalar (`>-`, `|`) is its deeper-indented lines joined."""
    for i, line in enumerate(step):
        match = re.match(rf"^(\s*)(- )?{key}:\s*(.*)$", line)
        if not match:
            continue
        value = match.group(3).strip()
        if not re.fullmatch(r"[>|][+-]?", value):
            return value
        indent = len(match.group(1)) + len(match.group(2) or "")
        block = []
        for following in step[i + 1:]:
            if following.strip() and len(following) - len(following.lstrip()) <= indent:
                break
            block.append(following.strip())
        return " ".join(part for part in block if part)
    return None


def problems(text):
    found = []
    for step in steps(text):
        uses = _value(step, "uses") or ""
        action = uses.split("@")[0]
        if action in ("actions/setup-java", "actions/setup-node") and _value(step, "cache") is not None:
            found.append(f"{uses}: its own `cache:` saves from every branch; restore with "
                         "actions/cache/restore and save from main with actions/cache/save instead")
        if action == "actions/cache/save" and MAIN_ONLY not in (_value(step, "if") or ""):
            found.append(f"{uses}: saves from any branch; its `if:` needs {MAIN_ONLY}")
    return found


def main(paths):
    workflows = paths or sorted(pathlib.Path(".github/workflows").glob("*.yml"))
    failed = False
    for path in map(pathlib.Path, workflows):
        for problem in problems(path.read_text()):
            print(f"{path}: {problem}")
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
