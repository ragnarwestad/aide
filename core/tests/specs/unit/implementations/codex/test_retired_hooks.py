"""The command-rule scripts an earlier Codex install left in ~/.codex/hooks/.

They are removed only once ~/.codex/hooks.json no longer calls them, so a
merge that could not run (no jq, a file that is not JSON) leaves the old
entries with the scripts they call.
"""
import json
import subprocess

import pytest

RETIRED = ("aide-block-git-add-all.sh", "aide-block-watch-mode.sh")


def _retire(workspace_root, home, config):
    hooks = home / ".codex" / "hooks"
    hooks.mkdir(parents=True)
    for name in RETIRED + ("aide-markdownlint.sh",):
        (hooks / name).write_text("#!/bin/sh\nexit 0\n")
    cfg = home / ".codex" / "hooks.json"
    if config is not None:
        cfg.write_text(json.dumps(config))
    lib = workspace_root / "core" / "implementations" / "codex" / "lib" / "retired-hooks.sh"
    result = subprocess.run(
        ["bash", "-c", 'set -e; source "$1"; remove_retired_codex_rules "$2" "$3"', "bash",
         str(lib), str(hooks), str(cfg)],
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0, result.stderr
    return hooks


def _config(commands):
    return {"hooks": {"PreToolUse": [
        {"matcher": "Bash", "hooks": [{"type": "command", "command": c}]} for c in commands]}}


@pytest.mark.codex
def test_scripts_the_config_still_calls_are_kept_AC_3(workspace_root, tmp_path):
    hooks = _retire(workspace_root, tmp_path, _config(f"$HOME/.codex/hooks/{n}" for n in RETIRED))
    assert all((hooks / name).exists() for name in RETIRED)


@pytest.mark.codex
def test_scripts_the_config_no_longer_calls_are_removed_AC_3(workspace_root, tmp_path):
    hooks = _retire(workspace_root, tmp_path, _config(["$HOME/.local/bin/lib/command-rules/block-git-add-all.sh"]))
    assert not any((hooks / name).exists() for name in RETIRED)
    assert (hooks / "aide-markdownlint.sh").exists()
