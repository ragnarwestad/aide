"""Validation tests for the LOW/MEDIUM/HIGH grading criteria.

The grade is produced by an AI reading prose, so the only thing a test can
guard is that the prose says the same thing everywhere it is written down.
Two canonical docs state the rule (`core/skills/workflows/SKILL.md` and
`core/skills/aide-analyze/references/complexity-and-analysis.md`); this is
the parity test that keeps them from drifting apart, the same shape as
`test_the_two_copies_of_the_dependency_gate_agree` for WORKFLOW_STEPS.
"""
import re

import pytest

GRADING_RULE = (
    "The grade is the highest band Operation, Keywords or API impact "
    "reaches; Number of files is read last, as a signal, never a fourth "
    "vote, and never enough by itself to move a spec the other three "
    "read as LOW."
)

WORKED_EXAMPLE = (
    "Worked example: a wording fix replacing one string across an "
    "implementation file and its test — Operation is fix/replace (LOW), "
    "Keywords name the specific files (LOW), API impact is none (LOW). "
    "Touching four files sits inside the MEDIUM file-count range, but "
    "that range is not a vote, so the grade stays LOW."
)


def _flat(text: str) -> str:
    """Collapse markdown line wrapping so a sentence can be matched whole."""
    return re.sub(r"\s+", " ", text).strip()


def _section(text: str, heading: str) -> str:
    """Return the body of a markdown section, up to the next heading of the same level."""
    level = len(heading) - len(heading.lstrip("#"))
    pattern = (
        re.escape(heading)
        + r"\n(.*?)(?=\n#{1," + str(level) + r"} |\Z)"
    )
    match = re.search(pattern, text, re.DOTALL)
    assert match, f"section {heading!r} not found"
    return match.group(1)


@pytest.fixture
def workflows_skill(workspace_root):
    return (workspace_root / "core" / "skills" / "workflows" / "SKILL.md").read_text()


@pytest.fixture
def complexity_reference(workspace_root):
    return (
        workspace_root
        / "core"
        / "skills"
        / "aide-analyze"
        / "references"
        / "complexity-and-analysis.md"
    ).read_text()


@pytest.fixture
def analyze_skill(workspace_root):
    return (workspace_root / "core" / "skills" / "aide-analyze" / "SKILL.md").read_text()


@pytest.fixture
def task_workflow_assistant_skill(workspace_root):
    return (
        workspace_root / "core" / "skills" / "task-workflow-assistant" / "SKILL.md"
    ).read_text()


class TestGradingRuleParity:
    """The rule and its worked example must read identically in both canonical docs."""

    def test_workflows_skill_states_the_grading_rule(self, workflows_skill):
        assert _flat(GRADING_RULE) in _flat(workflows_skill), (
            "core/skills/workflows/SKILL.md is missing the grading-rule sentence"
        )

    def test_complexity_reference_states_the_same_grading_rule(self, complexity_reference):
        assert _flat(GRADING_RULE) in _flat(complexity_reference), (
            "complexity-and-analysis.md is missing the grading-rule sentence "
            "that core/skills/workflows/SKILL.md states"
        )

    def test_both_canonical_docs_carry_the_same_worked_example(
        self, workflows_skill, complexity_reference
    ):
        for name, text in (
            ("core/skills/workflows/SKILL.md", workflows_skill),
            ("complexity-and-analysis.md", complexity_reference),
        ):
            assert _flat(WORKED_EXAMPLE) in _flat(text), (
                f"{name} is missing the worked example anchoring the grading rule"
            )


class TestFileCountIsNotACriterion:
    """File count is a signal read last, not the table's first vote."""

    def test_number_of_files_is_the_last_row_and_marked_a_signal(self, complexity_reference):
        table = _section(complexity_reference, "## Classification")
        rows = [
            line for line in table.splitlines()
            if line.startswith("|") and not re.match(r"^\|[\s:-]+\|", line)
        ]
        header, data = rows[0], rows[1:]
        assert "Factor" in header, "the Classification table lost its header row"

        first_factor = data[0].split("|")[1].strip()
        last_factor = data[-1].split("|")[1].strip()

        assert first_factor.startswith("Operation"), (
            f"Operation should decide the grade and lead the table, not {first_factor!r}"
        )
        assert last_factor.startswith("Number of files"), (
            f"Number of files should be read last, but the last row is {last_factor!r}"
        )
        assert "signal" in last_factor.lower(), (
            "the Number of files row must be captioned as a signal, not a criterion: "
            f"{last_factor!r}"
        )

    def test_workflows_skill_states_file_counts_as_typical_not_definitive(self, workflows_skill):
        section = _flat(_section(workflows_skill, "## Complexity detection"))
        assert "Affects 1-2 files in total" not in section, (
            "the LOW file-count bullet still reads as a definition, not a typical range"
        )
        assert "May affect 3-10 files" not in section
        assert "Affects 10+ files" not in section
        assert section.count("Typically touches") == 3, (
            "each of LOW/MEDIUM/HIGH should state its file count as a typical range"
        )

    def test_analyze_skill_step_2_puts_file_count_last(self, analyze_skill):
        step_2 = _flat(_section(analyze_skill, "### Step 2: Detect complexity"))
        assert "based on the number of files, operation type" not in step_2, (
            "Step 2 still lists the number of files as the first classification factor"
        )
        decisive = step_2.find("Operation, Keywords and API impact decide the grade")
        assert decisive != -1, (
            "Step 2 must name Operation, Keywords and API impact as what decides the grade"
        )
        signal = step_2.find("number of files")
        assert signal > decisive, (
            "Step 2 must mention the number of files after the deciding factors, as a signal"
        )


class TestNoCompetingCopies:
    """Only the two canonical docs state bands; every other copy points at them."""

    def test_task_workflow_assistant_states_no_bands_of_its_own(
        self, task_workflow_assistant_skill
    ):
        section = _section(task_workflow_assistant_skill, "### Complexity")
        assert not re.search(r"\d+\s*(?:-|–|to)\s*\d+\s+files", section), (
            "task-workflow-assistant/SKILL.md states its own file-count bands; "
            "it must point at the workflows rules instead"
        )
        assert not re.search(r"[<>]\s*\d+\s+(?:files|hours)", section), (
            "task-workflow-assistant/SKILL.md states its own file/hour bands; "
            "it must point at the workflows rules instead"
        )
        assert "Complexity detection" in section, (
            "task-workflow-assistant/SKILL.md must point at the workflows rules "
            "§ Complexity detection"
        )

    def test_the_disconnected_complexity_helper_is_gone(self, workspace_root):
        text = (
            workspace_root
            / "tests"
            / "specs"
            / "integration"
            / "claude_code"
            / "test_aide_analyze.py"
        ).read_text()
        assert "_assess_complexity" not in text, (
            "_assess_complexity encodes the retired file-count-only formula and "
            "calls no production code"
        )
        assert "TestAideAnalyserComplexity" not in text
