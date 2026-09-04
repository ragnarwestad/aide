"""The tools aide declares it needs: named once in the manifest the
installer reads, kept in step with the upgrade job, and never left as a
bare command the shell might or might not find.

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


def _fake_mise(tmp_path, body):
    """A stand-in `mise`, in its own directory so it can be prepended
    ahead of the ambient PATH — this machine (and likely others aide is
    installed on) has a REAL mise on PATH, which must never be the one
    that runs (plan review, Feasibility should-fix 3: an unprepended fake
    would let the real `mise use -g npm:markdownlint-cli2@latest` attempt
    a genuine network install as a side effect of running the tests)."""
    bin_dir = tmp_path / "fake-bin"
    bin_dir.mkdir(exist_ok=True)
    path = bin_dir / "mise"
    path.write_text(f"#!/usr/bin/env bash\n{body}\n")
    path.chmod(0o755)
    return bin_dir


@pytest.mark.validation
class TestInstallMiseDeclaredTools:
    """install_mise_declared_tools must declare markdownlint-cli2 to mise
    without ever failing the installer when mise or node is missing."""

    def test_warns_and_succeeds_without_mise(self, workspace_root, tmp_path):
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_mise_declared_tools'],
            capture_output=True,
            text=True,
            env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)},
        )
        assert result.returncode == 0, result.stderr
        assert "mise" in (result.stdout + result.stderr).lower()

    def test_warns_and_succeeds_without_node(self, workspace_root, tmp_path):
        # Fails only on `mise which ...` (how a missing node is detected),
        # succeeds on anything else.
        fake_bin = _fake_mise(
            tmp_path,
            '[ "$1" = "which" ] && exit 1\nexit 0',
        )
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_mise_declared_tools'],
            capture_output=True,
            text=True,
            env={"PATH": f"{fake_bin}:{os.environ['PATH']}", "HOME": str(tmp_path)},
        )
        assert result.returncode == 0, result.stderr
        assert "node" in (result.stdout + result.stderr).lower()

    def test_declares_markdownlint_via_mise(self, workspace_root, tmp_path):
        calls = tmp_path / "mise-calls.txt"
        fake_bin = _fake_mise(tmp_path, f'printf "%s\\n" "$*" >> {calls}\nexit 0')
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_mise_declared_tools'],
            capture_output=True,
            text=True,
            env={"PATH": f"{fake_bin}:{os.environ['PATH']}", "HOME": str(tmp_path)},
        )
        assert result.returncode == 0, result.stderr
        logged = calls.read_text() if calls.exists() else ""
        assert "use -g npm:markdownlint-cli2@latest" in logged, logged


@pytest.mark.validation
class TestInstallersDeclareMarkdownlint:
    """Every installer must call install_mise_declared_tools, or a machine
    that only ran one implementations/<ai>/install.sh never gets it."""

    def test_every_installer_calls_install_mise_declared_tools(self, workspace_root):
        for tool in ("claude-code", "copilot", "codex"):
            installer = workspace_root / "implementations" / tool / "install.sh"
            text = installer.read_text()
            assert "install_mise_declared_tools" in text, \
                f"implementations/{tool}/install.sh never calls install_mise_declared_tools"


@pytest.mark.validation
class TestUpgradeAiToolsKeepsMarkdownlintCurrent:
    """upgrade-ai-tools must keep markdownlint-cli2 current alongside the
    tools it already names, and report it in its own version listing."""

    @staticmethod
    def _text(workspace_root):
        return (workspace_root / "core" / "scripts" / "upgrade-ai-tools").read_text()

    def test_upgrade_line_includes_markdownlint(self, workspace_root):
        text = self._text(workspace_root)
        upgrade_line = next(
            line for line in text.splitlines() if line.strip().startswith("mise upgrade")
        )
        assert "npm:markdownlint-cli2" in upgrade_line, upgrade_line

    def test_installed_versions_report_includes_markdownlint(self, workspace_root):
        text = self._text(workspace_root)
        report_line = next(
            line for line in text.splitlines() if "mise ls" in line
        )
        assert "markdownlint" in report_line, report_line


@pytest.mark.validation
class TestMiseDeclaredToolsStayInStepWithUpgrade:
    """A tool declared by the installer that upgrade-ai-tools never
    upgrades would go stale forever after its first install (REQ-5)."""

    def test_every_mise_declared_tool_is_kept_current(self, workspace_root):
        install_bin_text = (
            workspace_root / "core" / "scripts" / "_install-bin.sh"
        ).read_text()
        match = re.search(r'^MISE_DECLARED_TOOLS="([^"]*)"', install_bin_text, re.MULTILINE)
        assert match, "MISE_DECLARED_TOOLS is missing from _install-bin.sh"
        declared_tools = match.group(1).split()
        assert declared_tools, "MISE_DECLARED_TOOLS is empty"

        upgrade_text = (
            workspace_root / "core" / "scripts" / "upgrade-ai-tools"
        ).read_text()
        upgrade_line = next(
            line for line in upgrade_text.splitlines()
            if line.strip().startswith("mise upgrade")
        )

        missing = [tool for tool in declared_tools if tool not in upgrade_line]
        assert not missing, (
            f"{missing} are declared in MISE_DECLARED_TOOLS but never upgraded by "
            f"upgrade-ai-tools: {upgrade_line}"
        )


@pytest.mark.validation
class TestMiseDeclaredToolsCoversTheSixNamedTools:
    """Spec 334's own measurement: jq, gh, bun, pandoc and md-to-pdf join
    markdownlint-cli2 (spec 332) as tools aide's installer declares on
    every machine, not tools that happen to already be there by hand."""

    SIX_TOOLS = ("markdownlint-cli2", "jq", "gh", "bun", "pandoc", "md-to-pdf")

    def test_all_six_tools_present(self, workspace_root):
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        text = installer.read_text()
        match = re.search(r'^MISE_DECLARED_TOOLS="([^"]*)"', text, re.MULTILINE)
        assert match, "MISE_DECLARED_TOOLS is missing from _install-bin.sh"
        declared = match.group(1)
        missing = [tool for tool in self.SIX_TOOLS if tool not in declared]
        assert not missing, f"{missing} missing from MISE_DECLARED_TOOLS: {declared}"

    def test_declares_all_six_via_fake_mise(self, workspace_root, tmp_path):
        calls = tmp_path / "mise-calls.txt"
        # Prepended ahead of the ambient PATH — this machine has a real
        # mise, and the point is to never let it attempt a real network
        # install as a side effect of running the tests.
        fake_bin = _fake_mise(tmp_path, f'printf "%s\\n" "$*" >> {calls}\nexit 0')
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_mise_declared_tools'],
            capture_output=True,
            text=True,
            env={"PATH": f"{fake_bin}:{os.environ['PATH']}", "HOME": str(tmp_path)},
        )
        assert result.returncode == 0, result.stderr
        logged = calls.read_text() if calls.exists() else ""

        text = installer.read_text()
        match = re.search(r'^MISE_DECLARED_TOOLS="([^"]*)"', text, re.MULTILINE)
        assert match, "MISE_DECLARED_TOOLS is missing from _install-bin.sh"
        for pkg in match.group(1).split():
            assert f"use -g {pkg}@latest" in logged, \
                f"mise was never asked to declare {pkg}: {logged}"


# The literal `command -v <bareword>` form every check in the repo uses
# today (REQ-9's own scope, per spec 334's Risk 4) — a `"$var"` or `$var`
# form after `command -v` does not match, by construction: neither `"`
# nor `$` is in the character class.
_BAREWORD_COMMAND_V = re.compile(r"command -v ([A-Za-z][A-Za-z0-9_.-]*)\b")


# Tools with no mise-manageable backend, or checked for a reason unrelated
# to aide's own installer (the editor Copilot's installer looks for).
_DECLARED_TOOL_EXCLUDE = {"mise", "claude", "codex", "code", "curl"}


@pytest.mark.validation
class TestRequiredToolsAreDeclared:
    """A script or installer that starts checking for a new external tool
    must add it to MISE_DECLARED_TOOLS too, or the machine that lacks it
    stays silently broken (REQ-9)."""

    def test_every_command_v_check_is_declared_or_excluded(self, workspace_root):
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        match = re.search(
            r'^MISE_DECLARED_TOOLS="([^"]*)"', installer.read_text(), re.MULTILINE
        )
        assert match, "MISE_DECLARED_TOOLS is missing from _install-bin.sh"
        declared_tools = match.group(1)

        files = _scripts(workspace_root)
        for tool in ("claude-code", "copilot", "codex"):
            files.append(workspace_root / "implementations" / tool / "install.sh")

        undeclared = []
        for f in files:
            for name in _BAREWORD_COMMAND_V.findall(f.read_text()):
                if name in _DECLARED_TOOL_EXCLUDE:
                    continue
                if name not in declared_tools:
                    undeclared.append((f.name, name))
        assert not undeclared, (
            f"tool(s) checked with `command -v` but missing from "
            f"MISE_DECLARED_TOOLS (or the documented exclude set): {undeclared}"
        )
