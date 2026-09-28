"""The dashboard subsystem inside aide: the bun toolchain stays out of the
repo root, and a code merge reinstalls every tool's shared sources.

Project-command detection (`core/skills/tools-and-scripts/SKILL.md`)
reads the ROOT only: a JS lockfile or `package.json` appearing there would
silently redirect every AI's idea of "run the tests" from pytest to npm.
"""
import pytest


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
class TestTheMergeInstallRefreshesEveryTool:
    """A code merge installs the shared sources for BOTH supported tools.

    Claude Code and Codex read the same skills and the same rules, but
    each has an installer of its own, and the post-merge script ran only
    Claude Code's. Codex therefore went on reading its install-time copy:
    on 2026-08-19 it created a spec on the four-file layout spec 82
    replaced, because its copy of `aide-create` still described the old
    one. Copilot needs no line of its own: it reads `~/.agents/skills/`
    and the instructions file the Codex installer already refreshes.
    """

    #: Every tool whose own installer writes somewhere no other
    #: installer touches. Copilot is absent for the reason above.
    OWN_FILES = ("claude-code", "codex", "opencode")

    def test_every_installer_that_owns_a_file_runs_after_a_merge(self, workspace_root):
        # Arrange
        script = workspace_root / "dashboard" / "deploy" / "install-after-merge.sh"

        # Act
        content = script.read_text(encoding="utf-8")

        # Assert
        for tool in self.OWN_FILES:
            assert f"./implementations/{tool}/install.sh" in content, (
                f"{tool}'s installer should run after a merge — otherwise its "
                "copy of the skills and the rules drifts from the repo silently"
            )


@pytest.mark.validation
class TestInstallAfterMergeLogsInsteadOfDiscarding:
    """A tool the installer cannot declare (spec 334, REQ-5/REQ-6) has to
    reach somewhere a reader can find it later — not /dev/null, which a
    headless merge nobody is watching would otherwise discard it into."""

    def test_neither_installer_call_redirects_to_dev_null(self, workspace_root):
        script = workspace_root / "dashboard" / "deploy" / "install-after-merge.sh"
        content = script.read_text(encoding="utf-8")
        lines = [
            line for line in content.splitlines()
            if "./implementations/" in line and "install.sh" in line
        ]
        assert lines, "no installer call lines found in install-after-merge.sh"
        for line in lines:
            assert "/dev/null" not in line, \
                f"installer output is still discarded: {line}"
        assert "Library/Logs/aide-dashboard" in content or "AIDE_INSTALL_LOG" in content, \
            "install-after-merge.sh does not log installer output anywhere"
