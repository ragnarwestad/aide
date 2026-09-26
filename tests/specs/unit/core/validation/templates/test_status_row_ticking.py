"""Pin tests for spec 268: implement and analyze tick their own rows.

AC1: `core/skills/aide-implement/SKILL.md` instructs ticking a phase's
own Task rows as that phase's work finishes, in EACH of Phase 1 (RED),
Phase 2 (GREEN) and Phase 3 (REFACTOR) — one assertion per phase, so an
edit to only one of the three phases still fails the other two.

AC2: `core/skills/aide-analyze/references/plan-review.md` instructs
marking the Plan review row done at write time, since that review is
already this step's own finished work by the time the line runs.
"""
import re

import pytest

TICK_MARKER = "tick this phase's task rows"


def phase_block(text, heading):
    """The text of one `### Phase N: ...` section, up to the next
    `### `-level heading or `---` divider — whichever comes first."""
    start = text.index(heading)
    rest = text[start + len(heading):]
    boundary = re.search(r"\n### |\n---", rest)
    end = boundary.start() if boundary else len(rest)
    return rest[:end]


@pytest.fixture
def implement_skill(workspace_root):
    return (
        workspace_root / "core" / "skills" / "aide-implement" / "SKILL.md"
    ).read_text()


@pytest.mark.parametrize(
    "heading",
    ["### Phase 1: RED", "### Phase 2: GREEN", "### Phase 3: REFACTOR"],
)
def test_each_phase_instructs_ticking_its_own_rows(implement_skill, heading):
    block = phase_block(implement_skill, heading)
    assert TICK_MARKER in block.lower(), (
        f"{heading} in core/skills/aide-implement/SKILL.md never instructs "
        "ticking that phase's own Task rows in 4-status.md"
    )


# --- spec 285: the Acceptance-criteria rows are for a person to judge ------


def test_plan_review_reference_does_not_tick_acceptance_criteria(workspace_root):
    """plan-review.md mentions "acceptance criteria" in an unrelated
    coherence-review question (do the criteria and the plan agree?) — the
    check here is narrower: no line that talks about ticking also talks
    about the Acceptance-criteria section."""
    text = (
        workspace_root / "core" / "skills" / "aide-analyze" / "references"
        / "plan-review.md"
    ).read_text()
    tick_lines = [line for line in text.lower().splitlines() if "tick" in line]
    assert not any("acceptance criteria" in line for line in tick_lines), (
        "plan-review.md must not instruct ticking the Acceptance-criteria "
        f"section — those rows are for a person to judge, not this step: {tick_lines}"
    )
