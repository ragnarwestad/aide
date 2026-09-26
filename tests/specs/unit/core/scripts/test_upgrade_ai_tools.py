"""Tests for core/scripts/upgrade-ai-tools — the cron/manual job that
keeps every AI CLI current via mise (see .claude/rules/development.md).

Before this spec, `--help` (like every other argument) was silently
ignored and the real upgrade ran regardless — the starkest case this
spec's AC-2 covers, since today's behaviour for `--help` is "do the
thing", not "refuse the thing".
"""
import stat
import subprocess

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "upgrade-ai-tools"


def _stub(directory, name, marker):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(f'#!/bin/sh\necho called >> "{marker}"\n')
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path


def test_help_flag_never_invokes_mise_or_claude(script, tmp_path):
    """AC-2: a stub `mise`/`claude` put first on PATH must never be
    called when --help is given."""
    marker = tmp_path / "called.txt"
    bin_dir = tmp_path / "bin"
    _stub(bin_dir, "mise", marker)
    _stub(bin_dir, "claude", marker)

    result = subprocess.run(
        [str(script), "--help"],
        capture_output=True, text=True,
        env={"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp_path)},
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists(), "mise or claude ran despite --help"
