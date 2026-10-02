"""What a skill's text hands to code: the scripts its bash blocks call
exist, and the reopen boundary is written in the grammar its readers
parse. Names and formats only — never a sentence of a skill."""
import re

import pytest

from . import test_core_skills
from .test_core_skills import CORE_SKILLS_DIR

REPO_ROOT = CORE_SKILLS_DIR.parent.parent
BASH_BLOCK = re.compile(r"```(?:bash|sh)\n(.*?)```", re.S)
COMMAND = re.compile(r"\s*(?:[A-Z_]+=\S+\s+)*(aide-[a-z0-9-]+)\b")
EARS_FORMS = (
    "The <system> SHALL <response>",
    "WHEN <trigger>, the <system> SHALL <response>",
    "WHILE <state>, the <system> SHALL <response>",
    "IF <condition>, THEN the <system> SHALL <response>",
    "WHERE <feature>, the <system> SHALL <response>",
)


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


@pytest.mark.validation
def test_analyze_reads_the_reuse_key_and_its_plan_and_review_share_the_parts_lines_AC_2_AC_3_AC_4():
    """The manifest documents `reuse`, the analyze skill reads it, and
    the plan step writes the Parts lines the plan review checks (AC-2,
    AC-3, AC-4)."""
    analyze = CORE_SKILLS_DIR / "aide-analyze"
    skill = (analyze / "SKILL.md").read_text(encoding="utf-8")
    review = (analyze / "references" / "plan-review.md").read_text(encoding="utf-8")
    assert "reuse" in test_core_skills.TestManifestTemplate.TOP_KEYS
    assert "`reuse`" in skill
    for form in ("Reused:", "New, because", "None —"):
        assert form in skill, f"the plan step does not write {form!r}"
        assert form in review, f"the plan review does not check {form!r}"


@pytest.mark.validation
def test_the_spec_structure_rule_gives_the_five_ears_patterns_AC_1():
    path = REPO_ROOT / "core" / "rules" / "spec-structure.md"
    text = path.read_text(encoding="utf-8")
    for form in EARS_FORMS:
        assert form in text, f"{path} does not give {form!r}"


@pytest.mark.validation
def test_the_create_skill_writes_the_five_ears_patterns_AC_2():
    path = CORE_SKILLS_DIR / "aide-create" / "SKILL.md"
    text = path.read_text(encoding="utf-8")
    for form in EARS_FORMS:
        assert form in text, f"{path} does not write {form!r}"


@pytest.mark.validation
def test_the_plan_review_checks_the_five_ears_patterns_AC_3():
    path = CORE_SKILLS_DIR / "aide-analyze" / "references" / "plan-review.md"
    text = path.read_text(encoding="utf-8")
    for form in EARS_FORMS:
        assert form in text, f"{path} does not check {form!r}"
