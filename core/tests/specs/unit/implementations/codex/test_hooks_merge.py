"""aide's Codex hooks are merged into ~/.codex/hooks.json beside the user's own.

An install takes out every hook whose command runs a script from
~/.codex/hooks/aide-*, then adds aide's from core/implementations/codex/hooks/
hooks.json, so the user's hooks keep running and a second install adds nothing
twice. An uninstall takes out aide's alone.
"""
import json
import os
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.skipif(shutil.which("jq") is None, reason="the merge needs jq")

USER = {
    "hooks": {
        "PreToolUse": [
            {"matcher": "Bash", "hooks": [{"type": "command", "command": "$HOME/bin/my-guard.sh"}]},
        ],
        "Stop": [
            {"hooks": [{"type": "command", "command": "say done"}]},
        ],
    }
}


def _run(workspace_root, tmp_path, function, existing=None):
    cfg = tmp_path / ".codex" / "hooks.json"
    if existing is not None:
        cfg.parent.mkdir(parents=True, exist_ok=True)
        cfg.write_text(json.dumps(existing))
    codex = workspace_root / "core" / "implementations" / "codex"
    result = subprocess.run(
        ["bash", "-c", f'set -e; source "$1"; {function} "$2" "$3"', "bash",
         str(codex / "lib" / "hooks-merge.sh"), str(codex / "hooks" / "hooks.json"), str(cfg)],
        capture_output=True, text=True, env={**os.environ, "HOME": str(tmp_path)}, timeout=10,
    )
    assert result.returncode == 0, result.stderr
    return cfg


def _commands(cfg):
    data = json.loads(cfg.read_text())
    return sorted(h["command"] for groups in data["hooks"].values() for g in groups for h in g["hooks"])


def _aide(workspace_root):
    data = json.loads((workspace_root / "core" / "implementations" / "codex" / "hooks" / "hooks.json").read_text())
    return sorted(h["command"] for groups in data["hooks"].values() for g in groups for h in g["hooks"])


@pytest.mark.codex
class TestHooksMerge:
    def test_a_new_file_holds_aides_hooks(self, workspace_root, tmp_path):
        cfg = _run(workspace_root, tmp_path, "install_codex_hooks")
        assert _commands(cfg) == _aide(workspace_root)

    def test_the_users_hooks_are_kept_beside_aides(self, workspace_root, tmp_path):
        cfg = _run(workspace_root, tmp_path, "install_codex_hooks", USER)
        assert _commands(cfg) == sorted(_aide(workspace_root) + ["$HOME/bin/my-guard.sh", "say done"])

    def test_a_second_install_adds_nothing_twice(self, workspace_root, tmp_path):
        _run(workspace_root, tmp_path, "install_codex_hooks", USER)
        cfg = _run(workspace_root, tmp_path, "install_codex_hooks")
        assert _commands(cfg) == sorted(_aide(workspace_root) + ["$HOME/bin/my-guard.sh", "say done"])

    def test_uninstall_leaves_the_users_hooks(self, workspace_root, tmp_path):
        _run(workspace_root, tmp_path, "install_codex_hooks", USER)
        cfg = _run(workspace_root, tmp_path, "uninstall_codex_hooks")
        assert _commands(cfg) == ["$HOME/bin/my-guard.sh", "say done"]

    def test_uninstall_removes_a_file_that_held_only_aides_hooks(self, workspace_root, tmp_path):
        _run(workspace_root, tmp_path, "install_codex_hooks")
        cfg = _run(workspace_root, tmp_path, "uninstall_codex_hooks")
        assert not cfg.exists()
