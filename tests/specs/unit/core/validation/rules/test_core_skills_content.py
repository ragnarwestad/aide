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
# A pattern is written as a code span ending in `SHALL <response>`.
EARS_PATTERN = re.compile(r"`([^`]*SHALL <response>)`")


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


def ears_patterns(path):
    """Read whole pattern spans with whitespace collapsed and case preserved."""
    text = path.read_text(encoding="utf-8")
    return {" ".join(span.split()) for span in EARS_PATTERN.findall(text)}


@pytest.mark.validation
def test_the_create_skill_and_the_plan_review_give_the_rules_ears_patterns_AC_1_AC_2():
    rule = ears_patterns(REPO_ROOT / "core" / "rules" / "spec-structure.md")
    assert rule, "core/rules/spec-structure.md gives no EARS pattern"
    wrong = []
    for path in (
        CORE_SKILLS_DIR / "aide-create" / "SKILL.md",
        CORE_SKILLS_DIR / "aide-analyze" / "references" / "plan-review.md",
    ):
        copy = ears_patterns(path)
        where = path.relative_to(REPO_ROOT)
        wrong += [f"{where} gives {p!r}, which the rule does not" for p in sorted(copy - rule)]
        wrong += [f"{where} leaves out {p!r}" for p in sorted(rule - copy)]
    assert not wrong, "\n".join(wrong)
