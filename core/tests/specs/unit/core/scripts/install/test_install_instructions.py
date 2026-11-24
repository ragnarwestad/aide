"""The global instructions installed for Copilot, Codex and OpenCode keep what
the user wrote there: aide's rules go in a block between two markers, an
install replaces only that block, and an uninstall removes only that block.
A file that is an earlier install's whole copy of core/AGENTS.md is aide's
own, and is replaced rather than kept beside the block.
"""
import subprocess

import pytest

BASH = "/bin/bash"
START = "<!-- >>> aide rules (managed by aide, do not edit by hand) >>> -->"
END = "<!-- <<< aide rules <<< -->"


@pytest.fixture
def helper(workspace_root):
    return workspace_root / "core" / "scripts" / "_install-instructions.sh"


def run(helper, workspace_root, function, destination, rules="# Aide — Shared instructions\n\nRule one.\n"):
    source = destination.parent / "core-AGENTS.md"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text(rules)
    result = subprocess.run(
        [BASH, "-c", f'set -e; source "$1"; AIDE_INSTRUCTIONS_SOURCE="$2"; {function} "$3"',
         "bash", str(helper), str(source), str(destination)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    return destination


def block(text):
    return text[text.index(START):text.index(END) + len(END)]


def test_a_new_file_holds_the_rules_in_the_block(helper, workspace_root, tmp_path):
    out = run(helper, workspace_root, "install_instructions", tmp_path / "AGENTS.md").read_text()
    assert "Rule one." in block(out)


def test_the_users_own_text_is_kept_outside_the_block_ac_2(helper, workspace_root, tmp_path):
    destination = tmp_path / "AGENTS.md"
    destination.write_text("My own rule.\n")
    out = run(helper, workspace_root, "install_instructions", destination).read_text()
    assert out.startswith("My own rule.\n")
    assert "Rule one." in block(out)


def test_a_second_install_replaces_only_the_block(helper, workspace_root, tmp_path):
    destination = tmp_path / "AGENTS.md"
    destination.write_text("My own rule.\n")
    run(helper, workspace_root, "install_instructions", destination)
    out = run(helper, workspace_root, "install_instructions", destination,
              rules="# Aide — Shared instructions\n\nRule two.\n").read_text()
    assert out.count(START) == 1
    assert "Rule one." not in out
    assert "Rule two." in block(out)
    assert out.startswith("My own rule.\n")


@pytest.mark.parametrize("header", ["# Aide — Shared instructions", "# aide — Shared instructions",
                                    "# Doc Aide — Felles instruksjoner"])
def test_an_earlier_installs_whole_copy_is_replaced(helper, workspace_root, tmp_path, header):
    destination = tmp_path / "AGENTS.md"
    destination.write_text(f"{header}\n\nOld rule.\n")
    out = run(helper, workspace_root, "install_instructions", destination).read_text()
    assert "Old rule." not in out
    assert out.startswith(START)


def test_uninstall_leaves_the_users_text(helper, workspace_root, tmp_path):
    destination = tmp_path / "AGENTS.md"
    destination.write_text("My own rule.\n")
    run(helper, workspace_root, "install_instructions", destination)
    run(helper, workspace_root, "uninstall_instructions", destination)
    assert destination.read_text() == "My own rule.\n"


def test_uninstall_removes_a_file_that_held_only_the_block(helper, workspace_root, tmp_path):
    destination = tmp_path / "AGENTS.md"
    run(helper, workspace_root, "install_instructions", destination)
    run(helper, workspace_root, "uninstall_instructions", destination)
    assert not destination.exists()
