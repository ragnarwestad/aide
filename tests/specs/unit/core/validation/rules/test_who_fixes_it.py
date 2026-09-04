"""`core/rules/communication.md` names who carries out a proposed fix.

A fix the user can do from the dashboard and a fix only the assistant can
make are different kinds of answer: the first is a task being handed over,
the second is a report of work about to happen. Blurring them leaves the
user unsure which he is reading, so the rule — and its presence in the
generated `core/AGENTS.md` that Codex and Copilot read — is pinned here.
"""
from pathlib import Path

# tests/specs/unit/core/validation/test_who_fixes_it.py -> aide/
ROOT = Path(__file__).resolve().parents[6]

RULE = ROOT / "core" / "rules" / "communication.md"
AGENTS = ROOT / "core" / "AGENTS.md"

HEADING = "## Who fixes it: the dashboard, or me"


def test_the_rule_states_both_halves():
    text = RULE.read_text(encoding="utf-8")
    assert HEADING in text, "communication.md must carry the who-fixes-it section"
    assert "It can be done in the dashboard." in text, (
        "the rule must state the dashboard half: describe it in the "
        "dashboard's own words and let the user do it"
    )
    assert "It cannot be done in the dashboard." in text, (
        "the rule must state the other half: say so plainly and say that "
        "this one is the assistant's to do"
    )


def test_the_rule_reaches_the_generated_agents_file():
    # AGENTS.md is built from core/rules/; a rule that never reaches it is
    # a rule Codex and Copilot never read.
    assert HEADING in AGENTS.read_text(encoding="utf-8"), (
        "core/AGENTS.md is stale — run core/scripts/build-agents-md.sh "
        "after editing core/rules/communication.md"
    )
