import subprocess

import pytest

from .tool_list import read_tools


def run_rules(helper, source, function, target):
    return subprocess.run(
        [
            "/bin/bash",
            "-c",
            f'set -e; source "{helper}"; _CORE_RULES_DIR="{source}"; {function} "{target}"',
        ],
        capture_output=True,
        text=True,
    )


def rule(source, name):
    (source / f"{name}.md").write_text(f"# {name}\n")


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


def test_install_rules_records_the_copied_inventory_and_removes_retired_rules_ac_6(
    workspace_root, tmp_path
):
    source = tmp_path / "source"
    target = tmp_path / "target"
    source.mkdir()
    target.mkdir()
    rule(source, "current")
    (target / "retired.md").write_text("# retired\n")
    (target / ".aide-installed-manifest").write_text("retired.md\n")

    result = run_rules(
        workspace_root / "core/scripts/_install-rules.sh", source, "install_rules", target
    )

    assert result.returncode == 0, result.stderr
    assert (target / "current.md").is_file()
    assert not (target / "retired.md").exists()
    assert (target / ".aide-installed-manifest").read_text().splitlines() == ["current.md"]


@pytest.mark.parametrize("function", ["install_rules", "uninstall_rules"])
def test_rule_manifests_reject_blank_dotted_and_path_like_names_ac_3(
    workspace_root, tmp_path, function
):
    source = tmp_path / "source"
    target = tmp_path / "target"
    source.mkdir()
    target.mkdir()
    rule(source, "current")
    outside = tmp_path / "outside.md"
    outside.write_text("keep\n")
    (target / ".aide-installed-manifest").write_text("\n.\n..\n../outside.md\n/etc\n")

    result = run_rules(
        workspace_root / "core/scripts/_install-rules.sh", source, function, target
    )

    assert result.returncode == 0, result.stderr
    assert outside.read_text() == "keep\n"
    assert target.exists()


def test_uninstall_rules_removes_only_manifest_entries_ac_7(workspace_root, tmp_path):
    source = tmp_path / "source"
    target = tmp_path / "target"
    source.mkdir()
    target.mkdir()
    (target / "owned.md").write_text("# owned\n")
    (target / "user-owned.md").write_text("# user owned\n")
    (target / ".aide-installed-manifest").write_text("owned.md\n")

    result = run_rules(
        workspace_root / "core/scripts/_install-rules.sh", source, "uninstall_rules", target
    )

    assert result.returncode == 0, result.stderr
    assert not (target / "owned.md").exists()
    assert (target / "user-owned.md").is_file()
