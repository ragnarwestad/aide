"""Tests for install_prerequisites in core/scripts/_install-prerequisites.sh —
what install-all.sh installs before the tool installers: mise, a node, and
Claude Code, each only when missing.

curl, mise and claude are functions handed down to the script, logging
what they were asked; nothing is downloaded.
"""

import subprocess

import pytest


@pytest.fixture
def helper(workspace_root):
    return workspace_root / "core" / "scripts" / "_install-prerequisites.sh"


def _run(helper, home, shell=None, **functions):
    env = {"PATH": "/usr/bin:/bin", "HOME": str(home)}
    if shell:
        env["SHELL"] = shell
    for name, body in functions.items():
        env[f"BASH_FUNC_{name}%%"] = f"() {{ {body}; }}"
    env["BASH_FUNC_curl%%"] = '() { echo "curl $*" >> "$HOME/calls.log"; }'
    return subprocess.run(
        ["bash", "-c", f'source "{helper}"; install_prerequisites'],
        capture_output=True, text=True, env=env, timeout=30,
    )


def _calls(home):
    log = home / "calls.log"
    return log.read_text() if log.exists() else ""


LOGGED_MISE = 'echo "mise $*" >> "$HOME/calls.log"; [ "$1" != which ]'


class TestInstallPrerequisites:
    def test_a_blank_machine_gets_mise_and_claude_code(self, helper, tmp_path):
        result = _run(helper, tmp_path)

        assert result.returncode == 0, result.stdout + result.stderr
        assert "https://mise.run" in _calls(tmp_path)
        assert "https://claude.ai/install.sh" in _calls(tmp_path)
        assert "mise activate zsh" in (tmp_path / ".zshrc").read_text()

    def test_a_bash_user_gets_mise_in_bashrc_alone(self, helper, tmp_path):
        """Linux's usual shell: a zsh line alone left every tool mise
        installed off an interactive bash's PATH (a clean Debian, 19 Sep)."""
        _run(helper, tmp_path, shell="/bin/bash")

        assert "mise activate bash" in (tmp_path / ".bashrc").read_text()
        assert not (tmp_path / ".zshrc").exists()

    def test_a_zsh_user_gets_mise_in_zshrc_alone(self, helper, tmp_path):
        _run(helper, tmp_path, shell="/bin/zsh")

        assert "mise activate zsh" in (tmp_path / ".zshrc").read_text()
        assert not (tmp_path / ".bashrc").exists()

    def test_a_shell_it_does_not_know_gets_both(self, helper, tmp_path):
        _run(helper, tmp_path, shell="/bin/sh")

        assert "mise activate zsh" in (tmp_path / ".zshrc").read_text()
        assert "mise activate bash" in (tmp_path / ".bashrc").read_text()

    def test_a_second_run_does_not_add_the_activate_line_again(self, helper, tmp_path):
        _run(helper, tmp_path)
        _run(helper, tmp_path)

        assert (tmp_path / ".zshrc").read_text().count("mise activate zsh") == 1

    def test_mise_without_node_gets_a_node(self, helper, tmp_path):
        result = _run(helper, tmp_path, mise=LOGGED_MISE, claude="true")

        assert result.returncode == 0, result.stdout + result.stderr
        assert "mise use -g node@lts" in _calls(tmp_path)
        assert "curl" not in _calls(tmp_path)

    def test_a_machine_that_has_everything_is_left_alone(self, helper, tmp_path):
        result = _run(helper, tmp_path, mise='echo "mise $*" >> "$HOME/calls.log"', claude="true")

        assert result.returncode == 0, result.stdout + result.stderr
        assert _calls(tmp_path) == "mise which node\n"
        assert not (tmp_path / ".zshrc").exists()
