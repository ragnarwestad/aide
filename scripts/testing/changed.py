#!/usr/bin/env python3
"""Run the suites covering a change; unknown paths keep the full gate."""
import ast
import json
import os
import subprocess
import sys
from pathlib import Path

CONTRACT_CHECK = "python3 scripts/testing/changed.py --contracts"


# Each suite by name, in the order a run takes them. The landing asks for
# suites by these names (AIDE_TEST_ONLY_SUITES) and reads which were red
# from the report this writes (AIDE_TEST_SUITES_REPORT).
# The runner's tests are most of pytest's time, so they are a suite of their
# own: a red test elsewhere in pytest does not run them again.
RUNNER_TESTS = "core/tests/specs/unit/core/scripts"
SUITES = {
    "docs": "scripts/check-docs",
    "contracts": CONTRACT_CHECK,
    "python": f"scripts/test-python --ignore={RUNNER_TESTS}",
    "runner": f"scripts/test-python {RUNNER_TESTS}",
    "dashboard": "cd dashboard && make test",
    "e2e": "cd dashboard && make test-e2e",
}
FULL = ["python", "runner", "dashboard", "e2e"]


def suites_for(paths):
    """The suites a change needs; unknown paths need the full run."""
    if paths and all(path.endswith(".md") for path in paths):
        return ["docs"]
    if paths and all(path.startswith("dashboard/") or path.endswith(".md") for path in paths):
        return ["contracts", "dashboard", "e2e"]
    return list(FULL)


def suites_after_repair(paths):
    """What a repair's own changes need run again, beside the suites that were red:
    a dashboard test file is read by its own suite alone."""
    if paths and all(path.startswith("dashboard/test/e2e/") for path in paths):
        return ["e2e"]
    if paths and all(path.startswith("dashboard/test/") for path in paths):
        return ["dashboard", "e2e"] if any(path.startswith("dashboard/test/e2e/") for path in paths) else ["dashboard"]
    return suites_for(paths)


def commands_for(paths):
    suites = suites_for(paths)
    return None if suites == FULL else [SUITES[name] for name in suites]


def _names_the_dashboard_folder(tree):
    # A bare string statement is a docstring or a comment in disguise, never code.
    bare = {id(node.value) for node in ast.walk(tree) if isinstance(node, ast.Expr)}
    return any(
        isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in bare
        and (node.value == "dashboard" or node.value.startswith("dashboard/"))
        for node in ast.walk(tree))


def is_contract_test(source):
    """A Python test a dashboard change can turn red: its code, not its comments,
    names the dashboard folder, which is how a test reaches a file there."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return True
    return _names_the_dashboard_folder(tree)


def contract_tests(root):
    root = Path(root)
    return sorted(str(p.relative_to(root)) for p in (root / "core/tests").rglob("test_*.py")
                  if is_contract_test(p.read_text()))


def _changed_since(base):
    diff = subprocess.run(["git", "diff", "--name-only", "-z", base], capture_output=True, text=True)
    new = subprocess.run(["git", "ls-files", "--others", "--exclude-standard", "-z"], capture_output=True, text=True)
    if diff.returncode or new.returncode:
        return None
    return [p for p in diff.stdout.split("\0") if p] + [p for p in new.stdout.split("\0") if p and not p.startswith(".aide/")]


def selected_suites(paths, env):
    """The suites to run: those the change needs, unless the landing names some.
    After a repair it names the red ones, and the commit it tested: what the
    repair changed since then is run as well."""
    only = [name for name in env.get("AIDE_TEST_ONLY_SUITES", "").split(",") if name in SUITES]
    if not only:
        return suites_for(paths)
    since = env.get("AIDE_TEST_ALSO_CHANGED_SINCE", "")
    extra = []
    if since:
        changed = _changed_since(since)
        extra = list(FULL) if changed is None else suites_after_repair(changed)
    wanted = set(only) | set(extra)
    return [name for name in SUITES if name in wanted]


def main():
    if sys.argv[1] == "--contracts":
        files = contract_tests(".")
        return subprocess.run([".venv/bin/pytest", "-q", *files]).returncode if files else subprocess.run(["scripts/test-python"]).returncode
    base = subprocess.run(["git", "merge-base", "HEAD", sys.argv[1]], capture_output=True, text=True)
    paths = (_changed_since(base.stdout.strip()) or []) if base.returncode == 0 else []
    report = os.environ.get("AIDE_TEST_SUITES_REPORT", "")
    failed = 0
    # Every suite runs, red or not, so the report says which of them were red.
    for name in selected_suites(paths, os.environ):
        code = subprocess.run(["/bin/bash", "-c", SUITES[name]]).returncode
        if report:
            with open(report, "a") as out:
                out.write(json.dumps({"suite": name, "ok": code == 0}) + "\n")
        failed = failed or code
    return failed

if __name__ == "__main__":
    sys.exit(main())
