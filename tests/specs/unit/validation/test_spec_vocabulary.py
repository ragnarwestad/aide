"""The documents are SPECS, not reports. No old identifier may survive.

The documents repo was renamed to aide-specs because the documents are
specifications more than reports (spec 72). The technical vocabulary was
renamed with it: env var, default directory, rule file, shared lib and
its functions. This test bans the old identifiers repo-wide so the
rename cannot regress or survive halfway. The verb "report" ("report
the result") stays legal — only the technical identifiers are banned.
"""
import re
from pathlib import Path

import pytest

# Old identifiers, as (label, pattern). Patterns are built with
# concatenation so this file does not match itself.
BANNED = [
    ("AIDE_REPORTS" + "_PATH", re.compile(r"AIDE_REPORTS" + r"_PATH")),
    ("_aide-report" + "-lib", re.compile(r"_aide-report" + r"-lib")),
    ("report" + "-structure", re.compile(r"\breport" + r"-structure\b")),
    ("aide_reports" + "_root", re.compile(r"aide_reports" + r"_root")),
    ("aide_resolve" + "_report", re.compile(r"aide_resolve" + r"_report")),
    ("aide_next_report" + "_number", re.compile(r"aide_next_report" + r"_number")),
    ("reports" + "/ (the default dir)", re.compile(r"\breports" + r"/")),
    ("reports" + " root", re.compile(r"\breports" + r" root\b")),
    ("normalize-reports" + ".py", re.compile(r"normalize-reports" + r"\.py")),
]

SKIP_DIRS = {".git", ".venv", "node_modules", "__pycache__", "specs", ".pytest_cache"}

TEXT_SUFFIXES = {
    ".md", ".py", ".sh", ".json", ".jsonc", ".toml", ".yml", ".yaml",
    ".txt", ".template", ".cfg", ".ini",
}


def _text_files(workspace_root):
    for path in workspace_root.rglob("*"):
        if not path.is_file():
            continue
        if SKIP_DIRS & set(path.relative_to(workspace_root).parts):
            continue
        if path.suffix and path.suffix not in TEXT_SUFFIXES:
            continue
        yield path


@pytest.mark.validation
class TestSpecVocabulary:
    def test_no_old_report_identifier_survives(self, workspace_root):
        offenders = []
        for path in _text_files(workspace_root):
            if path == Path(__file__):
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            rel = str(path.relative_to(workspace_root))
            for label, pattern in BANNED:
                count = len(pattern.findall(content))
                if count:
                    offenders.append(f"{rel}: {count}x '{label}'")

        assert not offenders, (
            "The documents are specs — old report identifiers still present in:\n  "
            + "\n  ".join(sorted(offenders))
        )
