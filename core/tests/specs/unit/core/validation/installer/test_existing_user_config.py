"""An install keeps what the user already had in the places it writes to.

Each installer runs against a home directory holding the user's own
instructions, hooks and Claude Code folders; afterwards they are all still
there, and aide's own content is there beside them.
"""
import json
import subprocess

import pytest

SYSTEM_PATH = "/usr/bin:/bin"

INSTALLERS = {"claude": "claude-code", "codex": "codex", "copilot": "copilot", "opencode": "opencode"}

# The user's files each install must leave in place: path -> text.
OWN = {
    "claude": {
        ".claude/commands/deploy.md": "My deploy command.\n",
        ".claude/docs/notes.md": "My notes.\n",
        ".claude/api-mapping/map.md": "My map.\n",
    },
    "codex": {".codex/AGENTS.md": "My Codex rule.\n"},
    "copilot": {".copilot/copilot-instructions.md": "My Copilot rule.\n"},
    "opencode": {".config/opencode/AGENTS.md": "My OpenCode rule.\n"},
}

USER_HOOK = {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "say done"}]}]}}


def _install(workspace_root, home, ai):
    result = subprocess.run(
        [str(workspace_root / "core" / "implementations" / INSTALLERS[ai] / "install.sh")],
        capture_output=True, text=True, env={"PATH": SYSTEM_PATH, "HOME": str(home)},
        stdin=subprocess.DEVNULL, timeout=180,
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.validation
@pytest.mark.parametrize("ai", sorted(INSTALLERS))
def test_an_install_keeps_the_users_own_files(workspace_root, tmp_path, ai):
    for path, text in OWN[ai].items():
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_text(text)
    _install(workspace_root, tmp_path, ai)
    for path, text in OWN[ai].items():
        assert text in (tmp_path / path).read_text(), f"{ai}/install.sh lost the user's {path}"


@pytest.mark.validation
def test_a_codex_install_keeps_the_users_hooks(workspace_root, tmp_path):
    hooks = tmp_path / ".codex" / "hooks.json"
    hooks.parent.mkdir(parents=True)
    hooks.write_text(json.dumps(USER_HOOK))
    _install(workspace_root, tmp_path, "codex")
    commands = [h["command"] for groups in json.loads(hooks.read_text())["hooks"].values()
                for g in groups for h in g["hooks"]]
    assert "say done" in commands


@pytest.mark.validation
def test_an_opencode_install_keeps_the_users_config(workspace_root, tmp_path):
    config = tmp_path / ".config" / "opencode" / "opencode.json"
    config.parent.mkdir(parents=True)
    config.write_text(json.dumps({"model": "my/model"}))
    _install(workspace_root, tmp_path, "opencode")
    data = json.loads(config.read_text())
    assert data["model"] == "my/model"
    assert "CLAUDE.md" in data["instructions"]
