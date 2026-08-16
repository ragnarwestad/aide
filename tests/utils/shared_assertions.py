"""Shared assertion utilities for testing implementation outputs.

This module provides common assertions that all implementations should pass,
ensuring consistent behavior across Claude Code, Codex, and Copilot.
"""
from pathlib import Path
import re


def assert_jira_output_correct(specs_dir: Path, issue_key: str = "PROJ-1234"):
    """Assert that JIRA documentation output is correct.

    This validates the standard structure and content that ALL implementations
    should produce when creating JIRA documentation.

    Args:
        specs_dir: Path to the generated JIRA specs directory
        issue_key: The JIRA issue key (default: PROJ-1234)
    """
    # Assert directory exists
    assert specs_dir.exists(), f"Specs directory should exist: {specs_dir}"

    # Assert all 4 files exist and are not empty
    expected_files = [
        "1-description.md",
        "2-analysis.md",
        "3-solution.md",
        "4-status.md"
    ]

    for filename in expected_files:
        file_path = specs_dir / filename
        assert file_path.exists(), f"{filename} should exist"
        assert file_path.stat().st_size > 0, f"{filename} should not be empty"

    # Assert 1-description.md has correct content
    description_file = specs_dir / "1-description.md"
    content = description_file.read_text()

    # Should contain issue key
    assert issue_key in content, f"Should contain issue key {issue_key}"

    # Should contain required sections
    assert "## Metadata" in content, "Should contain Metadata section"
    assert "## Description" in content, "Should contain Description section"

    # Should NOT contain unreplaced placeholders
    assert "{{ISSUE_KEY}}" not in content, "Should not have unreplaced ISSUE_KEY"
    assert "{{SUMMARY}}" not in content, "Should not have unreplaced SUMMARY"


def assert_todo_output_correct(specs_dir: Path, expected_todo_id: str = "TODO-01"):
    """Assert that TODO documentation output is correct.

    This validates the standard structure and content that ALL implementations
    should produce when creating TODO documentation.

    Args:
        specs_dir: Path to the generated TODO specs directory
        expected_todo_id: Expected TODO ID prefix (default: TODO-01)
    """
    # Assert directory exists
    assert specs_dir.exists(), f"Specs directory should exist: {specs_dir}"

    # Assert all 4 files exist and are not empty
    expected_files = [
        "1-description.md",
        "2-analysis.md",
        "3-solution.md",
        "4-status.md"
    ]

    for filename in expected_files:
        file_path = specs_dir / filename
        assert file_path.exists(), f"{filename} should exist"
        assert file_path.stat().st_size > 0, f"{filename} should not be empty"

    # Assert 1-description.md has correct content
    description_file = specs_dir / "1-description.md"
    content = description_file.read_text()

    # Should contain TODO ID
    assert expected_todo_id in content, f"Should contain TODO ID {expected_todo_id}"

    # Should contain required sections (TODO templates don't have Metadata like JIRA)
    assert "## Description" in content, "Should contain Description section"

    # Should NOT contain unreplaced placeholders (except allowed ones)
    assert "{{TITLE_FORMATTED}}" not in content, "Should not have unreplaced TITLE_FORMATTED"
    assert "{{DESCRIPTION}}" not in content, "Should not have unreplaced DESCRIPTION"
    assert "{{FOLDER_NAME}}" not in content, "Should not have unreplaced FOLDER_NAME"

    # {{ANALYSIS_DATE}} and {{UPDATE_DATE}} are allowed - filled by aide-analyze


def assert_incremental_numbering(base_dir: Path, expected_numbers: list):
    """Assert that TODO directories use correct incremental numbering.

    Args:
        base_dir: Base TODO specs directory
        expected_numbers: List of expected TODO numbers (e.g., [1, 2, 3])
    """
    for num in expected_numbers:
        # Should exist at least one directory starting with TODO-{num:02d}
        pattern = f"TODO-{num:02d}-*"
        matching = list(base_dir.glob(pattern))
        assert len(matching) >= 1, f"Should have at least one TODO-{num:02d}-* directory"
