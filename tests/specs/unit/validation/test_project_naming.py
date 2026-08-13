"""The project is named 'aide'. No former name may survive anywhere in the repo.

A rename is easy to do halfway: the README and the install scripts get updated,
a help text or a test fixture does not, and the stale name only surfaces months
later in someone's terminal. This test scans every tracked text file, including
the spelled-out variants ("Doc Aide") that a plain string sweep misses.
"""
import re
from pathlib import Path

import pytest

PROJECT_NAME = "aide"

# Banned names, as (label, pattern). Patterns are built with concatenation so
# this file does not match itself. The customer domain name is banned
# outright (2026-08-13): the repo must be neutral — say "the customer
# project" instead of naming it.
FORMER_NAMES = [
    ("doc" + "-aide", re.compile(r"doc" + r"[ _-]?aide", re.IGNORECASE)),
    ("melo" + "sys", re.compile(r"melo" + r"sys", re.IGNORECASE)),
]

# No allowed mentions — not even the roadmap's origin story names the
# customer project anymore.
ALLOWED_MENTIONS = {}

# Directories that are not ours to rename, plus generated and ignored output.
SKIP_DIRS = {".git", ".venv", "node_modules", "__pycache__", ".pytest_cache"}

# Skipped only at the repo ROOT — "specs" also names the test tree
# (tests/specs/), which must be scanned.
ROOT_SKIP_DIRS = {"specs"}

# Only text we author. Anything else is skipped rather than guessed at.
TEXT_SUFFIXES = {
    ".md", ".py", ".sh", ".json", ".jsonc", ".toml", ".yml", ".yaml",
    ".txt", ".template", ".cfg", ".ini",
}


def _text_files(workspace_root):
    for path in workspace_root.rglob("*"):
        if not path.is_file():
            continue
        parts = path.relative_to(workspace_root).parts
        if SKIP_DIRS & set(parts) or parts[0] in ROOT_SKIP_DIRS:
            continue
        # Shell scripts in core/scripts have no suffix at all.
        if path.suffix and path.suffix not in TEXT_SUFFIXES:
            continue
        yield path


@pytest.mark.validation
class TestProjectName:
    """Everything that names the project must name it 'aide'."""

    def test_no_former_name_survives(self, workspace_root):
        offenders = []
        for path in _text_files(workspace_root):
            if path == Path(__file__):
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            rel = str(path.relative_to(workspace_root))
            for label, pattern in FORMER_NAMES:
                if label in ALLOWED_MENTIONS.get(rel, set()):
                    continue
                count = len(pattern.findall(content))
                if count:
                    offenders.append(f"{rel}: {count}x '{label}'")

        assert not offenders, (
            f"The project is named '{PROJECT_NAME}'. Former names still present in:\n  "
            + "\n  ".join(sorted(offenders))
        )

    def test_workspace_directory_is_named_after_the_project(self, workspace_root):
        assert workspace_root.name == PROJECT_NAME, (
            f"The workspace directory is '{workspace_root.name}', expected "
            f"'{PROJECT_NAME}'. AIDE_INSTALLATION_PATH and the reports fallback "
            f"both derive from this path."
        )
