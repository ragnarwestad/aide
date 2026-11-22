"""OpenCode reads a project's CLAUDE.md through `instructions` in its global config.

OpenCode 2 reads only AGENTS.md as a project's instructions; a relative path in
the global config's `instructions` is searched up to the project root as well.
The installer adds "CLAUDE.md" to that list, keeps everything else in the file,
and records that it did, so the uninstaller takes back only its own entry.
"""
import json
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.skipif(shutil.which("jq") is None, reason="the change needs jq")

SCHEMA = "https://opencode.ai/config.json"
EXISTING = {"$schema": SCHEMA, "model": "openrouter/some-model:free", "instructions": ["docs/rules.md"]}


@pytest.fixture
def helper(workspace_root):
    return workspace_root / "core" / "implementations" / "opencode" / "_claude-md.sh"


def _run(helper, tmp_path, function, existing=None):
    config_dir = tmp_path / "opencode"
    config_dir.mkdir(exist_ok=True)
    cfg = config_dir / "opencode.json"
    if existing is not None:
        cfg.write_text(json.dumps(existing))
    result = subprocess.run(
        ["bash", "-c", f'set -e; source "$1"; {function} "$2"', "bash", str(helper), str(config_dir)],
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0, result.stderr
    return cfg, result.stdout


def test_a_missing_config_is_made_with_the_entry(helper, tmp_path):
    cfg, _ = _run(helper, tmp_path, "install_opencode_claude_md")
    assert json.loads(cfg.read_text())["instructions"] == ["CLAUDE.md"]


def test_an_existing_config_keeps_its_keys_and_entries(helper, tmp_path):
    cfg, _ = _run(helper, tmp_path, "install_opencode_claude_md", EXISTING)
    data = json.loads(cfg.read_text())
    assert data["instructions"] == ["docs/rules.md", "CLAUDE.md"]
    assert data["model"] == EXISTING["model"]


def test_installing_twice_adds_the_entry_once(helper, tmp_path):
    _run(helper, tmp_path, "install_opencode_claude_md", EXISTING)
    cfg, _ = _run(helper, tmp_path, "install_opencode_claude_md")
    assert json.loads(cfg.read_text())["instructions"].count("CLAUDE.md") == 1


def test_uninstall_takes_back_only_its_own_entry(helper, tmp_path):
    _run(helper, tmp_path, "install_opencode_claude_md", EXISTING)
    cfg, _ = _run(helper, tmp_path, "uninstall_opencode_claude_md")
    assert json.loads(cfg.read_text()) == EXISTING


def test_uninstall_removes_a_config_it_made(helper, tmp_path):
    _run(helper, tmp_path, "install_opencode_claude_md")
    cfg, _ = _run(helper, tmp_path, "uninstall_opencode_claude_md")
    assert not cfg.exists()


def test_uninstall_leaves_an_entry_the_user_wrote(helper, tmp_path):
    own = {**EXISTING, "instructions": ["CLAUDE.md"]}
    _run(helper, tmp_path, "install_opencode_claude_md", own)
    cfg, _ = _run(helper, tmp_path, "uninstall_opencode_claude_md")
    assert json.loads(cfg.read_text()) == own


def test_a_config_with_comments_is_left_alone(helper, tmp_path):
    config_dir = tmp_path / "opencode"
    config_dir.mkdir()
    jsonc = config_dir / "opencode.jsonc"
    jsonc.write_text('{\n  // mine\n  "model": "x"\n}\n')
    cfg, out = _run(helper, tmp_path, "install_opencode_claude_md")
    assert not cfg.exists()
    assert jsonc.read_text() == '{\n  // mine\n  "model": "x"\n}\n'
    assert "CLAUDE.md" in out
