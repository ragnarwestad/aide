"""Shared assertion utilities for testing implementation outputs.

This module provides common assertions that all implementations should pass,
ensuring consistent behavior across Claude Code, Codex, and Copilot.
"""
from pathlib import Path
import re


def assert_jira_output_correct(reports_dir: Path, issue_key: str = "PROJ-1234"):
    """Assert that JIRA documentation output is correct.

    This validates the standard structure and content that ALL implementations
    should produce when creating JIRA documentation.

    Args:
        reports_dir: Path to the generated JIRA reports directory
        issue_key: The JIRA issue key (default: PROJ-1234)
    """
    # Assert directory exists
    assert reports_dir.exists(), f"Reports directory should exist: {reports_dir}"

    # Assert all 4 files exist and are not empty
    expected_files = [
        "1-beskrivelse.md",
        "2-analyse.md",
        "3-løsning.md",
        "4-status.md"
    ]

    for filename in expected_files:
        file_path = reports_dir / filename
        assert file_path.exists(), f"{filename} should exist"
        assert file_path.stat().st_size > 0, f"{filename} should not be empty"

    # Assert 1-beskrivelse.md has correct content
    beskrivelse = reports_dir / "1-beskrivelse.md"
    content = beskrivelse.read_text()

    # Should contain issue key
    assert issue_key in content, f"Should contain issue key {issue_key}"

    # Should contain required sections
    assert "## Metadata" in content, "Should contain Metadata section"
    assert "## Beskrivelse" in content, "Should contain Beskrivelse section"
    assert "## Omfang" in content, "Should contain Omfang section"

    # Should NOT contain unreplaced placeholders
    assert "{{ISSUE_KEY}}" not in content, "Should not have unreplaced ISSUE_KEY"
    assert "{{SUMMARY}}" not in content, "Should not have unreplaced SUMMARY"


def assert_todo_output_correct(reports_dir: Path, expected_todo_id: str = "TODO-01"):
    """Assert that TODO documentation output is correct.

    This validates the standard structure and content that ALL implementations
    should produce when creating TODO documentation.

    Args:
        reports_dir: Path to the generated TODO reports directory
        expected_todo_id: Expected TODO ID prefix (default: TODO-01)
    """
    # Assert directory exists
    assert reports_dir.exists(), f"Reports directory should exist: {reports_dir}"

    # Assert all 4 files exist and are not empty
    expected_files = [
        "1-beskrivelse.md",
        "2-analyse.md",
        "3-løsning.md",
        "4-status.md"
    ]

    for filename in expected_files:
        file_path = reports_dir / filename
        assert file_path.exists(), f"{filename} should exist"
        assert file_path.stat().st_size > 0, f"{filename} should not be empty"

    # Assert 1-beskrivelse.md has correct content
    beskrivelse = reports_dir / "1-beskrivelse.md"
    content = beskrivelse.read_text()

    # Should contain TODO ID
    assert expected_todo_id in content, f"Should contain TODO ID {expected_todo_id}"

    # Should contain required sections (TODO templates don't have Metadata like JIRA)
    assert "## Beskrivelse" in content, "Should contain Beskrivelse section"

    # Should NOT contain unreplaced placeholders (except allowed ones)
    assert "{{TITLE_FORMATTED}}" not in content, "Should not have unreplaced TITLE_FORMATTED"
    assert "{{DESCRIPTION}}" not in content, "Should not have unreplaced DESCRIPTION"
    assert "{{FOLDER_NAME}}" not in content, "Should not have unreplaced FOLDER_NAME"

    # {{ANALYSIS_DATE}} and {{UPDATE_DATE}} are allowed - filled by aide-analyser


def assert_incremental_numbering(base_dir: Path, expected_numbers: list):
    """Assert that TODO directories use correct incremental numbering.

    Args:
        base_dir: Base TODO reports directory
        expected_numbers: List of expected TODO numbers (e.g., [1, 2, 3])
    """
    for num in expected_numbers:
        # Should exist at least one directory starting with TODO-{num:02d}
        pattern = f"TODO-{num:02d}-*"
        matching = list(base_dir.glob(pattern))
        assert len(matching) >= 1, f"Should have at least one TODO-{num:02d}-* directory"
