"""Tests for check_prerequisites in core/scripts/_install-prerequisites.sh —
what install-all.sh checks before the tool installers: mise, a node, and an
AI tool's CLI. It installs none of them; each missing one is reported with
the command that installs it.

curl, mise and claude are functions handed down to the script, logging what
they were asked. A call to curl in the log is the check downloading
something, which it must never do.
"""

import subprocess

import pytest


@pytest.fixture
def helper(workspace_root):
    return workspace_root / "core" / "scripts" / "_install-prerequisites.sh"


def _run(helper, home, **functions):
    env = {"PATH": "/usr/bin:/bin", "HOME": str(home)}
    for name, body in functions.items():
        env[f"BASH_FUNC_{name}%%"] = f"() {{ {body}; }}"
    env["BASH_FUNC_curl%%"] = '() { echo "curl $*" >> "$HOME/calls.log"; }'
    return subprocess.run(
        ["bash", "-c", f'source "{helper}"; check_prerequisites'],
        capture_output=True, text=True, env=env, timeout=30,
    )


def _calls(home):
    log = home / "calls.log"
    return log.read_text() if log.exists() else ""


MISE_WITHOUT_NODE = 'echo "mise $*" >> "$HOME/calls.log"; [ "$1" != which ]'
MISE_WITH_NODE = 'echo "mise $*" >> "$HOME/calls.log"'


class TestCheckPrerequisites:
    def test_a_blank_machine_is_told_what_to_install(self, helper, tmp_path):
        result = _run(helper, tmp_path)

        assert result.returncode == 1, result.stdout + result.stderr
        assert "curl https://mise.run | sh" in result.stdout
        assert "curl -fsSL https://claude.ai/install.sh | bash" in result.stdout

    def test_nothing_is_downloaded_and_no_startup_file_is_written(self, helper, tmp_path):
        """The whole point of the check: it reports, and touches nothing on
        the machine — neither a download nor a line in a shell's rc file."""
        _run(helper, tmp_path)

        assert _calls(tmp_path) == ""
        assert not (tmp_path / ".zshrc").exists()
        assert not (tmp_path / ".bashrc").exists()

    def test_mise_without_node_names_the_node_command(self, helper, tmp_path):
        result = _run(helper, tmp_path, mise=MISE_WITHOUT_NODE, claude="true")

        assert result.returncode == 1, result.stdout + result.stderr
        assert "mise use -g node@lts" in result.stdout
        assert "https://mise.run" not in result.stdout
        assert _calls(tmp_path) == "mise which node\n"

    def test_claude_alone_missing_is_reported_but_does_not_fail_the_check(self, helper, tmp_path):
        """aide installs its skills for all four AI CLIs whether or not the
        CLI is there, and which one is used is the user's choice — so a
        missing Claude Code is a note, not a failed prerequisite."""
        result = _run(helper, tmp_path, mise=MISE_WITH_NODE)

        assert result.returncode == 0, result.stdout + result.stderr
        assert "curl -fsSL https://claude.ai/install.sh | bash" in result.stdout

    def test_a_machine_that_has_everything_is_told_nothing_to_install(self, helper, tmp_path):
        result = _run(helper, tmp_path, mise=MISE_WITH_NODE, claude="true")

        assert result.returncode == 0, result.stdout + result.stderr
        assert "mise and node are in place" in result.stdout
        assert "curl" not in result.stdout
        assert _calls(tmp_path) == "mise which node\n"
