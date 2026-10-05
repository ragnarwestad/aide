"""What a skill's text hands to code: the scripts its bash blocks call
exist, and the reopen boundary is written in the grammar its readers
parse. Names and formats only — never a sentence of a skill."""
import re
import subprocess

import pytest

from . import test_core_skills
from .test_core_skills import CORE_SKILLS_DIR

REPO_ROOT = CORE_SKILLS_DIR.parent.parent
BASH_BLOCK = re.compile(r"```(?:bash|sh)\n(.*?)```", re.S)
COMMAND = re.compile(r"\s*(?:[A-Z_]+=\S+\s+)*(aide-[a-z0-9-]+)\b")
# A pattern is written as a code span ending in `SHALL <response>`.
EARS_PATTERN = re.compile(r"`([^`]*SHALL <response>)`")


@pytest.mark.validation
def test_every_aide_script_a_skill_runs_exists():
    sources = list(CORE_SKILLS_DIR.rglob("*.md"))
    called = {}
    for path in sources:
        for block in BASH_BLOCK.findall(path.read_text(encoding="utf-8")):
            for line in block.splitlines():
                match = COMMAND.match(line)
                if match:
                    called.setdefault(match.group(1), path.relative_to(REPO_ROOT))
    assert "aide-wiki" in called, "the extraction found none of the known calls"
    missing = {name: str(where) for name, where in called.items()
               if not (REPO_ROOT / "core" / "scripts" / name).is_file()}
    assert not missing, f"skills run scripts core/scripts does not have: {missing}"


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


@pytest.mark.validation
def test_the_create_skill_hands_the_given_description_to_aide_create_spec_AC_2():
    """The check that keeps a description's own criteria word for word
    runs only when the skill passes the description as it came in."""
    skill = (CORE_SKILLS_DIR / "aide-create" / "SKILL.md").read_text(encoding="utf-8")
    calls = [block for block in BASH_BLOCK.findall(skill)
             if "aide-create-spec" in block and "--description" in block]
    assert calls, "the create skill has no aide-create-spec call passing --description"
    missing = [block for block in calls if "--given-description" not in block]
    assert not missing, f"{len(missing)} of {len(calls)} calls pass no --given-description"


@pytest.mark.validation
def test_the_rule_the_reader_the_create_skill_and_the_plan_review_share_the_out_of_scope_heading_AC_1_AC_2_AC_3():
    """`aide_out_of_scope_section` finds a section only under the exact
    heading, so the rule's skeleton, the create skill and the plan review
    must all give that heading."""
    heading = "## Out of scope"
    rule = (REPO_ROOT / "core" / "rules" / "spec-structure.md").read_text(encoding="utf-8")
    assert f"\n{heading}\n" in rule, "the rule's skeleton does not give the heading"
    for path in (
        CORE_SKILLS_DIR / "aide-create" / "SKILL.md",
        CORE_SKILLS_DIR / "aide-analyze" / "references" / "plan-review.md",
    ):
        assert heading in path.read_text(encoding="utf-8"), f"{path.relative_to(REPO_ROOT)} does not name {heading!r}"
    lib = REPO_ROOT / "core" / "scripts" / "_aide-spec-lib.sh"
    description = f"Problem.\n\n{heading}\n\n- Not the queue.\n"
    found = subprocess.run(
        ["bash", "-c", f'source "{lib}"; aide_out_of_scope_section "$(printf %b "$1")"', "_", description],
        capture_output=True, text=True,
    )
    assert found.stdout.splitlines() == [heading, "", "- Not the queue."], found.stderr


@pytest.mark.validation
def test_the_rule_the_plan_step_the_plan_review_and_implement_share_the_test_places_heading_AC_5_AC_6():
    """Implement's RED step finds the plan's places by this heading, so the
    rule's skeleton, the plan step, the plan review and implement must all
    give it."""
    heading = "### Where the tests sit"
    rule = (REPO_ROOT / "core" / "rules" / "spec-structure.md").read_text(encoding="utf-8")
    assert f"\n{heading}\n" in rule, "the rule's skeleton does not give the heading"
    for path in (
        CORE_SKILLS_DIR / "aide-analyze" / "SKILL.md",
        CORE_SKILLS_DIR / "aide-analyze" / "references" / "plan-review.md",
        CORE_SKILLS_DIR / "aide-implement" / "SKILL.md",
    ):
        assert heading in path.read_text(encoding="utf-8"), f"{path.relative_to(REPO_ROOT)} does not name {heading!r}"


STEP_TITLE = re.compile(r"^#+ Step \d+ of \d+: (.+)$", re.M)
# A table row whose last three cells, stripped of padding, are the three grades.
GRADE_ROW = re.compile(r"^\s*\|[^|\n]*\|\s*LOW\s*\|\s*MEDIUM\s*\|\s*HIGH\s*\|\s*$", re.M)
GRADING_REFERENCE = "core/skills/aide-analyze/references/complexity-and-analysis.md"


@pytest.mark.validation
def test_analyze_grades_the_complexity_after_it_searches_the_code_AC_1():
    skill = (CORE_SKILLS_DIR / "aide-analyze" / "SKILL.md").read_text(encoding="utf-8")
    titles = STEP_TITLE.findall(skill)
    assert "Analyze the codebase" in titles, "the analyze skill has no search step"
    assert "Grade the complexity" in titles, "the analyze skill has no grading step"
    assert titles.index("Analyze the codebase") < titles.index("Grade the complexity")


@pytest.mark.validation
def test_the_grading_criteria_are_written_in_one_place_AC_5():
    holders = {
        str(path.relative_to(REPO_ROOT))
        for root in ("core", "docs")
        for path in (REPO_ROOT / root).rglob("*.md")
        if GRADE_ROW.search(path.read_text(encoding="utf-8"))
    }
    assert holders == {GRADING_REFERENCE}, f"the LOW/MEDIUM/HIGH table is in {sorted(holders)}"
    unpointed = [
        name for name in ("aide-analyze", "workflows", "task-workflow-assistant")
        if "complexity-and-analysis.md" not in (CORE_SKILLS_DIR / name / "SKILL.md").read_text(encoding="utf-8")
    ]
    assert not unpointed, f"these skills do not name the grading reference: {unpointed}"


STEP_HEADING = re.compile(r"^#+ Step \d+ of \d+: (.+)$", re.M)


def _analyze_steps():
    """The analyze skill's steps as (title, body), in the order written."""
    skill = (CORE_SKILLS_DIR / "aide-analyze" / "SKILL.md").read_text(encoding="utf-8")
    marks = list(STEP_HEADING.finditer(skill))
    return [
        (mark.group(1), skill[mark.end():marks[i + 1].start() if i + 1 < len(marks) else len(skill)])
        for i, mark in enumerate(marks)
    ]


@pytest.mark.validation
def test_analyze_compares_with_the_other_specs_between_writing_the_analysis_and_the_plan_AC_1():
    steps = _analyze_steps()
    titles = [title for title, _ in steps]
    writes_analysis = next(i for i, title in enumerate(titles) if "2-analysis.md" in title)
    writes_plan = next(i for i, title in enumerate(titles) if "3-solution.md" in title)
    runs_comparison = [i for i, (_, body) in enumerate(steps) if re.search(r"aide-spec-overlap[^\n]*--record", body)]
    assert runs_comparison, "no step of the analyze skill runs aide-spec-overlap with --record"
    assert all(writes_analysis < i < writes_plan for i in runs_comparison), (titles, runs_comparison)
