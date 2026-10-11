"""
Fails when a workflow lets any branch save Maven's or npm's cache (#308).

setup-java's and setup-node's own `cache:` input saves an entry from every branch, one per change
to a pom.xml or a package-lock.json; Renovate's pull requests alone filled the 10 GB Actions cache
that way. So those caches are restored with actions/cache/restore and saved with actions/cache/save
only on main, which every branch can read from. This names a setup step with a `cache:` input, the
combined actions/cache on their directories, and a save step whose condition does not keep it to
main. The restore steps' keys are copies, so it also names a cache whose copies differ.

The workflows are read by indentation, without a YAML parser, which the script tests do without:
a step is a `- ` line and everything indented deeper below it.

    check-workflow-caches.py [WORKFLOW ...]     defaults to .github/workflows/*.yml
"""

import pathlib
import re
import sys

MAIN_ONLY = "github.ref == 'refs/heads/main'"
# The directories the combined actions/cache must not save from every branch.
DEPENDENCY_CACHES = ("~/.m2", "~/.npm")


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
        uses = (_value(step, "uses") or "").strip("'\"")
        action = uses.split("@")[0]
        if action in ("actions/setup-java", "actions/setup-node") and _value(step, "cache") is not None:
            found.append(f"{uses}: its own `cache:` saves from every branch; restore with "
                         "actions/cache/restore and save from main with actions/cache/save instead")
        if action == "actions/cache" and (_value(step, "path") or "").startswith(DEPENDENCY_CACHES):
            found.append(f"{uses}: saves {_value(step, 'path')} from every branch; restore with "
                         "actions/cache/restore and save from main with actions/cache/save instead")
        condition = _value(step, "if") or ""
        if action == "actions/cache/save" and (MAIN_ONLY not in condition or "||" in condition):
            found.append(f"{uses}: saves from any branch; its `if:` needs {MAIN_ONLY}, and no `||`")
    return found


def differing_keys(workflows):
    """Caches whose restore steps, in any of the {name: text} workflows, have different keys."""
    seen = {}
    for name, text in workflows.items():
        for step in steps(text):
            if (_value(step, "uses") or "").strip("'\"").split("@")[0] != "actions/cache/restore":
                continue
            key = _value(step, "key") or ""
            cache = re.match(r"^(maven|npm-[a-z0-9]+)-", key)
            if cache:
                seen.setdefault(cache.group(1), {}).setdefault((key, _value(step, "restore-keys")), []).append(name)
    return [f"{cache}: its restore steps' keys differ: " + "; ".join(
                f"{', '.join(sorted(set(names)))}: {key} / {fallback}" for (key, fallback), names in copies.items())
            for cache, copies in sorted(seen.items()) if len(copies) > 1]


def main(paths):
    workflows = {str(path): path.read_text()
                 for path in map(pathlib.Path, paths or sorted(pathlib.Path(".github/workflows").glob("*.yml")))}
    found = [f"{name}: {problem}" for name, text in workflows.items() for problem in problems(text)]
    found += differing_keys(workflows)
    if found:
        print("\n".join(found))
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
