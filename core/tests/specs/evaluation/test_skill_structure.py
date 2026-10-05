"""Structural validation of all SKILL.md files in .claude/skills/.

Verifies that each skill has the frontmatter fields Claude Code reads.
"""
import re
from pathlib import Path


SKILLS_DIR = (
    Path(__file__).parent.parent.parent.parent.parent
    / ".claude" / "skills"
)



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


def test_every_repo_skill_has_the_frontmatter_the_loader_reads():
    skills = get_skill_dirs()
    assert skills, "No skill directories with SKILL.md found"
    problems = []
    for skill_dir in skills:
        content = (skill_dir / "SKILL.md").read_text()
        fields = parse_frontmatter(content)
        if not content.startswith("---"):
            problems.append(f"{skill_dir.name}: no frontmatter")
        elif fields.get("name") != skill_dir.name:
            problems.append(f"{skill_dir.name}: name {fields.get('name')!r} does not match the directory")
        elif "description" not in fields:
            problems.append(f"{skill_dir.name}: no description")
    assert not problems, "\n".join(problems)
