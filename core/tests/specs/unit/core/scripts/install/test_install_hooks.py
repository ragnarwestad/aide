"""Aide's hooks are merged into a tool's config file beside the user's own.

core/scripts/_install-hooks.sh does it for both ~/.codex/hooks.json and
~/.claude/settings.json. A hook is Aide's when its command matches the tool's
pattern: an install takes those out and adds the current ones, so the user's
hooks and every other key stay and a second install adds nothing twice; an
uninstall takes Aide's out alone.
"""
import json
import os
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.skipif(shutil.which("jq") is None, reason="the merge needs jq")

USER_HOOK = "$HOME/bin/my-guard.sh"
USER = {
    "hooks": {
        "PreToolUse": [
            {"matcher": "Bash", "hooks": [{"type": "command", "command": USER_HOOK}]},
        ],
        "Stop": [
            {"hooks": [{"type": "command", "command": "say done"}]},
        ],
    }
}

TOOLS = {
    "codex": {
        "aide": ("codex", "hooks", "hooks.json"),
        "config": (".codex", "hooks.json"),
        "pattern": "AIDE_HOOKS_PATTERN_CODEX",
    },
    "claude": {
        "aide": ("claude-code", "hooks.json"),
        "config": (".claude", "settings.json"),
        "pattern": "AIDE_HOOKS_PATTERN_CLAUDE",
    },
}

# The two command rules as an earlier Claude Code settings template wrote them.
OLD_CLAUDE_INLINE = [
    "CMD=$(cat | jq -r '.tool_input.command'); if echo \"$CMD\" | grep -qE 'git (.*\\s)?add "
    "(\\.(\\s|$)|-A(\\s|$))'; then echo 'Blocked: Use explicit file names with git add' >&2; exit 2; fi; exit 0",
    "CMD=$(cat | jq -r '.tool_input.command'); if echo \"$CMD\" | grep -qE 'pnpm test' && ! echo \"$CMD\" "
    "| grep -q -- '--run'; then echo 'Blocked: Use pnpm test -- --run (not watch mode)' >&2; exit 2; fi; exit 0",
]
OLD_CODEX = ["$HOME/.codex/hooks/aide-block-git-add-all.sh", "$HOME/.codex/hooks/aide-block-watch-mode.sh"]


def _bash_groups(commands):
    return [{"matcher": "Bash", "hooks": [{"type": "command", "timeout": 10, "command": c}]} for c in commands]


def _run(workspace_root, home, tool, function, existing=None):
    spec = TOOLS[tool]
    cfg = home.joinpath(*spec["config"])
    if existing is not None:
        cfg.parent.mkdir(parents=True, exist_ok=True)
        cfg.write_text(existing if isinstance(existing, str) else json.dumps(existing))
    aide = workspace_root.joinpath("core", "implementations", *spec["aide"])
    pattern = spec["pattern"]
    result = subprocess.run(
        ["bash", "-c", f'set -e; source "$1"; {function} "$2" "$3" "${pattern}"', "bash",
         str(workspace_root / "core" / "scripts" / "_install-hooks.sh"), str(aide), str(cfg)],
        capture_output=True, text=True, env={**os.environ, "HOME": str(home)}, timeout=10,
    )
    assert result.returncode == 0, result.stderr
    return cfg, result


def _commands(cfg):
    data = json.loads(cfg.read_text())
    return sorted(h.get("command", "") for groups in data["hooks"].values() for g in groups for h in g["hooks"])


def _aide(workspace_root, tool):
    data = json.loads(workspace_root.joinpath("core", "implementations", *TOOLS[tool]["aide"]).read_text())
    return sorted(h["command"] for groups in data["hooks"].values() for g in groups for h in g["hooks"])


@pytest.mark.parametrize("tool", sorted(TOOLS))
class TestBothTools:
    def test_a_new_file_holds_aides_hooks_AC_3(self, workspace_root, tmp_path, tool):
        cfg, _ = _run(workspace_root, tmp_path, tool, "install_aide_hooks")
        assert _commands(cfg) == _aide(workspace_root, tool)

    def test_the_users_hooks_are_kept_beside_aides_AC_3(self, workspace_root, tmp_path, tool):
        cfg, _ = _run(workspace_root, tmp_path, tool, "install_aide_hooks", USER)
        assert _commands(cfg) == sorted(_aide(workspace_root, tool) + [USER_HOOK, "say done"])

    def test_a_second_install_adds_nothing_twice_AC_3(self, workspace_root, tmp_path, tool):
        _run(workspace_root, tmp_path, tool, "install_aide_hooks", USER)
        cfg, _ = _run(workspace_root, tmp_path, tool, "install_aide_hooks")
        assert _commands(cfg) == sorted(_aide(workspace_root, tool) + [USER_HOOK, "say done"])

    def test_uninstall_leaves_the_users_hooks_AC_3(self, workspace_root, tmp_path, tool):
        _run(workspace_root, tmp_path, tool, "install_aide_hooks", USER)
        cfg, _ = _run(workspace_root, tmp_path, tool, "uninstall_aide_hooks")
        assert _commands(cfg) == [USER_HOOK, "say done"]

    def test_uninstall_removes_a_file_that_held_only_aides_hooks_AC_3(self, workspace_root, tmp_path, tool):
        _run(workspace_root, tmp_path, tool, "install_aide_hooks")
        cfg, _ = _run(workspace_root, tmp_path, tool, "uninstall_aide_hooks")
        assert not cfg.exists()

    def test_a_file_that_is_not_json_is_left_as_it_is_AC_3(self, workspace_root, tmp_path, tool):
        cfg, result = _run(workspace_root, tmp_path, tool, "install_aide_hooks", "{ not json,\n")
        assert cfg.read_text() == "{ not json,\n"
        assert "⚠️" in result.stdout


def test_an_earlier_codex_install_has_its_entries_replaced_AC_3(workspace_root, tmp_path):
    earlier = {"hooks": {"PreToolUse": _bash_groups(OLD_CODEX + [USER_HOOK])}}
    cfg, _ = _run(workspace_root, tmp_path, "codex", "install_aide_hooks", earlier)
    assert _commands(cfg) == sorted(_aide(workspace_root, "codex") + [USER_HOOK])


def test_the_old_claude_inline_rules_are_replaced_and_the_rest_kept_AC_3(workspace_root, tmp_path):
    permissions = {"defaultMode": "default", "allow": ["Bash"], "deny": []}
    earlier = {"hooks": {"PreToolUse": _bash_groups(OLD_CLAUDE_INLINE + [USER_HOOK])}, "permissions": permissions}

    cfg, _ = _run(workspace_root, tmp_path, "claude", "install_aide_hooks", earlier)
    assert _commands(cfg) == sorted(_aide(workspace_root, "claude") + [USER_HOOK])
    assert json.loads(cfg.read_text())["permissions"] == permissions

    cfg, _ = _run(workspace_root, tmp_path, "claude", "install_aide_hooks")
    assert _commands(cfg) == sorted(_aide(workspace_root, "claude") + [USER_HOOK])

    cfg, _ = _run(workspace_root, tmp_path, "claude", "uninstall_aide_hooks")
    assert _commands(cfg) == [USER_HOOK]
    assert json.loads(cfg.read_text())["permissions"] == permissions


def test_uninstall_keeps_a_settings_file_with_other_keys_AC_3(workspace_root, tmp_path):
    _run(workspace_root, tmp_path, "claude", "install_aide_hooks", {"model": "opus"})
    cfg, _ = _run(workspace_root, tmp_path, "claude", "uninstall_aide_hooks")
    assert json.loads(cfg.read_text()) == {"model": "opus", "hooks": {}}
