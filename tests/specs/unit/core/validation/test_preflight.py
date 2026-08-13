"""Behaviour tests for core/scripts/aide-preflight.

Installing blind was a whole class of silent misses: files copied for a
tool that is not there, or landing in a directory the tool never reads.
The preflight probes what is actually installed and reports where each
piece will land — it informs, it never blocks (exit 0 either way).
"""
import os
import stat
import subprocess

import pytest

SYSTEM_PATH = "/usr/bin:/bin"


def _run(workspace_root, args, home, path=SYSTEM_PATH):
    script = workspace_root / "core" / "scripts" / "aide-preflight"
    return subprocess.run(
        [str(script), *args],
        capture_output=True,
        text=True,
        env={"PATH": path, "HOME": str(home)},
    )


def _fake_tool(directory, name, version):
    directory.mkdir(parents=True, exist_ok=True)
    tool = directory / name
    tool.write_text(f'#!/bin/sh\necho "{version}"\n')
    tool.chmod(tool.stat().st_mode | stat.S_IEXEC)


@pytest.mark.validation
class TestPreflight:
    """aide-preflight probes tools and reports target paths."""

    def test_missing_tool_reports_but_does_not_block(self, workspace_root, tmp_path):
        result = _run(workspace_root, ["claude"], home=tmp_path)
        assert result.returncode == 0, result.stderr
        assert "not found" in result.stdout
        assert ".claude/skills" in result.stdout, \
            "The report must say where the pieces will land"

    def test_found_tool_reports_its_version(self, workspace_root, tmp_path):
        bin_dir = tmp_path / "bin"
        _fake_tool(bin_dir, "claude", "9.9.9")
        result = _run(
            workspace_root, ["claude"], home=tmp_path,
            path=f"{bin_dir}:{SYSTEM_PATH}",
        )
        assert result.returncode == 0, result.stderr
        assert "9.9.9" in result.stdout

    def test_all_covers_every_tool(self, workspace_root, tmp_path):
        result = _run(workspace_root, ["all"], home=tmp_path)
        assert result.returncode == 0, result.stderr
        for piece in ("Claude Code", "Copilot", "Codex"):
            assert piece in result.stdout, f"'all' must cover {piece}"

    def test_default_is_all(self, workspace_root, tmp_path):
        result = _run(workspace_root, [], home=tmp_path)
        assert result.returncode == 0, result.stderr
        assert "Codex" in result.stdout

    def test_unknown_argument_fails(self, workspace_root, tmp_path):
        result = _run(workspace_root, ["gemini"], home=tmp_path)
        assert result.returncode != 0

    def test_copilot_report_explains_the_skill_path(self, workspace_root, tmp_path):
        """Copilot reads skills from ~/.claude/skills — the report must say so,
        or a user without Claude Code will think the skills are missing."""
        result = _run(workspace_root, ["copilot"], home=tmp_path)
        assert ".claude/skills" in result.stdout


@pytest.mark.validation
class TestPreflightIsWiredIn:
    """The preflight ships to ~/.local/bin and every installer runs it."""

    def test_installed_by_install_common_bin(self, workspace_root, tmp_path):
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env={"PATH": os.environ["PATH"], "HOME": str(tmp_path)},
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "aide-preflight").is_file()

    @pytest.mark.parametrize("ai", ["claude-code", "copilot", "codex"])
    def test_every_installer_runs_preflight(self, workspace_root, ai):
        install = workspace_root / "implementations" / ai / "install.sh"
        assert "aide-preflight" in install.read_text(), \
            f"{ai}/install.sh does not run the preflight"
