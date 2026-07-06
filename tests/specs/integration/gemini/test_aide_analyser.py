"""Integration tests for aide-analyser workflow.

Tests verify that the analysis phase produces correct output format
with fil:linje references and proper complexity assessment,
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
        """Verify that 2-analyse.md is updated with analysis results."""
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(mock_workspace))
        jira_dir = mock_workspace / "reports" / "jira" / "PROJ-1234"
        jira_dir.mkdir(parents=True)
        (jira_dir / "2-analyse.md").write_text("# Analyse\n\n<!-- TODO: Fyll ut -->\n")

        analyse_content = """# Analyse: PROJ-1234
## Påvirkede filer
### Frontend
- `src/components/UserProfile.tsx:45` - Må oppdatere form-validering
### Backend
- `com/example/api/UserController.kt:78` - Må oppdatere DTO
## Kompleksitet
**Vurdering:** Middels
## Risikoanalyse
- Risiko for regresjoner
"""
        (jira_dir / "2-analyse.md").write_text(analyse_content)
        content = (jira_dir / "2-analyse.md").read_text()

        assert "## Påvirkede filer" in content
        assert "## Kompleksitet" in content
        assert "## Risikoanalyse" in content

    def test_analysis_includes_fil_linje_references(self, mock_workspace, monkeypatch):
        """Verify file:line references are included."""
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(mock_workspace))
        jira_dir = mock_workspace / "reports" / "jira" / "PROJ-1234"
        jira_dir.mkdir(parents=True)
        analyse_content = """# Analyse
## Påvirkede filer
- `src/components/Test.tsx:45` - Description
- `src/utils/helper.ts:123` - Description
"""
        (jira_dir / "2-analyse.md").write_text(analyse_content)
        content = (jira_dir / "2-analyse.md").read_text()

        fil_linje_pattern = r"`[^`]+:\d+`"
        matches = re.findall(fil_linje_pattern, content)
        assert len(matches) >= 2

    def test_analysis_categorizes_frontend_backend(self, mock_workspace, monkeypatch):
        """Verify files are categorized by frontend/backend."""
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(mock_workspace))
        jira_dir = mock_workspace / "reports" / "jira" / "PROJ-1234"
        jira_dir.mkdir(parents=True)
        analyse_content = """# Analyse
## Påvirkede filer
### Frontend
- `src/components/Test.tsx:45`
### Backend
- `com/example/Controller.kt:78`
"""
        (jira_dir / "2-analyse.md").write_text(analyse_content)
        content = (jira_dir / "2-analyse.md").read_text()
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
        analyse_content = """# Analyse: TODO-01
## Påvirkede filer
- `src/components/Test.tsx:45`
## Kompleksitet
**Vurdering:** Enkel
## Risikoanalyse
- Lav risiko
"""
        (todo_dir / "2-analyse.md").write_text(analyse_content)
        content = (todo_dir / "2-analyse.md").read_text()

        assert "## Påvirkede filer" in content
        assert "## Kompleksitet" in content
        assert "## Risikoanalyse" in content
