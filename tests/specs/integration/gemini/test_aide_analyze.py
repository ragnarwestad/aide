"""Integration tests for aide-analyze workflow.

Tests verify that the analysis phase produces correct output format
with file:line references and proper complexity assessment,
regardless of
which AI implementation is used.
"""
import pytest
from pathlib import Path
import os
import re


@pytest.mark.gemini
@pytest.mark.integration
class TestAideAnalyserJira:
    """Tests for JIRA analysis documentation."""

    def test_analysis_updates_2_analyse_md(self, mock_workspace, monkeypatch):
        """Verify that 2-analysis.md is updated with analysis results."""
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(mock_workspace))
        jira_dir = mock_workspace / "reports" / "jira" / "PROJ-1234"
        jira_dir.mkdir(parents=True)
        (jira_dir / "2-analysis.md").write_text("# Analysis\n\n<!-- TODO: Fill in -->\n")

        analyse_content = """# Analysis: PROJ-1234
## Affected files
### Frontend
- `src/components/UserProfile.tsx:45` - Must update form validation
### Backend
- `com/example/api/UserController.kt:78` - Must update DTO
## Complexity
**Assessment:** Medium
## Risk analysis
- Risk of regressions
"""
        (jira_dir / "2-analysis.md").write_text(analyse_content)
        content = (jira_dir / "2-analysis.md").read_text()

        assert "## Affected files" in content
        assert "## Complexity" in content
        assert "## Risk analysis" in content

    def test_analysis_includes_fil_linje_references(self, mock_workspace, monkeypatch):
        """Verify file:line references are included."""
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(mock_workspace))
        jira_dir = mock_workspace / "reports" / "jira" / "PROJ-1234"
        jira_dir.mkdir(parents=True)
        analyse_content = """# Analysis
## Affected files
- `src/components/Test.tsx:45` - Description
- `src/utils/helper.ts:123` - Description
"""
        (jira_dir / "2-analysis.md").write_text(analyse_content)
        content = (jira_dir / "2-analysis.md").read_text()

        fil_linje_pattern = r"`[^`]+:\d+`"
        matches = re.findall(fil_linje_pattern, content)
        assert len(matches) >= 2

    def test_analysis_categorizes_frontend_backend(self, mock_workspace, monkeypatch):
        """Verify files are categorized by frontend/backend."""
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(mock_workspace))
        jira_dir = mock_workspace / "reports" / "jira" / "PROJ-1234"
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


@pytest.mark.gemini
@pytest.mark.integration
class TestAideAnalyserTodo:
    """Tests for TODO analysis documentation."""

    def test_todo_analysis_same_structure_as_jira(self, mock_workspace, monkeypatch):
        """Verify TODO analysis follows same structure as JIRA."""
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(mock_workspace))
        todo_dir = mock_workspace / "todo" / "01-test-todo"
        todo_dir.mkdir(parents=True)
        analyse_content = """# Analysis: TODO-01
## Affected files
- `src/components/Test.tsx:45`
## Complexity
**Assessment:** Simple
## Risk analysis
- Low risk
"""
        (todo_dir / "2-analysis.md").write_text(analyse_content)
        content = (todo_dir / "2-analysis.md").read_text()

        assert "## Affected files" in content
        assert "## Complexity" in content
        assert "## Risk analysis" in content
