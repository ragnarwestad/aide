#!/usr/bin/env python3
"""Run the suites covering a change; unknown paths keep the full gate."""
import ast
import subprocess
import sys
from pathlib import Path
import re

CONTRACT_CHECK = "python3 scripts/testing/changed.py --contracts"
RESULT_FIELDS_HELPER = "run_spec_result_fields"
STEP_OUTCOME = "dashboard/src/queue/runner/types.ts"


def commands_for(paths):
    if paths and all(path.endswith(".md") for path in paths):
        return ["scripts/check-docs"]
    if paths and all(path.startswith("dashboard/") or path.endswith(".md") for path in paths):
        return [CONTRACT_CHECK, "cd dashboard && make test && make test-e2e"]
    return None


def _uses_result_fields_helper(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            names = [node.module or ""] + [alias.name for alias in node.names]
        elif isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        else:
            continue
        if any(name.split(".")[-1] == RESULT_FIELDS_HELPER for name in names):
            return True
    return False


def _names_dashboard_side(tree, fixtures):
    # A bare string statement is a docstring or a comment in disguise, never code.
    bare = {id(node.value) for node in ast.walk(tree) if isinstance(node, ast.Expr)}
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in bare:
            text = node.value
            if "dashboard" in text or re.search(r"\.ts\b", text) or any(name in text for name in fixtures):
                return True
    return False


def result_fields_the_dashboard_reads(root):
    """The camelCase fields of the dashboard's StepOutcome: the runner's result keys it reads."""
    path = Path(root) / STEP_OUTCOME
    if not path.is_file():
        return set()
    body = re.search(r"^export interface StepOutcome \{\n(.*?)^\}", path.read_text(), re.S | re.M)
    if not body:
        return set()
    return {name for name in re.findall(r"^  (\w+)\??:", body.group(1), re.M) if re.search("[A-Z]", name)}


def _reads_result_field(tree, fields):
    for node in ast.walk(tree):
        if isinstance(node, ast.Subscript):
            key = node.slice
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" and node.args:
            key = node.args[0]
        else:
            continue
        if isinstance(key, ast.Constant) and key.value in fields:
            return True
    return False


def is_contract_test(source, fixtures=(), fields=()):
    """A test checks the runner-dashboard contract when its code, not its comments, says so."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return True
    return (_uses_result_fields_helper(tree) or _names_dashboard_side(tree, fixtures)
            or _reads_result_field(tree, fields))


def contract_tests(root):
    root = Path(root)
    fixtures = [p.name for p in (root / "core/tests/fixtures").glob("*.json")]
    fields = result_fields_the_dashboard_reads(root)
    return sorted(str(p.relative_to(root)) for p in (root / "core/tests").rglob("test_*.py")
                  if is_contract_test(p.read_text(), fixtures, fields))


def main():
    if sys.argv[1] == "--contracts":
        files = contract_tests(".")
        return subprocess.run([".venv/bin/pytest", "-q", *files]).returncode if files else subprocess.run(["scripts/test-python"]).returncode
    base = subprocess.run(["git", "merge-base", "HEAD", sys.argv[1]], capture_output=True, text=True)
    paths = []
    if base.returncode == 0:
        diff = subprocess.run(["git", "diff", "--name-only", "-z", base.stdout.strip()], capture_output=True, text=True)
        new = subprocess.run(["git", "ls-files", "--others", "--exclude-standard", "-z"], capture_output=True, text=True)
        if diff.returncode == 0 and new.returncode == 0:
            paths = [p for p in diff.stdout.split("\0") if p] + [p for p in new.stdout.split("\0") if p and not p.startswith(".aide/")]
    commands = commands_for(paths)
    if commands is None:
        commands = ["scripts/test-python && cd dashboard && make test && make test-e2e"]
    for command in commands:
        result = subprocess.run(["/bin/bash", "-c", command])
        if result.returncode:
            return result.returncode
    return 0


if __name__ == "__main__":
    sys.exit(main())
