"""`core/skills/aide-create/SKILL.md` Step 4 must pass an already-correctly-
formatted incoming `## Acceptance criteria` section through unchanged, rather
than reformulating it — and must still formulate one from scratch when the
description carries no such section.

Spec 306 showed a description handed to `/aide-create` with an Acceptance
criteria section already in it gets rewritten anyway, because Step 4 had no
instruction at all for that case. Both halves of the fix only exist in
prose, so both are pinned here the same way
test_create_dependency_prompt.py pins the dependency-collision instruction.
"""
from pathlib import Path

# tests/specs/unit/core/validation/test_create_acceptance_criteria_passthrough.py -> aide/
CORE_SKILLS_DIR = Path(__file__).resolve().parents[6] / "core" / "skills"

SKILL = CORE_SKILLS_DIR / "aide-create" / "SKILL.md"


# Prose in SKILL.md is hand-wrapped, so a phrase spanning several words
# can have a line break inside it. Collapsing all whitespace to single
# spaces before searching matches on wording, not on where the file
# happens to wrap.
def _flatten(text: str) -> str:
    return " ".join(text.split())


def test_create_skill_passes_through_an_already_correct_acceptance_criteria_section():
    skill = _flatten(SKILL.read_text(encoding="utf-8"))
    assert "pass it through into `--description` exactly as given" in skill, (
        "aide-create/SKILL.md must tell the session to pass an already "
        "correctly-formatted incoming Acceptance criteria section through "
        "unchanged, not reformulate or renumber it"
    )


def test_create_skill_still_formulates_acceptance_criteria_from_a_thin_description():
    skill = _flatten(SKILL.read_text(encoding="utf-8"))
    assert "formulate the user's loose description as a" in skill, (
        "aide-create/SKILL.md must keep formulating an Acceptance criteria "
        "section from scratch when the incoming description has none"
    )
    assert "never write an Acceptance criteria section you had to guess at" in skill, (
        "aide-create/SKILL.md must keep asking for clarification rather "
        "than guessing when the description is too thin"
    )
