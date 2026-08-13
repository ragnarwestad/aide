"""Validation tests for template processing and placeholder replacement."""
import pytest
import re
from pathlib import Path


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
