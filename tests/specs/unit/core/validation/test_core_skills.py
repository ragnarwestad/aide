"""Structure validation of all SKILL.md files in core/skills/.

core/skills/ is the source that install.sh copies to ~/.claude/skills/.
test_skill_structure.py only covers the repo's own .claude/skills/, so this
test covers the distributable skills — including that the effort field,
when set, has a valid value.
"""
import re
from pathlib import Path

import pytest

# tests/specs/unit/core/validation/test_core_skills.py -> doc-aide/
CORE_SKILLS_DIR = Path(__file__).parents[5] / "core" / "skills"

VALID_EFFORT_LEVELS = {"low", "medium", "high", "xhigh"}


def get_skill_dirs() -> list[Path]:
    if not CORE_SKILLS_DIR.exists():
        return []
    return [
        d for d in CORE_SKILLS_DIR.iterdir()
        if d.is_dir() and (d / "SKILL.md").exists()
    ]


def parse_frontmatter(content: str) -> dict:
    """Extract flat YAML frontmatter fields from a SKILL.md file."""
    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return {}
    fields = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            fields[key.strip()] = value.strip()
    return fields


@pytest.mark.validation
class TestCoreSkillsExist:
    """Every skill directory in core/skills/ must have a SKILL.md."""

    def test_core_skills_directory_exists(self):
        assert CORE_SKILLS_DIR.exists(), f"core/skills/ not found: {CORE_SKILLS_DIR}"

    def test_at_least_one_skill_found(self):
        assert len(get_skill_dirs()) > 0, "No skill directories with SKILL.md in core/skills/"

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_skill_md_exists(self, skill_dir):
        assert (skill_dir / "SKILL.md").exists()


@pytest.mark.validation
class TestCoreSkillFrontmatter:
    """SKILL.md files in core/skills/ must have valid YAML frontmatter."""

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_frontmatter(self, skill_dir):
        content = (skill_dir / "SKILL.md").read_text()
        assert content.startswith("---"), (
            f"{skill_dir.name}: SKILL.md must start with YAML frontmatter (---)"
        )

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_name_field(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        assert fields.get("name"), f"{skill_dir.name}: frontmatter must have a non-empty 'name' field"

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_name_matches_directory(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        if "name" in fields:
            assert fields["name"] == skill_dir.name, (
                f"{skill_dir.name}: frontmatter 'name' ({fields['name']}) "
                f"must match the directory name ({skill_dir.name})"
            )

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_description_field(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        assert "description" in fields, f"{skill_dir.name}: frontmatter must have a 'description' field"


@pytest.mark.validation
class TestCoreSkillEffort:
    """The effort field controls reasoning level per skill (Claude Code)."""

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_effort_value_is_valid_when_present(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        if "effort" in fields:
            assert fields["effort"] in VALID_EFFORT_LEVELS, (
                f"{skill_dir.name}: 'effort' ({fields['effort']!r}) must be one of "
                f"{sorted(VALID_EFFORT_LEVELS)}"
            )

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_effort_field(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        assert "effort" in fields, (
            f"{skill_dir.name}: frontmatter must have an 'effort' field "
            f"(one of {sorted(VALID_EFFORT_LEVELS)}) — set the reasoning level deliberately per skill"
        )
