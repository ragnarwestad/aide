"""Spec 442: every error message the bash CLI surface produces starts
with an uppercase letter.

`core/scripts/**` builds the one-JSON-line contract's `"error"` field in
three shapes: a direct literal, a call to the shared `refuse()` helper
(`lib/run-spec-arguments.sh`), or a locally-scoped `error_msg=` variable
read into `jq` later. This scans all three shapes across every script,
not only the files a human mapping happened to name — the same
"straggler surfaces as a test failure" mechanism the spec's own risk
analysis relies on.

A message that opens with a dynamic value (`$foo` immediately after the
opening quote) is exempt, the same way a `{placeholder}`-led catalog
entry is on the TypeScript side: there is no fixed first character for a
literal-uppercase rule to apply to. This is why each pattern below
requires the character right after the opening quote to be a lowercase
letter — a `$`-led, flag-led (`--foo`) or already-uppercase message
never matches, with no separate exemption list to maintain.

Four scripts (`aide-backfill-spec-state`, `aide-install-spec-hook`,
`aide-print-specs-guard`, `aide-pull-specs`) refuse a bad CLI argument
with a bare `echo "..." >&2; exit N`, outside all three JSON shapes —
covered by explicit, named checks instead of a generic `echo >&2` scan,
which would also catch this run's own diagnostic log lines (the bash
equivalent of the dashboard's `console.error`/`serve.log` lines, out of
scope for the same reason `2-analysis.md`'s "Patterns" section gives).
"""
import re
from pathlib import Path

import pytest

LOWERCASE_START = "[a-zæøå]"

DIRECT_LITERAL = re.compile(r'"error"\s*:\s*"(' + LOWERCASE_START + r')')
REFUSE_CALL = re.compile(r"refuse\s+[\"'](" + LOWERCASE_START + r")")
ERROR_MSG_ASSIGN = re.compile(r"error_msg=[\"'](" + LOWERCASE_START + r")")


def _bash_files(scripts_dir: Path) -> list[Path]:
    return [p for p in scripts_dir.rglob("*") if p.is_file() and p.name != "effort-levels.json"
            and p.name != "workflow-steps.json" and p.name != "transitions.json"]


def _violations(scripts_dir: Path, pattern: re.Pattern) -> list[str]:
    hits = []
    for path in _bash_files(scripts_dir):
        text = path.read_text(errors="ignore")
        for lineno, line in enumerate(text.splitlines(), start=1):
            if pattern.search(line):
                hits.append(f"{path.relative_to(scripts_dir.parent.parent)}:{lineno}: {line.strip()}")
    return hits


@pytest.fixture
def scripts_dir(workspace_root):
    return workspace_root / "core" / "scripts"


def test_direct_literal_error_field_is_capitalized(scripts_dir):
    violations = _violations(scripts_dir, DIRECT_LITERAL)
    assert not violations, "lowercase-led \"error\":\"...\" literal(s):\n" + "\n".join(violations)


def test_refuse_calls_are_capitalized(scripts_dir):
    violations = _violations(scripts_dir, REFUSE_CALL)
    assert not violations, "lowercase-led refuse(...) call(s):\n" + "\n".join(violations)


def test_error_msg_assignments_are_capitalized(scripts_dir):
    violations = _violations(scripts_dir, ERROR_MSG_ASSIGN)
    assert not violations, "lowercase-led error_msg=... assignment(s):\n" + "\n".join(violations)


# The four scripts whose own CLI-argument refusal is a bare `echo ... >&2`
# outside the three shapes above (2-analysis.md, Category C).
@pytest.mark.parametrize("script,expected", [
    ("aide-backfill-spec-state", ["Unknown argument:", "Missing --specs-root", "Jq is required",
                                   "Spec-state.sh could not be loaded"]),
    ("aide-install-spec-hook", ["Usage: aide-install-spec-hook",
                                 "Aide-install-spec-hook: missing hook source:"]),
    ("aide-print-specs-guard", ["Unknown argument:"]),
    ("aide-pull-specs", ["Usage: aide-pull-specs"]),
])
def test_named_cli_refusal_scripts_capitalize_their_bare_echo(scripts_dir, script, expected):
    text = (scripts_dir / script).read_text()
    for snippet in expected:
        assert snippet in text, f"{script} should say {snippet!r}"
