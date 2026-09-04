"""Style rules for the shared rule files in core/rules/.

Anthropic's guidance for the current models favors plain wording, the
reason in one line, and instructions phrased as what to do — capital-letter
emphasis and dated incident stories now make the model over-react rather
than comply. Every file in core/rules/ follows that style except
spec-structure.md, which is out of scope (spec 366 owns it).
"""
import re
from pathlib import Path

import pytest

# tests/specs/unit/core/validation/test_rule_style.py -> aide/
ROOT = Path(__file__).resolve().parents[6]
RULES_DIR = ROOT / "core" / "rules"

STYLED_RULE_FILES = sorted(
    p for p in RULES_DIR.glob("*.md") if p.name != "spec-structure.md"
)

CAPITAL_EMPHASIS_RE = re.compile(r"\b(ALWAYS|NEVER|CRITICAL|IMPORTANT|MUST|FORBIDDEN)\b")
ALWAYS_APPLIES_CLOSING_RE = re.compile(r"^\*{0,2}This( rule)?( ALWAYS)? applies", re.MULTILINE)
DATED_INCIDENT_RE = re.compile(r"\b202[0-9]-[0-9]{2}-[0-9]{2}\b")


@pytest.mark.validation
class TestRuleStyle:
    @pytest.mark.parametrize("path", STYLED_RULE_FILES, ids=lambda p: p.name)
    def test_no_capital_emphasis_words_outside_spec_structure(self, path):
        text = path.read_text(encoding="utf-8")
        offenders = CAPITAL_EMPHASIS_RE.findall(text)
        assert not offenders, (
            f"{path.relative_to(ROOT)} still carries capital-letter emphasis "
            f"words: {offenders} — state the rule in plain wording instead"
        )

    @pytest.mark.parametrize("path", STYLED_RULE_FILES, ids=lambda p: p.name)
    def test_no_always_applies_closing_line_outside_spec_structure(self, path):
        text = path.read_text(encoding="utf-8")
        match = ALWAYS_APPLIES_CLOSING_RE.search(text)
        assert not match, (
            f"{path.relative_to(ROOT)} still closes with an \"always applies\" "
            f"line: {match.group(0)!r} — drop it, the rule stands on its own"
        )

    @pytest.mark.parametrize("path", STYLED_RULE_FILES, ids=lambda p: p.name)
    def test_no_dated_incidents_outside_spec_structure(self, path):
        text = path.read_text(encoding="utf-8")
        offenders = DATED_INCIDENT_RE.findall(text)
        assert not offenders, (
            f"{path.relative_to(ROOT)} still justifies a rule with a dated "
            f"incident: {offenders} — replace it with the one-line reason "
            "the rule protects"
        )

    def test_communication_md_leads_with_the_outcome(self):
        text = (RULES_DIR / "communication.md").read_text(encoding="utf-8")
        assert "lead" in text.lower() and "outcome" in text.lower(), (
            "communication.md must instruct replies to lead with the outcome "
            "and drop detail that would not change what the reader does next"
        )
