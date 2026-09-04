"""Validation tests for template processing and placeholder replacement."""
import pytest
import re
from pathlib import Path


# Opening fence of a markdown example block, e.g. ```markdown or ````markdown.
_FENCE_OPEN = re.compile(r"^(`{3,})markdown[ \t]*$", re.M)


def structure_block(content: str, heading: str, level: str = "###") -> str:
    """Return the fenced markdown example under `<level> <heading>`.

    spec-structure.md (and the core/skills/spec-structure/SKILL.md
    generated from it) documents each spec file as a fenced example whose
    BODY contains `## ` headings.
    Splitting the whole document on `\\n## ` therefore collides on headings
    that several examples share — `## Scope` appears in both the
    1-description and the 2-analysis example. Isolate one example first,
    then look for headings inside it.
    """
    start = content.index(f"\n{level} {heading}\n")
    opening = _FENCE_OPEN.search(content, start)
    assert opening, f"no fenced example under '{level} {heading}'"
    fence = opening.group(1)
    body_start = opening.end() + 1
    closing = re.compile(rf"^{fence}[ \t]*$", re.M).search(content, body_start)
    assert closing, f"unterminated fenced example under '{level} {heading}'"
    return content[body_start:closing.start()]


@pytest.mark.validation
class TestPlaceholderReplacement:
    """Test that templates contain expected placeholders."""

    def test_todo_templates_contain_placeholders(self, workspace_root):
        """Test that TODO templates actually contain placeholders (sanity check)."""
        # Arrange
        templates_dir = workspace_root / "core" / "templates" / "todo"

        if not templates_dir.exists():
            pytest.skip("Templates directory not found - using mock workspace")

        # Act & Assert
        template_files = list(templates_dir.glob("*.template"))
        assert len(template_files) > 0, "Should have template files"

        placeholder_pattern = re.compile(r'\{\{[A-Z_]+\}\}')

        for template_path in template_files:
            # Skip README template - it doesn't have placeholders
            if template_path.name.startswith("0-README"):
                continue
            content = template_path.read_text()
            placeholders = placeholder_pattern.findall(content)
            assert len(placeholders) > 0, \
                f"{template_path.name} should contain placeholders, but found none"








@pytest.mark.validation
class TestTaskWorkflowAssistantMatchesTheLayout:
    """The task-analyzer agent restates the 4-file layout — independently.

    It is a second source of truth for what each file contains, so it has
    to move Scope, Complexity and Risk analysis to solution.md too.
    """

    @staticmethod
    def _skill_sections(workspace_root):
        path = (workspace_root / "core" / "skills" / "task-workflow-assistant"
                / "SKILL.md")
        if not path.exists():
            pytest.skip("task-workflow-assistant/SKILL.md not found")
        content = path.read_text()
        sections = {}
        headings = list(re.finditer(r"^### (.*)$", content, re.M))
        for index, heading in enumerate(headings):
            end = (headings[index + 1].start()
                   if index + 1 < len(headings) else len(content))
            sections[heading.group(1)] = content[heading.start():end]
        return sections

    @staticmethod
    def _bullets(section):
        return [line for line in section.splitlines() if line.startswith("- ")]

    # Criterion 10 — checked against the list items, not the whole file:
    # the word "scope" also turns up in ordinary prose.
    def test_description_content_has_no_scope_bullet(self, workspace_root):
        bullets = self._bullets(self._skill_sections(workspace_root)["1. description.md"])
        assert not [b for b in bullets if "Scope" in b], \
            "description.md must not claim to hold Scope"

    def test_analysis_content_has_no_complexity_or_risk_bullet(self, workspace_root):
        bullets = self._bullets(self._skill_sections(workspace_root)["2. analysis.md"])
        for word in ("Complexity", "Risk analysis"):
            assert not [b for b in bullets if word in b], \
                f"analysis.md must not claim to hold {word}"

    def test_solution_content_has_scope_and_risk_bullets(self, workspace_root):
        bullets = self._bullets(self._skill_sections(workspace_root)["3. solution.md"])
        for word in ("Scope", "Risk analysis"):
            assert [b for b in bullets if word in b], \
                f"solution.md must claim to hold {word}"


@pytest.mark.validation
class TestAnalyzeSkillFillsTheRightFiles:
    """/aide-analyze is what actually writes 2-analysis.md and 3-solution.md.

    Its step-by-step instructions name the contents of each file directly,
    so a template fix that leaves them alone still produces specs with
    complexity and risk in the analysis.
    """

    @staticmethod
    def _step(workspace_root, prefix):
        # Named by number AND title. Inserting a step renumbers every one
        # after it (spec 187 inserted Step 4), and a bare number would
        # quietly start asserting against whichever step took the place.
        path = workspace_root / "core" / "skills" / "aide-analyze" / "SKILL.md"
        if not path.exists():
            pytest.skip("aide-analyze/SKILL.md not found")
        content = path.read_text()
        headings = list(re.finditer(r"^### (.*)$", content, re.M))
        for index, heading in enumerate(headings):
            if heading.group(1).startswith(prefix):
                end = (headings[index + 1].start()
                       if index + 1 < len(headings) else len(content))
                return content[heading.start():end]
        raise AssertionError(f"no '### {prefix}' step found")

    def test_analysis_step_asks_for_findings_only(self, workspace_root):
        step = self._step(workspace_root, "Step 5: Update 2-analysis.md")
        instruction = step.split("Include:", 1)[1].split("\n\n", 1)[0]
        for word in ("complexity", "risk analysis", "estimate"):
            assert word not in instruction.lower(), \
                f"/aide-analyze must not ask for {word} in 2-analysis.md"

    def test_solution_step_asks_for_scope_and_risk(self, workspace_root):
        step = self._step(workspace_root, "Step 6: Create the implementation plan")
        for marker in ("**Scope:**", "**Risk analysis:**"):
            assert marker in step, \
                f"/aide-analyze must ask for {marker} in 3-solution.md"


@pytest.mark.validation
class TestSkillsResumeWorkAlreadyBegun:
    """A step stopped by its clock commits what it wrote and the branch is
    landed (spec 187), so the NEXT run of that step opens files that are
    already part-written. Both writing skills have to look before they
    write, or the second run pays for the first run's work again.

    Static assertions only: whether a live model actually obeys the
    instruction is not something a test can execute — see the Manual
    testing note in the spec's 3-solution.md.
    """

    @staticmethod
    def _skill(workspace_root, name):
        path = workspace_root / "core" / "skills" / name / "SKILL.md"
        if not path.exists():
            pytest.skip(f"{name}/SKILL.md not found")
        return path.read_text()

    def test_analyze_checks_for_work_already_begun_before_writing(self, workspace_root):
        content = self._skill(workspace_root, "aide-analyze")
        headings = [m.group(1) for m in re.finditer(r"^### (Step \d+): (.*)$", content, re.M)]
        assert headings, "aide-analyze/SKILL.md has no numbered workflow steps"
        check = [h for h, title in
                 [(m.group(1), m.group(2)) for m in re.finditer(r"^### (Step \d+): (.*)$", content, re.M)]
                 if "already begun" in title.lower()]
        assert check, \
            "/aide-analyze must have a step that checks for work already begun"
        # Before the file-writing steps: checking afterwards is checking
        # what this run just wrote.
        order = headings.index(check[0])
        for writes in ("2-analysis.md", "3-solution.md", "4-status.md"):
            writing = [h for h, title in
                       [(m.group(1), m.group(2)) for m in re.finditer(r"^### (Step \d+): (.*)$", content, re.M)]
                       if writes in title]
            assert writing, f"/aide-analyze must still have a step that writes {writes}"
            assert order < headings.index(writing[0]), \
                f"the already-begun check must come before the step writing {writes}"

    def test_analyze_names_the_placeholder_rule_not_the_headings(self, workspace_root):
        content = self._skill(workspace_root, "aide-analyze")
        step = content.split("### Step 4: Check for work already begun", 1)[1].split("\n### ", 1)[0]
        # The literal placeholder text is the signal, named outright.
        assert "[not analyzed yet]" in step and "[not started]" in step, \
            "the check must name the template's own placeholder text"
        # And heading-counting is ruled out: a half-written section has
        # its heading exactly as a finished one does.
        assert "heading" in step.lower(), \
            "the check must say that counting headings is not enough"

    def test_implement_reads_the_phase_table_before_starting_red(self, workspace_root):
        content = self._skill(workspace_root, "aide-implement")
        prep = content.split("### Preparation", 1)[1].split("\n### ", 1)[0]
        assert "4-status.md" in prep, \
            "/aide-implement's Preparation must read 4-status.md"
        assert "phase" in prep.lower(), \
            "/aide-implement's Preparation must name the phase table it reads"
        for symbol in ("✅", "⬜"):
            assert symbol in prep, \
                f"/aide-implement's Preparation must name the {symbol} status the table uses"
@pytest.mark.validation
class TestE2eSuiteExpectsTheNewAnalysisLayout:
    """The e2e suites assert which sections a real 2-analysis.md must have.

    They run the actual slash commands, so they fail for real once the
    templates stop producing `## Scope` and `## Complexity` there. Reading
    their source needs no CLI, so this check is not skip-gated the way the
    e2e tests themselves are.
    """

    @pytest.mark.parametrize("tool", ["claude", "codex", "copilot"])
    def test_required_sections_dropped_scope_and_complexity(self, workspace_root, tool):
        path = workspace_root / "tests" / "specs" / "e2e" / f"test_{tool}_e2e.py"
        if not path.exists():
            pytest.skip(f"test_{tool}_e2e.py not found")
        content = path.read_text()
        listing = content.split("REQUIRED_SECTIONS_2_ANALYSE = [", 1)[1].split("]", 1)[0]
        for section in ('"## Scope"', '"## Complexity"'):
            assert section not in listing, \
                f"test_{tool}_e2e.py still requires {section} in 2-analysis.md"
        assert '"## Findings"' in listing, \
            f"test_{tool}_e2e.py must still require findings in 2-analysis.md"


@pytest.mark.validation
class TestRequiredPlaceholders:
    """Test that all expected placeholders exist in templates."""

    def test_todo_templates_have_required_placeholders(self, workspace_root):
        """Test TODO templates contain all required placeholders."""
        # Arrange
        templates_dir = workspace_root / "core" / "templates" / "todo"

        if not templates_dir.exists():
            pytest.skip("Templates directory not found")

        required_placeholders = {
            "{{TITLE_FORMATTED}}",  # TODO templates use TITLE_FORMATTED instead of TITLE
            "{{DESCRIPTION}}",
            "{{FOLDER_NAME}}"
        }

        # Act & Assert - Check description template has required fields
        description_template = templates_dir / "1-description.md.template"
        if description_template.exists():
            content = description_template.read_text()
            for placeholder in required_placeholders:
                assert placeholder in content, \
                    f"1-description.md.template should contain {placeholder}"
