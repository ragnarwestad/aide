"""Spec 288: `core/skills/aide-analyze/SKILL.md` states its own scope
boundary as a standalone, first-person rule.

Spec 284's incident happened with the existing narrower carve-outs
("leave that line exactly as you found it", "use aide-write-spec instead
of Write/Edit for spec files") already in place and already read by the
session — neither is a general "this skill touches only its own four
files" statement, and the model crossed the line anyway. `aide-run-spec`'s
own guard (spec 288) is the mechanical backstop; this is the prose
defense-in-depth beside it.
"""
from pathlib import Path

# tests/specs/unit/core/validation/test_analyze_scope_boundary.py -> aide/
CORE_SKILLS_DIR = Path(__file__).resolve().parents[5] / "core" / "skills"


def test_analyze_skill_states_its_own_scope_boundary():
    skill = (CORE_SKILLS_DIR / "aide-analyze" / "SKILL.md").read_text(encoding="utf-8")
    assert "never modifies anything outside the spec's own four" in skill, (
        "aide-analyze/SKILL.md must state, as a standalone, first-person "
        "rule, that this skill never touches anything outside the spec's "
        "own four documents"
    )
