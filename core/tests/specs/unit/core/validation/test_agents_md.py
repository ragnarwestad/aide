"""The rules for working on this repo live in AGENTS.md, which every AI tool
reads. CLAUDE.md only imports it, so a rule written there is never one that
Codex does not see."""

from pathlib import Path

import pytest


@pytest.mark.parametrize("folder", [".", "dashboard"])
def test_claude_md_only_imports_agents_md(workspace_root, folder):
    root = Path(workspace_root, folder)
    assert (root / "AGENTS.md").is_file()
    assert (root / "CLAUDE.md").read_text().strip() == "@AGENTS.md"


def test_no_claude_md_hides_in_dot_claude(workspace_root):
    for folder in (".", "dashboard"):
        assert not Path(workspace_root, folder, ".claude", "CLAUDE.md").exists()
