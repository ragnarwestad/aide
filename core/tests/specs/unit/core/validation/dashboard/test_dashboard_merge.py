"""The dashboard subsystem inside aide: the bun toolchain stays out of the
repo root, and a code merge reinstalls every tool's shared sources.

Project-command detection (`core/skills/tools-and-scripts/SKILL.md`)
reads the ROOT only: a JS lockfile or `package.json` appearing there would
silently redirect every AI's idea of "run the tests" from pytest to npm.
"""
import os
import subprocess

import pytest

from ..installer.tool_list import copy_with_fake_tool, read_tools


# The detection table in core/skills/tools-and-scripts/SKILL.md, in the order it
# lists them. The first match at the project root wins, and pytest.ini is
# near the bottom — so anything above it landing at the root outranks it.
JS_TOOLCHAIN_MARKERS = ("pnpm-lock.yaml", "package-lock.json", "yarn.lock",
                        "bun.lock", "bun.lockb", "package.json")


@pytest.mark.validation
class TestToolchainsStaySeparate:
    """pytest at the root, bun in dashboard/ — the merge kept them apart."""

    def test_no_js_toolchain_marker_at_the_repo_root(self, workspace_root):
        # Act
        stray = [m for m in JS_TOOLCHAIN_MARKERS if (workspace_root / m).exists()]

        # Assert
        assert not stray, (
            f"{stray} at the repo root would make project-command detection "
            "resolve to a JS runner instead of pytest — the dashboard's bun "
            "toolchain belongs under dashboard/"
        )


@pytest.mark.validation
class TestTheDeployInstallRefreshesEveryTool:
    """Deploy runs the installer of every tool on the shared tool list.

    Each tool's instructions file is written only by its own installer, so
    a tool Deploy skips keeps running on the rules it was installed with.
    """

    def test_every_listed_installer_runs_and_logs_ac_1_ac_3(self, workspace_root, tmp_path):
        # Arrange
        copy_with_fake_tool(workspace_root, tmp_path, (
            "dashboard/deploy/install-after-merge.sh",
            "core/scripts/lib/ai-tools",
        ))
        ran = tmp_path / "ran.txt"
        implementations = [tool["implementation"] for tool in read_tools(tmp_path)]
        for implementation in implementations:
            installer = tmp_path / "core/implementations" / implementation / "install.sh"
            installer.parent.mkdir(parents=True, exist_ok=True)
            installer.write_text(
                "#!/bin/bash\n"
                f'echo {implementation} >> "{ran}"\n'
                f"echo installed {implementation}\n"
                f"echo warned {implementation} >&2\n"
            )
            installer.chmod(0o755)
        log = tmp_path / "install.log"
        env = {key: value for key, value in os.environ.items() if key != "AI_TOOLS_FILE"}
        env.update(
            AIDE_INSTALL_LOG=str(log),
            AIDE_DASH_LABEL="test.label",
            AIDE_DASH_PLIST=str(tmp_path / "missing.plist"),
            AIDE_DASH_BUN=str(tmp_path / "missing-bun"),
        )

        # Act
        result = subprocess.run(
            ["bash", str(tmp_path / "dashboard/deploy/install-after-merge.sh")],
            env=env, capture_output=True, text=True, stdin=subprocess.DEVNULL,
        )

        # Assert
        assert result.returncode == 0, result.stderr
        assert "copilot" in implementations and "fake-impl" in implementations
        assert ran.read_text().split() == implementations
        logged = log.read_text()
        for implementation in implementations:
            assert f"installed {implementation}" in logged
            assert f"warned {implementation}" in logged


