#!/usr/bin/env python3
"""Run the suites covering a change; unknown paths keep the full gate."""
import subprocess
import sys
from pathlib import Path
import re

CONTRACT_CHECK = "python3 scripts/testing/changed.py --contracts"


def commands_for(paths):
    if paths and all(path.endswith(".md") for path in paths):
        return ["scripts/check-docs"]
    if paths and all(path.startswith("dashboard/") or path.endswith(".md") for path in paths):
        return [CONTRACT_CHECK, "cd dashboard && make test && make test-e2e"]
    return None


def main():
    if sys.argv[1] == "--contracts":
        files = [str(p) for p in Path("core/tests").rglob("test_*.py")
                 if re.search(r"dashboard|\.ts\b", p.read_text())]
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
