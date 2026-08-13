"""Tests for docs/AI_SUPPORT_MATRIX.md maintenance.

Two rules: the "Supported versions" table is stamped from what the tools
actually report (scripts/stamp-versions), never by hand — and the matrix
records HOW WELL each aide piece lands per tool (fidelity levels), not
just yes/no.
"""
import datetime
import stat
import subprocess

import pytest

MATRIX_SNIPPET = """# AI Support Matrix

## Supported versions

| Tool | Version | Last verified | Status |
|---------|---------|-----------------|--------|
| Claude Code | 1.0.0 | 2020-01-01 | ✅ Supported |
| GitHub Copilot CLI | v0.0.1 | 2020-01-01 | ✅ Supported |
| Codex CLI | 0.0.1 | 2020-01-01 | ✅ Supported |

Other content stays untouched.
"""


def _fake_tool(directory, name, output):
    directory.mkdir(parents=True, exist_ok=True)
    tool = directory / name
    tool.write_text(f'#!/bin/sh\necho "{output}"\n')
    tool.chmod(tool.stat().st_mode | stat.S_IEXEC)


@pytest.fixture
def matrix(tmp_path):
    path = tmp_path / "AI_SUPPORT_MATRIX.md"
    path.write_text(MATRIX_SNIPPET)
    return path


def _run(workspace_root, matrix, bin_dir):
    script = workspace_root / "scripts" / "stamp-versions"
    return subprocess.run(
        [str(script), str(matrix)],
        capture_output=True,
        text=True,
        env={"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(matrix.parent)},
    )


@pytest.mark.validation
class TestStampVersions:
    """scripts/stamp-versions rewrites the version table from probing."""

    def test_stamps_found_tools_with_version_and_date(
        self, workspace_root, matrix, tmp_path
    ):
        bin_dir = tmp_path / "bin"
        _fake_tool(bin_dir, "claude", "2.9.9 (Claude Code)")
        _fake_tool(bin_dir, "copilot", "GitHub Copilot CLI 1.9.9.")
        _fake_tool(bin_dir, "codex", "codex-cli 0.9.9")
        result = _run(workspace_root, matrix, bin_dir)
        assert result.returncode == 0, result.stderr

        content = matrix.read_text()
        today = datetime.date.today().isoformat()
        assert f"| Claude Code | 2.9.9 | {today} | ✅ Supported |" in content
        assert f"| GitHub Copilot CLI | 1.9.9 | {today} | ✅ Supported |" in content
        assert f"| Codex CLI | 0.9.9 | {today} | ✅ Supported |" in content
        assert "Other content stays untouched." in content

    def test_missing_tool_leaves_its_row_unchanged(
        self, workspace_root, matrix, tmp_path
    ):
        bin_dir = tmp_path / "bin"
        _fake_tool(bin_dir, "claude", "2.9.9 (Claude Code)")
        # no copilot, no codex on PATH
        result = _run(workspace_root, matrix, bin_dir)
        assert result.returncode == 0, result.stderr

        content = matrix.read_text()
        assert "| GitHub Copilot CLI | v0.0.1 | 2020-01-01 | ✅ Supported |" in content, \
            "A missing tool must not have its row stamped"
        assert "2.9.9" in content, "The found tool must still be stamped"


@pytest.mark.validation
class TestFidelityLevels:
    """The matrix must grade how each aide piece lands, not just yes/no."""

    def test_matrix_defines_the_fidelity_ladder(self, workspace_root):
        content = (workspace_root / "docs" / "AI_SUPPORT_MATRIX.md").read_text()
        assert "## Fidelity levels" in content
        for level in ("Enforced", "Heuristic", "Instruction"):
            assert level in content, f"The fidelity ladder must define '{level}'"

    def test_matrix_grades_the_aide_pieces(self, workspace_root):
        content = (workspace_root / "docs" / "AI_SUPPORT_MATRIX.md").read_text()
        assert "## How the aide pieces land" in content
        for piece in ("Rules", "Skills", "Hooks"):
            assert piece in content
