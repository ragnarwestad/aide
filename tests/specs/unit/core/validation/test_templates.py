"""Validation tests for template processing and placeholder replacement."""
import pytest
import re
from pathlib import Path


# Opening fence of a markdown example block, e.g. ```markdown or ````markdown.
_FENCE_OPEN = re.compile(r"^(`{3,})markdown[ \t]*$", re.M)


def structure_block(content: str, heading: str, level: str = "###") -> str:
    """Return the fenced markdown example under `<level> <heading>`.

    spec-structure.md (and the AGENTS.md it is concatenated into) documents
    each spec file as a fenced example whose BODY contains `## ` headings.
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
class TestSolutionOwnsTheCriteria:
    """3-solution.md owns acceptance criteria and the behavior delta.

    The strict separation says 1-description is ONLY the problem as
    reported — criteria for done-ness are part of the solution. And the
    solution must state what it changes in BEHAVIOR (adds/modifies/
    removes), not just which files it touches.
    """

    @staticmethod
    def _template(workspace_root, name):
        path = workspace_root / "core" / "templates" / "todo" / name
        if not path.exists():
            pytest.skip(f"{name} not found")
        return path.read_text()

    def test_solution_template_has_behavior_delta(self, workspace_root):
        content = self._template(workspace_root, "3-solution.md.template")
        assert "## Behavior delta" in content
        for marker in ("**Adds:**", "**Modifies:**", "**Removes:**"):
            assert marker in content, f"Behavior delta must have {marker}"

    def test_solution_template_has_given_when_then(self, workspace_root):
        content = self._template(workspace_root, "3-solution.md.template")
        assert "## Acceptance criteria" in content
        for word in ("Given", "when", "then"):
            assert word in content, \
                f"Acceptance criteria must be given/when/then scenarios ({word} missing)"

    def test_description_template_has_no_acceptance_criteria(self, workspace_root):
        content = self._template(workspace_root, "1-description.md.template")
        assert "cceptance criteria" not in content, \
            "1-description is ONLY the problem as reported — criteria live in 3-solution"

    def test_file_templates_put_criteria_in_solution(self, workspace_root):
        path = (workspace_root / "core" / "skills" / "aide-create"
                / "references" / "file-templates.md")
        if not path.exists():
            pytest.skip("file-templates.md not found")
        sections = {}
        for chunk in path.read_text().split("\n## "):
            header = chunk.splitlines()[0]
            sections[header] = chunk
        desc = next(v for k, v in sections.items() if k.startswith("1-description"))
        sol = next(v for k, v in sections.items() if k.startswith("3-solution"))
        assert "cceptance criteria" not in desc, \
            "file-templates.md must not put acceptance criteria in 1-description"
        assert "cceptance criteria" in sol, \
            "file-templates.md must put acceptance criteria in 3-solution"


@pytest.mark.validation
class TestScopeComplexityRiskLiveInSolution:
    """Scope, complexity and risk analysis belong to 3-solution.md.

    1-description is ONLY the problem as reported and 2-analysis is ONLY
    what the investigation found — an affected-files count, a complexity
    grade, an estimate and a risk assessment are all statements about the
    solution we intend to build, so they live in 3-solution.md.
    """

    @staticmethod
    def _rule(workspace_root):
        path = workspace_root / "core" / "rules" / "spec-structure.md"
        if not path.exists():
            pytest.skip("spec-structure.md not found")
        return path.read_text()

    @staticmethod
    def _template(workspace_root, name):
        path = workspace_root / "core" / "templates" / "todo" / name
        if not path.exists():
            pytest.skip(f"{name} not found")
        return path.read_text()

    @staticmethod
    def _file_templates(workspace_root):
        path = (workspace_root / "core" / "skills" / "aide-create"
                / "references" / "file-templates.md")
        if not path.exists():
            pytest.skip("file-templates.md not found")
        return path.read_text()

    @staticmethod
    def _section(content, prefix):
        """Slice the `## <prefix>...` section out of a headings-only doc."""
        headings = list(re.finditer(r"^## (.*)$", content, re.M))
        for index, heading in enumerate(headings):
            if heading.group(1).startswith(prefix):
                end = (headings[index + 1].start()
                       if index + 1 < len(headings) else len(content))
                return content[heading.start():end]
        raise AssertionError(f"no '## {prefix}' section found")

    # Criterion 1
    def test_rule_description_example_has_no_scope(self, workspace_root):
        block = structure_block(self._rule(workspace_root), "1-description")
        assert "## Scope" not in block, \
            "1-description is ONLY the problem — scope belongs to 3-solution"
        assert "- Scope" not in block, \
            "the 1-description table of contents must not list Scope"

    # Criterion 2
    def test_rule_analysis_example_has_no_scope_complexity_or_risk(self, workspace_root):
        block = structure_block(self._rule(workspace_root), "2-analysis")
        for heading in ("## Scope", "## Complexity", "## Risk analysis"):
            assert heading not in block, \
                f"2-analysis is findings only — '{heading}' belongs to 3-solution"

    # Criterion 3
    def test_rule_solution_example_has_scope_and_risk(self, workspace_root):
        block = structure_block(self._rule(workspace_root), "3-solution")
        for heading in ("## Scope", "## Risk analysis"):
            assert heading in block, \
                f"3-solution must own '{heading}'"

    def test_rule_separation_table_maps_to_solution(self, workspace_root):
        table = self._section(self._rule(workspace_root), "Separation of content")
        for row in ("Complexity analysis", "Risk analysis", "Scope"):
            line = next((l for l in table.splitlines() if l.startswith(f"| {row}")), None)
            assert line, f"the separation table must have a '{row}' row"
            assert "3-solution.md" in line, \
                f"'{row}' must be mapped to 3-solution.md, not: {line}"

    # Criterion 4
    def test_file_templates_description_has_no_scope(self, workspace_root):
        section = self._section(self._file_templates(workspace_root), "1-description.md")
        assert "Scope" not in section, \
            "file-templates.md must not put Scope in 1-description"

    # Criterion 5
    def test_file_templates_analysis_has_no_complexity_or_risk(self, workspace_root):
        section = self._section(self._file_templates(workspace_root), "2-analysis.md")
        for word in ("Complexity", "Risk analysis"):
            assert word not in section, \
                f"file-templates.md must not put {word} in 2-analysis"

    # Criterion 6
    def test_file_templates_solution_has_scope_and_risk(self, workspace_root):
        section = self._section(self._file_templates(workspace_root), "3-solution.md")
        for word in ("Scope", "Risk analysis"):
            assert word in section, \
                f"file-templates.md must put {word} in 3-solution"

    # Criterion 7
    def test_description_template_has_no_scope(self, workspace_root):
        content = self._template(workspace_root, "1-description.md.template")
        assert "## Scope" not in content

    def test_analysis_template_has_no_scope_complexity_or_risk(self, workspace_root):
        content = self._template(workspace_root, "2-analysis.md.template")
        for heading in ("## Scope", "## Complexity", "## Risk analysis"):
            assert heading not in content, f"2-analysis must not own '{heading}'"

    # Criterion 8
    def test_solution_template_has_scope_and_risk(self, workspace_root):
        content = self._template(workspace_root, "3-solution.md.template")
        for heading in ("## Scope", "## Risk analysis"):
            assert heading in content, f"3-solution must own '{heading}'"

    # Criterion 9
    def test_readme_templates_use_a_toc_heading(self, workspace_root):
        readme = self._template(workspace_root, "0-README.md.template")
        blurbs = structure_block(
            self._file_templates(workspace_root), "0-README.md", level="##"
        )
        for name, content in (("0-README.md.template", readme),
                              ("file-templates.md", blurbs)):
            assert "## Table of contents" in content, \
                f"{name} must use a '## Table of contents' heading"
            assert "**Table of contents:**" not in content, \
                f"{name} must not use a bold table-of-contents line"


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
        step = self._step(workspace_root, "Step 4")
        instruction = step.split("Include:", 1)[1].split("\n\n", 1)[0]
        for word in ("complexity", "risk analysis", "estimate"):
            assert word not in instruction.lower(), \
                f"/aide-analyze must not ask for {word} in 2-analysis.md"

    def test_solution_step_asks_for_scope_and_risk(self, workspace_root):
        step = self._step(workspace_root, "Step 5")
        for marker in ("**Scope:**", "**Risk analysis:**"):
            assert marker in step, \
                f"/aide-analyze must ask for {marker} in 3-solution.md"


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
