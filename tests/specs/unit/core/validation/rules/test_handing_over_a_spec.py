"""`core/rules/communication.md` says a spec agreed in chat is handed over as text.

The user creates specs from the dashboard. An assistant that runs
`/aide-create` itself, or writes to the specs repo, takes that away — so the
rule, and its presence in the generated `core/AGENTS.md` that Codex and
Copilot read, is pinned here.
"""
from pathlib import Path

# tests/specs/unit/core/validation/rules/test_handing_over_a_spec.py -> aide/
ROOT = Path(__file__).resolve().parents[6]

AGENTS = ROOT / "core" / "AGENTS.md"

HEADING = "## Handing over a spec"


def test_the_rule_reaches_the_generated_agents_file():
    # AGENTS.md is built from core/rules/; a rule that never reaches it is
    # a rule Codex and Copilot never read.
    assert HEADING in AGENTS.read_text(encoding="utf-8"), (
        "core/AGENTS.md is stale — run core/scripts/build-agents-md.sh "
        "after editing core/rules/communication.md"
    )
