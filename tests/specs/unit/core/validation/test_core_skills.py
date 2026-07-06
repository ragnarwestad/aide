"""Strukturvalidering av alle SKILL.md-filer i core/skills/.

core/skills/ er kilden som install.sh kopierer til ~/.claude/skills/.
test_skill_structure.py dekker kun repoets egne .claude/skills/, så denne
testen dekker de distribuerbare skillene — inkludert at effort-feltet,
når satt, har en gyldig verdi.
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
    """Hent ut flate YAML-frontmatter-felt fra en SKILL.md-fil."""
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
    """Hver skill-katalog i core/skills/ må ha en SKILL.md."""

    def test_core_skills_directory_exists(self):
        assert CORE_SKILLS_DIR.exists(), f"Fant ikke core/skills/: {CORE_SKILLS_DIR}"

    def test_at_least_one_skill_found(self):
        assert len(get_skill_dirs()) > 0, "Ingen skill-kataloger med SKILL.md i core/skills/"

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_skill_md_exists(self, skill_dir):
        assert (skill_dir / "SKILL.md").exists()


@pytest.mark.validation
class TestCoreSkillFrontmatter:
    """SKILL.md-filer i core/skills/ må ha gyldig YAML-frontmatter."""

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_frontmatter(self, skill_dir):
        content = (skill_dir / "SKILL.md").read_text()
        assert content.startswith("---"), (
            f"{skill_dir.name}: SKILL.md må starte med YAML-frontmatter (---)"
        )

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_name_field(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        assert fields.get("name"), f"{skill_dir.name}: frontmatter må ha ikke-tomt 'name'-felt"

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_name_matches_directory(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        if "name" in fields:
            assert fields["name"] == skill_dir.name, (
                f"{skill_dir.name}: frontmatter 'name' ({fields['name']}) "
                f"må matche katalognavnet ({skill_dir.name})"
            )

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_description_field(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        assert "description" in fields, f"{skill_dir.name}: frontmatter må ha 'description'-felt"


@pytest.mark.validation
class TestCoreSkillEffort:
    """effort-feltet styrer reasoning-nivå per skill (Claude Code)."""

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_effort_value_is_valid_when_present(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        if "effort" in fields:
            assert fields["effort"] in VALID_EFFORT_LEVELS, (
                f"{skill_dir.name}: 'effort' ({fields['effort']!r}) må være en av "
                f"{sorted(VALID_EFFORT_LEVELS)}"
            )

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_effort_field(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        assert "effort" in fields, (
            f"{skill_dir.name}: frontmatter må ha 'effort'-felt "
            f"(en av {sorted(VALID_EFFORT_LEVELS)}) — sett reasoning-nivå bevisst per skill"
        )
