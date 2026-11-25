"""The question the Claude Code and Codex uninstallers ask before they
remove anything: only y or Y goes on."""
import subprocess

import pytest


def ask(workspace_root, answer):
    helper = workspace_root / "core" / "scripts" / "_uninstall-confirm.sh"
    return subprocess.run(
        ["bash", "-c", f'source "{helper}"; aide_confirm_or_abort; echo went-on'],
        input=answer, capture_output=True, text=True,
    )


@pytest.mark.parametrize("answer", ["y\n", "Y\n"])
def test_yes_goes_on(workspace_root, answer):
    proc = ask(workspace_root, answer)
    assert proc.returncode == 0
    assert "went-on" in proc.stdout
    assert "Aborted" not in proc.stdout


@pytest.mark.parametrize("answer", ["n\n", "\n", "yes\n", ""])
def test_anything_else_aborts_with_exit_0(workspace_root, answer):
    proc = ask(workspace_root, answer)
    assert proc.returncode == 0
    assert "❌ Aborted" in proc.stdout
    assert "went-on" not in proc.stdout


@pytest.mark.parametrize("tool", ["claude-code", "codex"])
def test_the_uninstaller_stops_before_removing_anything_on_no(workspace_root, tmp_path, tool):
    script = workspace_root / "core" / "implementations" / tool / "uninstall.sh"
    proc = subprocess.run(
        ["bash", str(script)], input="n\n", capture_output=True, text=True,
        env={"HOME": str(tmp_path), "PATH": "/usr/bin:/bin"},
    )
    assert proc.returncode == 0
    assert proc.stdout.rstrip().endswith("❌ Aborted")
