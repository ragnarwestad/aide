"""Where the installer puts things on this machine: the shell PATH block
it writes, the scripts it replaces by rename, and the shared library it
installs beside them.

Split out of test_core_scripts.py 2026-09-04 (1064 lines); the tests are
unchanged and keep their names.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path
import pytest
from tests.specs.unit.core.validation.test_templates import structure_block

from .test_core_scripts import _scripts


# ssh runs a NON-INTERACTIVE shell, which on macOS reads neither .zprofile,
# .zshrc nor .bash_profile — so a tool in /opt/homebrew/bin, /usr/local/bin
# or ~/.local/bin is "command not found" over ssh while a person sitting at
# the machine finds it. install_shell_path writes the one file each shell
# does read (spec 175).
PATH_DIRS = ("/opt/homebrew/bin", "/usr/local/bin", "$HOME/.local/bin")
PATH_BLOCK_MARKER = "aide PATH"


def _source_install_bin(workspace_root, home, function):
    installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
    return subprocess.run(
        ["bash", "-c", f'source "{installer}"; {function}'],
        capture_output=True,
        text=True,
        env={"PATH": os.environ["PATH"], "HOME": str(home)},
    )


@pytest.mark.validation
class TestInstallShellPath:
    """The PATH block must reach both dotfiles without damaging either."""

    def test_writes_the_stable_dirs_to_both_files(self, workspace_root, tmp_path):
        result = _source_install_bin(workspace_root, tmp_path, "install_shell_path")
        assert result.returncode == 0, result.stderr
        for name in (".zshenv", ".bashrc"):
            content = (tmp_path / name).read_text()
            for directory in PATH_DIRS:
                assert directory in content, f"~/{name} does not put {directory} on PATH"

    def test_keeps_what_the_files_already_had(self, workspace_root, tmp_path):
        (tmp_path / ".zshenv").write_text("export MINE=1\n")
        (tmp_path / ".bashrc").write_text("export MINE=2\n")

        result = _source_install_bin(workspace_root, tmp_path, "install_shell_path")
        assert result.returncode == 0, result.stderr

        zshenv = (tmp_path / ".zshenv").read_text()
        bashrc = (tmp_path / ".bashrc").read_text()
        assert "export MINE=1" in zshenv
        assert "export MINE=2" in bashrc
        # A .bashrc commonly opens with a non-interactive early return, so a
        # block appended after it would never run for the ssh case this
        # exists to fix. .zshenv has no such guard.
        assert zshenv.index("export MINE=1") < zshenv.index(PATH_BLOCK_MARKER), \
            "the block must come after existing content in ~/.zshenv"
        assert bashrc.index(PATH_BLOCK_MARKER) < bashrc.index("export MINE=2"), \
            "the block must come before existing content in ~/.bashrc"

    def test_a_file_without_a_trailing_newline_is_not_corrupted(
        self, workspace_root, tmp_path
    ):
        (tmp_path / ".zshenv").write_text("export MINE=1")  # no trailing newline

        result = _source_install_bin(workspace_root, tmp_path, "install_shell_path")
        assert result.returncode == 0, result.stderr

        lines = (tmp_path / ".zshenv").read_text().splitlines()
        assert "export MINE=1" in lines, \
            "the block was glued onto the file's last line instead of starting its own"

    def test_a_second_install_does_not_duplicate_the_block(self, workspace_root, tmp_path):
        for _ in range(2):
            result = _source_install_bin(workspace_root, tmp_path, "install_shell_path")
            assert result.returncode == 0, result.stderr

        for name in (".zshenv", ".bashrc"):
            content = (tmp_path / name).read_text()
            assert content.count(PATH_BLOCK_MARKER) == 2, \
                f"~/{name} has more than one aide block: {content}"

    def test_sourcing_the_file_twice_does_not_grow_path(self, workspace_root, tmp_path):
        assert _source_install_bin(
            workspace_root, tmp_path, "install_shell_path"
        ).returncode == 0

        zshenv = tmp_path / ".zshenv"
        result = subprocess.run(
            ["bash", "-c", f'source "{zshenv}"; source "{zshenv}"; printf "%s" "$PATH"'],
            capture_output=True,
            text=True,
            env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)},
        )
        assert result.returncode == 0, result.stderr
        entries = result.stdout.split(":")
        for directory in ("/opt/homebrew/bin", "/usr/local/bin", f"{tmp_path}/.local/bin"):
            assert entries.count(directory) == 1, \
                f"{directory} appears {entries.count(directory)} times in PATH: {result.stdout}"

    def test_uninstall_removes_the_block_and_leaves_the_rest(
        self, workspace_root, tmp_path
    ):
        (tmp_path / ".zshenv").write_text("export MINE=1\n")
        (tmp_path / ".bashrc").write_text("export MINE=2\n")
        assert _source_install_bin(
            workspace_root, tmp_path, "install_shell_path"
        ).returncode == 0

        result = _source_install_bin(workspace_root, tmp_path, "uninstall_shell_path")
        assert result.returncode == 0, result.stderr

        for name, kept in ((".zshenv", "export MINE=1"), (".bashrc", "export MINE=2")):
            content = (tmp_path / name).read_text()
            assert PATH_BLOCK_MARKER not in content, f"~/{name} still carries the block"
            assert kept in content, f"uninstall dropped unrelated content from ~/{name}"

    def test_the_block_names_stable_directories_only(self, workspace_root, tmp_path):
        assert _source_install_bin(
            workspace_root, tmp_path, "install_shell_path"
        ).returncode == 0

        block = (tmp_path / ".zshenv").read_text()
        # A versioned path (mise's bun install dir, say) rots at the next
        # upgrade; the deploy scripts name such tools by full path instead.
        assert "mise" not in block, "the block hardcodes a mise install path"
        assert not re.search(r"/\d+\.\d+", block), \
            f"the block hardcodes a version-numbered directory:\n{block}"


@pytest.mark.validation
class TestInstallersWireUpShellPath:
    """Every installer writes the block; no individual uninstaller removes it."""

    @staticmethod
    def _run(workspace_root, tool, script, home, stdin=None):
        return subprocess.run(
            [str(workspace_root / "implementations" / tool / script)],
            input=stdin,
            capture_output=True,
            text=True,
            env={"PATH": "/usr/bin:/bin", "HOME": str(home)},
            stdin=subprocess.DEVNULL if stdin is None else None,
            timeout=180,
        )

    def test_the_installer_writes_the_block(self, workspace_root, tmp_path):
        result = self._run(workspace_root, "claude-code", "install.sh", home=tmp_path)
        assert result.returncode == 0, result.stdout + result.stderr
        for name in (".zshenv", ".bashrc"):
            assert PATH_BLOCK_MARKER in (tmp_path / name).read_text(), \
                f"install.sh left ~/{name} without the PATH block"

    def test_the_path_hint_does_not_send_the_reader_to_zshrc(self, workspace_root):
        # .zshrc and .bash_profile are read by INTERACTIVE shells only —
        # telling the reader to edit them fixes everything except ssh.
        for tool in ("claude-code", "codex", "copilot"):
            installer = workspace_root / "implementations" / tool / "install.sh"
            text = installer.read_text()
            for wrong in (".zshrc", ".bash_profile"):
                assert wrong not in text, \
                    f"{tool}/install.sh still points the reader at {wrong}"

    def test_an_individual_uninstall_keeps_the_block(self, workspace_root, tmp_path):
        result = self._run(workspace_root, "claude-code", "install.sh", home=tmp_path)
        assert result.returncode == 0, result.stdout + result.stderr

        result = self._run(
            workspace_root, "claude-code", "uninstall.sh", home=tmp_path, stdin="y\n"
        )
        assert result.returncode == 0, result.stdout + result.stderr
        for name in (".zshenv", ".bashrc"):
            assert PATH_BLOCK_MARKER in (tmp_path / name).read_text(), (
                f"claude-code/uninstall.sh removed the PATH block from ~/{name} — "
                "the other tools still need it; only uninstall-all.sh may remove it"
            )

    def test_uninstall_all_removes_the_block(self, workspace_root, tmp_path):
        assert _source_install_bin(
            workspace_root, tmp_path, "install_shell_path"
        ).returncode == 0

        result = subprocess.run(
            [str(workspace_root / "uninstall-all.sh")],
            input="y\ny\ny\n",
            capture_output=True,
            text=True,
            env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)},
            timeout=180,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        for name in (".zshenv", ".bashrc"):
            assert PATH_BLOCK_MARKER not in (tmp_path / name).read_text(), \
                f"uninstall-all.sh left the PATH block in ~/{name}"


class TestInstallReplacesByRename:
    def test_a_reinstall_never_writes_into_the_installed_file(self, workspace_root, tmp_path):
        """Bash reads a running script by byte offset, so an installer
        that copies over the file corrupts whatever run is executing it
        (the 337 archive gate, 2026-09-02, lost 9 minutes of green tests
        to a syntax error at the next line). A rename gives the running
        process the old inode and everyone else the new file."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        run = lambda: subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True, text=True, env=env,
        )
        assert run().returncode == 0
        installed = tmp_path / ".local" / "bin" / "aide-record-test-run"
        before = installed.stat().st_ino
        assert run().returncode == 0
        assert installed.stat().st_ino != before, "the file was written into, not replaced"
        assert not list((tmp_path / ".local" / "bin").glob("*.aide-tmp"))


class TestSpecTransitionsLibIsInstalled:
    def test_spec_transitions_lib_and_table_are_installed(self, workspace_root, tmp_path):
        """aide-archive-spec's implement check calls may_apply_spec_transition
        from lib/spec-transitions.sh (spec 356). It landed without an
        installer entry, so the serving host refused every archive as
        not-implemented-yet (2026-09-03)."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True, text=True, env=env,
        )
        assert result.returncode == 0, result.stderr
        lib = tmp_path / ".local" / "bin" / "lib"
        assert (lib / "spec-transitions.sh").is_file()
        assert (lib / "transitions.json").is_file()
