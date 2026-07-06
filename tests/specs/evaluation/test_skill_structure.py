"""Structural validation of all SKILL.md files in .claude/skills/.

Verifies that each skill has required frontmatter fields and sections,
analogous to how test_templates.py validates documentation templates.
"""
import re
from pathlib import Path

import pytest

SKILLS_DIR = (
    Path(__file__).parent.parent.parent.parent
    / ".claude" / "skills"
)

REQUIRED_FRONTMATTER_FIELDS = ["name", "description"]


def get_skill_dirs() -> list[Path]:
    if not SKILLS_DIR.exists():
        return []
    return [d for d in SKILLS_DIR.iterdir() if d.is_dir() and (d / "SKILL.md").exists()]


def parse_frontmatter(content: str) -> dict:
    """Extract YAML frontmatter fields from a SKILL.md file."""
    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return {}
    fields = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            fields[key.strip()] = value.strip()
    return fields


class TestSkillFilesExist:
    """Every skill directory must have a SKILL.md."""

    def test_skills_directory_exists(self):
        assert SKILLS_DIR.exists(), f"Skills directory not found: {SKILLS_DIR}"

    def test_at_least_one_skill_found(self):
        skills = get_skill_dirs()
        assert len(skills) > 0, "No skill directories with SKILL.md found"

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_skill_md_exists(self, skill_dir):
        assert (skill_dir / "SKILL.md").exists()


class TestSkillFrontmatter:
    """SKILL.md files must have valid YAML frontmatter."""

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_frontmatter(self, skill_dir):
        content = (skill_dir / "SKILL.md").read_text()
        assert content.startswith("---"), f"{skill_dir.name}: SKILL.md must start with YAML frontmatter (---)"

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_name_field(self, skill_dir):
        content = (skill_dir / "SKILL.md").read_text()
        fields = parse_frontmatter(content)
        assert "name" in fields, f"{skill_dir.name}: frontmatter must have 'name' field"
        assert fields["name"], f"{skill_dir.name}: 'name' field must not be empty"

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_name_matches_directory(self, skill_dir):
        content = (skill_dir / "SKILL.md").read_text()
        fields = parse_frontmatter(content)
        if "name" in fields:
            assert fields["name"] == skill_dir.name, (
                f"{skill_dir.name}: frontmatter 'name' ({fields['name']}) "
                f"must match directory name ({skill_dir.name})"
            )

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_description_field(self, skill_dir):
        content = (skill_dir / "SKILL.md").read_text()
        fields = parse_frontmatter(content)
        assert "description" in fields, f"{skill_dir.name}: frontmatter must have 'description' field"


class TestSkillContent:
    """SKILL.md files must have meaningful content."""

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_main_heading(self, skill_dir):
        content = (skill_dir / "SKILL.md").read_text()
        headings = re.findall(r"^#\s+.+", content, re.MULTILINE)
        assert len(headings) >= 1, f"{skill_dir.name}: SKILL.md must have at least one # heading"

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_not_empty(self, skill_dir):
        content = (skill_dir / "SKILL.md").read_text()
        # Exclude frontmatter from length check
        body = re.sub(r"^---.*?---\n", "", content, flags=re.DOTALL)
        assert len(body.strip()) > 50, f"{skill_dir.name}: SKILL.md body is too short"
