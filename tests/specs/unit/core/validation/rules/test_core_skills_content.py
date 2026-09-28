"""What a skill's text hands to code: the scripts its bash blocks call
exist, and the reopen boundary is written in the grammar its readers
parse. Names and formats only — never a sentence of a skill."""
import re

import pytest

from .test_core_skills import CORE_SKILLS_DIR

REPO_ROOT = CORE_SKILLS_DIR.parent.parent
BASH_BLOCK = re.compile(r"```(?:bash|sh)\n(.*?)```", re.S)
COMMAND = re.compile(r"\s*(?:[A-Z_]+=\S+\s+)*(aide-[a-z0-9-]+)\b")


@pytest.mark.validation
def test_every_aide_script_a_skill_or_agent_runs_exists():
    sources = list(CORE_SKILLS_DIR.rglob("*.md")) + list(
        (REPO_ROOT / "implementations" / "claude-code" / "agents").glob("*.md")
    )
    called = {}
    for path in sources:
        for block in BASH_BLOCK.findall(path.read_text(encoding="utf-8")):
            for line in block.splitlines():
                match = COMMAND.match(line)
                if match:
                    called.setdefault(match.group(1), path.relative_to(REPO_ROOT))
    assert "aide-write-spec" in called, "the extraction found none of the known calls"
    missing = {name: str(where) for name, where in called.items()
               if not (REPO_ROOT / "core" / "scripts" / name).is_file()}
    assert not missing, f"skills run scripts core/scripts does not have: {missing}"


@pytest.mark.validation
def test_the_reopen_boundary_is_written_in_the_grammar_the_readers_parse():
    """One grammar, several readers: `completed_steps_for` in
    `core/scripts/aide-run-spec` and the dashboard's status parsers."""
    skill = (CORE_SKILLS_DIR / "aide-reopen" / "SKILL.md").read_text()
    assert "**Reopened:**" in skill
    assert "history before" in skill
