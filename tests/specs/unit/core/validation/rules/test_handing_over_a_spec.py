"""`core/rules/communication.md` says a spec agreed in chat is handed over as text.

The user creates specs from the dashboard. An assistant that runs
`/aide-create` itself, or writes to the specs repo, takes that away — so the
rule, and its presence in the generated `core/AGENTS.md` that Codex and
Copilot read, is pinned here.
"""
from pathlib import Path

# tests/specs/unit/core/validation/rules/test_handing_over_a_spec.py -> aide/
ROOT = Path(__file__).resolve().parents[6]

RULE = ROOT / "core" / "rules" / "communication.md"
AGENTS = ROOT / "core" / "AGENTS.md"

HEADING = "## Handing over a spec"


def _section():
    text = RULE.read_text(encoding="utf-8")
    assert HEADING in text, "communication.md must carry the handing-over-a-spec section"
    return text.split(HEADING, 1)[1].split("\n## ", 1)[0]


def test_the_spec_is_handed_over_and_never_created():
    section = _section()
    assert "handed over as text" in section, (
        "the rule must say an agreed spec is handed over as text"
    )
    assert "Never create it" in section and "specs repo" in section, (
        "the rule must forbid creating the spec or writing to the specs repo"
    )


def test_the_hand_over_asks_first_and_names_no_number():
    section = _section()
    assert "Ask first." in section, "choices are raised before the text, not after it"
    assert "No number." in section, "the number is assigned when the spec is created"


def test_the_rule_reaches_the_generated_agents_file():
    # AGENTS.md is built from core/rules/; a rule that never reaches it is
    # a rule Codex and Copilot never read.
    assert HEADING in AGENTS.read_text(encoding="utf-8"), (
        "core/AGENTS.md is stale — run core/scripts/build-agents-md.sh "
        "after editing core/rules/communication.md"
    )
