import subprocess

import pytest

from .tool_list import read_tools


@pytest.mark.parametrize("tool_id", ["claude", "copilot", "codex", "opencode"])
def test_every_installer_uses_the_shared_steps_ac_5(workspace_root, tool_id):
    tool = next(item for item in read_tools(workspace_root) if item["id"] == tool_id)
    text = (workspace_root / "core/implementations" / tool["implementation"] / "install.sh").read_text()
    assert "_install-steps.sh" in text
    assert f"install_steps_begin {tool_id}" in text
    assert f"install_steps_finish {tool_id}" in text


def test_rule_scope_comes_from_frontmatter_ac_4(workspace_root, tmp_path):
    rules = tmp_path / "rules"
    rules.mkdir()
    (rules / "always.md").write_text("# Always\n")
    (rules / "new.md").write_text("# New\n")
    (rules / "scoped.md").write_text("---\npaths:\n  - 'specs/**'\n---\n# Scoped\n")
    helper = workspace_root / "core/scripts/_install-rules.sh"
    result = subprocess.run(
        [
            "/bin/bash",
            "-c",
            f'source "{helper}"; _CORE_RULES_DIR="{rules}"; rule_names every-turn',
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["always", "new"]
