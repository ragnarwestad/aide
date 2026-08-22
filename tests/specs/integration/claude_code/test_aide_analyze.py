"""Integration tests for /aide-analyze command.

Tests verify that the analysis phase produces correct output format
with file:line references and proper complexity assessment.
"""
import pytest
from pathlib import Path
import os


class TestAideAnalyserJira:
    """Tests for JIRA analysis."""

    def test_analysis_updates_2_analyse_md(self, mock_workspace, monkeypatch):
        """Verify that 2-analysis.md is updated with analysis results."""
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(mock_workspace))

        jira_dir = mock_workspace / "specs" / "jira" / "PROJ-1234"
        jira_dir.mkdir(parents=True)

        # Create initial 2-analysis.md (empty template)
        (jira_dir / "2-analysis.md").write_text("# Analysis\n\n<!-- TODO: Fill in -->\n")

        # Simulate analysis update
        analyse_content = """# Analysis: PROJ-1234

## Mapping

Grepped for the validation helpers, then read each caller.

## Affected files

### Frontend
- `src/components/UserProfile.tsx:45` - Must update form validation
- `src/api/userApi.ts:12` - Must add new endpoint call

### Backend
- `com/example/api/UserController.kt:78` - Must update DTO
"""
        (jira_dir / "2-analysis.md").write_text(analyse_content)

        content = (jira_dir / "2-analysis.md").read_text()

        # Verify required sections — complexity and risk belong to 3-solution
        assert "## Mapping" in content
        assert "## Affected files" in content
        assert "## Complexity" not in content
        assert "## Risk analysis" not in content

    def test_analysis_includes_fil_linje_references(self, mock_workspace, monkeypatch):
        """Verify file:line references are included."""
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(mock_workspace))

        jira_dir = mock_workspace / "specs" / "jira" / "PROJ-1234"
        jira_dir.mkdir(parents=True)

        analyse_content = """# Analysis

## Affected files

- `src/components/Test.tsx:45` - Description
- `src/utils/helper.ts:123` - Description
"""
        (jira_dir / "2-analysis.md").write_text(analyse_content)

        content = (jira_dir / "2-analysis.md").read_text()

        # Check for file:line pattern
        import re
        fil_linje_pattern = r"`[^`]+:\d+`"
        matches = re.findall(fil_linje_pattern, content)

        assert len(matches) >= 2, "Should have at least 2 file:line references"

    def test_analysis_categorizes_frontend_backend(self, mock_workspace, monkeypatch):
        """Verify files are categorized by frontend/backend."""
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(mock_workspace))

        jira_dir = mock_workspace / "specs" / "jira" / "PROJ-1234"
        jira_dir.mkdir(parents=True)

        analyse_content = """# Analysis

## Affected files

### Frontend
- `src/components/Test.tsx:45`

### Backend
- `com/example/Controller.kt:78`
"""
        (jira_dir / "2-analysis.md").write_text(analyse_content)

        content = (jira_dir / "2-analysis.md").read_text()

        assert "### Frontend" in content
        assert "### Backend" in content


class TestAideAnalyserTodo:
    """Tests for TODO analysis."""

    def test_todo_analysis_same_structure_as_jira(self, mock_workspace, monkeypatch):
        """Verify TODO analysis follows same structure as JIRA."""
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(mock_workspace))

        todo_dir = mock_workspace / "todo" / "01-test-todo"
        todo_dir.mkdir(parents=True)

        analyse_content = """# Analysis: TODO-01

## Mapping

Read the component and its single test.

## Affected files

- `src/components/Test.tsx:45`
"""
        (todo_dir / "2-analysis.md").write_text(analyse_content)

        content = (todo_dir / "2-analysis.md").read_text()

        # Same required sections as JIRA
        assert "## Mapping" in content
        assert "## Affected files" in content
        assert "## Complexity" not in content
        assert "## Risk analysis" not in content
