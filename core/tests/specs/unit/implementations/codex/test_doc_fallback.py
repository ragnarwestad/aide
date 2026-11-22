"""Codex reads a project's CLAUDE.md where the project has no AGENTS.md.

Codex reads only AGENTS.md as project instructions unless
`project_doc_fallback_filenames` in ~/.codex/config.toml names other files.
The installer sets that key through lib/doc-fallback.sh, keeps a value the
user already chose, and the uninstaller takes back only the line it wrote.
"""
import os
import subprocess

import pytest

tomllib = pytest.importorskip("tomllib")

EXISTING = """model = "gpt-5"

[projects."/home/user/app"]
trust_level = "trusted"
"""


def _run(workspace_root, tmp_path, function, config=None):
    cfg = tmp_path / ".codex" / "config.toml"
    if config is not None:
        cfg.parent.mkdir(parents=True, exist_ok=True)
        cfg.write_text(config)
    lib = workspace_root / "core" / "implementations" / "codex" / "lib" / "doc-fallback.sh"
    result = subprocess.run(
        ["bash", "-c", f'set -e; source "$1"; {function} "$2"', "bash", str(lib), str(cfg)],
        capture_output=True, text=True, env={**os.environ, "HOME": str(tmp_path)}, timeout=10,
    )
    assert result.returncode == 0, result.stderr
    return cfg, result.stdout


@pytest.mark.codex
class TestDocFallback:
    def test_a_missing_config_is_made_with_the_fallback(self, workspace_root, tmp_path):
        cfg, _ = _run(workspace_root, tmp_path, "install_codex_doc_fallback")
        assert tomllib.loads(cfg.read_text())["project_doc_fallback_filenames"] == ["CLAUDE.md"]

    def test_an_existing_config_keeps_its_keys_and_tables(self, workspace_root, tmp_path):
        cfg, _ = _run(workspace_root, tmp_path, "install_codex_doc_fallback", EXISTING)
        parsed = tomllib.loads(cfg.read_text())
        assert parsed["project_doc_fallback_filenames"] == ["CLAUDE.md"]
        assert parsed["model"] == "gpt-5"
        assert parsed["projects"]["/home/user/app"]["trust_level"] == "trusted"

    def test_installing_twice_writes_the_key_once(self, workspace_root, tmp_path):
        _run(workspace_root, tmp_path, "install_codex_doc_fallback", EXISTING)
        cfg, _ = _run(workspace_root, tmp_path, "install_codex_doc_fallback")
        assert cfg.read_text().count("project_doc_fallback_filenames") == 1

    def test_a_value_the_user_chose_is_kept_and_named(self, workspace_root, tmp_path):
        own = 'project_doc_fallback_filenames = ["TEAM.md"]\n' + EXISTING
        cfg, out = _run(workspace_root, tmp_path, "install_codex_doc_fallback", own)
        assert cfg.read_text() == own
        assert "CLAUDE.md" in out

    def test_uninstall_takes_back_only_its_own_line(self, workspace_root, tmp_path):
        _run(workspace_root, tmp_path, "install_codex_doc_fallback", EXISTING)
        cfg, _ = _run(workspace_root, tmp_path, "uninstall_codex_doc_fallback")
        assert cfg.read_text() == EXISTING

    def test_uninstall_leaves_a_value_the_user_chose(self, workspace_root, tmp_path):
        own = 'project_doc_fallback_filenames = ["CLAUDE.md"]\n' + EXISTING
        cfg, _ = _run(workspace_root, tmp_path, "uninstall_codex_doc_fallback", own)
        assert cfg.read_text() == own
