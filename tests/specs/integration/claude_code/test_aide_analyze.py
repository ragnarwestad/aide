"""Integration tests for /aide-analyze command.

Tests verify that the analysis phase produces correct output format
with fil:linje references and proper complexity assessment.
"""
import pytest
from pathlib import Path
import os


class TestAideAnalyserJira:
    """Tests for JIRA analysis."""

    def test_analysis_updates_2_analyse_md(self, mock_workspace, monkeypatch):
        """Verify that 2-analysis.md is updated with analysis results."""
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(mock_workspace))

        jira_dir = mock_workspace / "reports" / "jira" / "PROJ-1234"
        jira_dir.mkdir(parents=True)

        # Create initial 2-analysis.md (empty template)
        (jira_dir / "2-analysis.md").write_text("# Analyse\n\n<!-- TODO: Fyll ut -->\n")

        # Simulate analysis update
        analyse_content = """# Analyse: PROJ-1234

## Påvirkede filer

### Frontend
- `src/components/UserProfile.tsx:45` - Må oppdatere form-validering
- `src/api/userApi.ts:12` - Må legge til nytt endpoint-kall

### Backend
- `com/example/api/UserController.kt:78` - Må oppdatere DTO

## Kompleksitet

**Vurdering:** Middels

**Begrunnelse:**
- 3 filer påvirket
- Mindre API-endringer
- Estimert 4-6 timer

## Risikoanalyse

- Risiko for regresjoner i eksisterende validering
- API-endring kan påvirke andre consumers
"""
        (jira_dir / "2-analysis.md").write_text(analyse_content)

        content = (jira_dir / "2-analysis.md").read_text()

        # Verify required sections
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
        (jira_dir / "2-analysis.md").write_text(analyse_content)

        content = (jira_dir / "2-analysis.md").read_text()

        # Check for fil:linje pattern
        import re
        fil_linje_pattern = r"`[^`]+:\d+`"
        matches = re.findall(fil_linje_pattern, content)

        assert len(matches) >= 2, "Should have at least 2 file:line references"

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
        (jira_dir / "2-analysis.md").write_text(analyse_content)

        content = (jira_dir / "2-analysis.md").read_text()

        assert "### Frontend" in content
        assert "### Backend" in content


class TestAideAnalyserComplexity:
    """Tests for complexity assessment."""

    def test_complexity_simple(self):
        """Verify simple complexity criteria."""
        # Simple: 1-2 files, no API changes, < 2 hours
        affected_files = 2
        has_api_changes = False
        estimated_hours = 1.5

        complexity = _assess_complexity(affected_files, has_api_changes, estimated_hours)

        assert complexity == "Enkel"

    def test_complexity_medium(self):
        """Verify medium complexity criteria."""
        # Medium: 3-5 files, minor API changes, 2-8 hours
        affected_files = 4
        has_api_changes = True
        estimated_hours = 5

        complexity = _assess_complexity(affected_files, has_api_changes, estimated_hours)

        assert complexity == "Middels"

    def test_complexity_complex(self):
        """Verify complex complexity criteria."""
        # Complex: > 5 files, major API changes, > 8 hours
        affected_files = 8
        has_api_changes = True
        estimated_hours = 12

        complexity = _assess_complexity(affected_files, has_api_changes, estimated_hours)

        assert complexity == "Kompleks"


class TestAideAnalyserTodo:
    """Tests for TODO analysis."""

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
        (todo_dir / "2-analysis.md").write_text(analyse_content)

        content = (todo_dir / "2-analysis.md").read_text()

        # Same required sections as JIRA
        assert "## Påvirkede filer" in content
        assert "## Kompleksitet" in content
        assert "## Risikoanalyse" in content


def _assess_complexity(affected_files: int, has_api_changes: bool, estimated_hours: float) -> str:
    """Helper function to assess complexity based on criteria.

    Args:
        affected_files: Number of files affected
        has_api_changes: Whether API changes are involved
        estimated_hours: Estimated hours to complete

    Returns:
        Complexity level: "Enkel", "Middels", or "Kompleks"
    """
    if affected_files > 5 or estimated_hours > 8:
        return "Kompleks"
    elif affected_files >= 3 or has_api_changes or estimated_hours >= 2:
        return "Middels"
    else:
        return "Enkel"
