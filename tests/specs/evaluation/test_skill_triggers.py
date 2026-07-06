"""Static trigger validation for all SKILL.md files.

Verifies that each skill's description field contains correct trigger phrases,
negative guards, and that trigger phrases are unique across skills.

This is a static analysis approach — no AI API calls required.
"""
import re
from pathlib import Path

import pytest

SKILLS_DIR = (
    Path(__file__).parent.parent.parent.parent
    / ".claude" / "skills"
)


def get_skill_dirs() -> list[Path]:
    if not SKILLS_DIR.exists():
        return []
    return [d for d in SKILLS_DIR.iterdir() if d.is_dir() and (d / "SKILL.md").exists()]


def get_description(skill_dir: Path) -> str:
    """Extract the full description block from frontmatter."""
    content = (skill_dir / "SKILL.md").read_text()
    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return ""
    frontmatter = match.group(1)
    # Extract multi-line description (>-, |, or single line)
    desc_match = re.search(r"description:\s*(?:>-|>|\|)?\s*\n((?:  .+\n?)+)", frontmatter)
    if desc_match:
        return desc_match.group(1)
    desc_match = re.search(r"description:\s*(.+)", frontmatter)
    if desc_match:
        return desc_match.group(1)
    return ""


def has_triggers_field(skill_dir: Path) -> bool:
    """Check if skill uses explicit Triggers: field (script-driven skills)."""
    desc = get_description(skill_dir)
    return "Triggers:" in desc or "triggers:" in desc.lower()


class TestSkillUsageGuides:
    """Every skill must have 'Use when' in the description."""

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_use_when(self, skill_dir):
        desc = get_description(skill_dir)
        assert "Use when" in desc or "use when" in desc.lower(), (
            f"{skill_dir.name}: description must contain 'Use when' trigger guidance"
        )

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_use_when_is_not_empty(self, skill_dir):
        desc = get_description(skill_dir)
        match = re.search(r"[Uu]se when[:\s]+(.+)", desc)
        assert match and len(match.group(1).strip()) > 10, (
            f"{skill_dir.name}: 'Use when' clause must have meaningful content"
        )


class TestKnowledgeSkillNegativeGuards:
    """Knowledge skills (without explicit Triggers:) must have 'Do NOT use for'."""

    @pytest.mark.parametrize(
        "skill_dir",
        [d for d in get_skill_dirs() if not has_triggers_field(d)],
        ids=lambda d: d.name,
    )
    def test_has_do_not_use_for(self, skill_dir):
        desc = get_description(skill_dir)
        assert "Do NOT use for" in desc or "do not use for" in desc.lower(), (
            f"{skill_dir.name}: knowledge skill description must contain 'Do NOT use for' "
            f"to prevent over-activation"
        )

    @pytest.mark.parametrize(
        "skill_dir",
        [d for d in get_skill_dirs() if not has_triggers_field(d)],
        ids=lambda d: d.name,
    )
    def test_do_not_use_for_is_not_empty(self, skill_dir):
        desc = get_description(skill_dir)
        match = re.search(r"[Dd]o NOT use for[:\s]+(.+)", desc)
        assert match and len(match.group(1).strip()) > 10, (
            f"{skill_dir.name}: 'Do NOT use for' clause must have meaningful content"
        )


class TestScriptSkillTriggers:
    """Script-driven skills must have explicit Triggers: phrases."""

    @pytest.mark.parametrize(
        "skill_dir",
        [d for d in get_skill_dirs() if has_triggers_field(d)],
        ids=lambda d: d.name,
    )
    def test_has_at_least_one_trigger_phrase(self, skill_dir):
        desc = get_description(skill_dir)
        match = re.search(r"[Tt]riggers?[:\s]+(.+)", desc)
        assert match, f"{skill_dir.name}: Triggers field found but no content after it"
        phrases = [p.strip().strip('"') for p in match.group(1).split(",") if p.strip()]
        assert len(phrases) >= 1, (
            f"{skill_dir.name}: must have at least one trigger phrase"
        )

    @pytest.mark.parametrize(
        "skill_dir",
        [d for d in get_skill_dirs() if has_triggers_field(d)],
        ids=lambda d: d.name,
    )
    def test_trigger_phrases_are_specific(self, skill_dir):
        desc = get_description(skill_dir)
        match = re.search(r"[Tt]riggers?[:\s]+(.+)", desc)
        if not match:
            return
        phrases = [p.strip().strip('"').strip("'") for p in match.group(1).split(",") if p.strip()]
        for phrase in phrases:
            assert len(phrase) >= 3, (
                f"{skill_dir.name}: trigger phrase '{phrase}' is too short (< 3 chars)"
            )


class TestTriggerUniqueness:
    """No two skills should share identical trigger phrases."""

    def test_no_duplicate_trigger_phrases(self):
        seen: dict[str, str] = {}
        duplicates: list[str] = []

        for skill_dir in get_skill_dirs():
            desc = get_description(skill_dir)
            match = re.search(r"[Tt]riggers?[:\s]+(.+)", desc)
            if not match:
                continue
            phrases = [p.strip().strip('"').strip("'").lower() for p in match.group(1).split(",") if p.strip()]
            for phrase in phrases:
                if phrase in seen:
                    duplicates.append(
                        f"'{phrase}' appears in both '{seen[phrase]}' and '{skill_dir.name}'"
                    )
                else:
                    seen[phrase] = skill_dir.name

        assert not duplicates, "Duplicate trigger phrases found:\n" + "\n".join(duplicates)
