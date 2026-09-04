"""`core/skills/aide-create/SKILL.md` tells the session to ASK about a
dependency it can see, not merely to refrain from inventing one.

"Never infer a dependency from the description" on its own reads as
permission to stay silent about a collision the session has already
noticed, which leaves the user holding one spec back by hand. The two
instructions only work as a pair, so both are pinned here.
"""
from pathlib import Path

# tests/specs/unit/core/validation/test_create_dependency_prompt.py -> aide/
CORE_SKILLS_DIR = Path(__file__).resolve().parents[6] / "core" / "skills"

SKILL = CORE_SKILLS_DIR / "aide-create" / "SKILL.md"


def test_create_skill_still_refuses_to_invent_a_dependency():
    skill = SKILL.read_text(encoding="utf-8")
    assert "Never infer a dependency from the description" in skill, (
        "aide-create/SKILL.md must keep stating that a dependency is never "
        "invented from the description text"
    )


def test_create_skill_asks_about_a_collision_before_creating_the_spec():
    skill = SKILL.read_text(encoding="utf-8")
    assert "A collision you can see is a question to ask" in skill, (
        "aide-create/SKILL.md must tell the session to ask the user about a "
        "dependency when an open spec already changes the same files, pages "
        "or behaviour — silence there is what leaves a spec to be held back "
        "by hand"
    )
    assert "before creating the spec" in skill.lower(), (
        "the ask has to happen BEFORE the spec is created, so --depends-on "
        "can be passed on the same run"
    )
