"""Tests for core/scripts/aide-print-specs-guard (spec 282, REQ-4).

Prints a ready-to-paste Write/Edit deny-rule snippet for a project's own
specs root — never writes anywhere itself, mirroring install.sh's own
"aide never edits ~/.claude/settings.json" philosophy, but computed
per-project (install.sh has no concept of a single project's root).
"""
import subprocess

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-print-specs-guard"


def run(script, project_dir=None, cwd=None):
    args = [str(script)]
    if project_dir is not None:
        args += ["--project-dir", str(project_dir)]
    return subprocess.run(args, capture_output=True, text=True, cwd=cwd)


def test_prints_default_specs_root_when_unconfigured(script, tmp_path):
    proc = run(script, project_dir=tmp_path)
    assert proc.returncode == 0, proc.stderr
    expected = str(tmp_path / "specs")
    assert f'"Write({expected}/**)"' in proc.stdout
    assert f'"Edit({expected}/**)"' in proc.stdout


def test_prints_configured_specs_path(script, tmp_path):
    (tmp_path / ".aide").mkdir()
    (tmp_path / ".aide" / "config").write_text("AIDE_SPECS_PATH=/somewhere/else/specs\n")
    proc = run(script, project_dir=tmp_path)
    assert proc.returncode == 0, proc.stderr
    assert '"Write(/somewhere/else/specs/**)"' in proc.stdout
    assert '"Edit(/somewhere/else/specs/**)"' in proc.stdout
    assert f'"Write({tmp_path / "specs"}/**)"' not in proc.stdout


def test_names_only_write_and_edit_tools(script, tmp_path):
    proc = run(script, project_dir=tmp_path)
    assert proc.returncode == 0, proc.stderr
    assert "Read(" not in proc.stdout
    assert "Bash(" not in proc.stdout


def test_defaults_project_dir_to_cwd(script, tmp_path):
    proc = run(script, cwd=tmp_path)
    assert proc.returncode == 0, proc.stderr
    expected = str(tmp_path / "specs")
    assert f'"Write({expected}/**)"' in proc.stdout


def test_never_writes_any_file(script, tmp_path):
    before = sorted(p.name for p in tmp_path.iterdir())
    proc = run(script, project_dir=tmp_path)
    assert proc.returncode == 0, proc.stderr
    after = sorted(p.name for p in tmp_path.iterdir())
    assert before == after
