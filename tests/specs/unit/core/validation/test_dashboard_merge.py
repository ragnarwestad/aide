"""Validation tests for the dashboard subsystem living inside aide.

Spec 85 merged the standalone aide-dashboard repo into `dashboard/`. Two
things have to stay true afterwards, and neither is obvious from reading
either side alone:

1. The dashboard's source is actually here, at `dashboard/`.
2. There is exactly ONE project manifest in this repo — the root one —
   and it mentions the dashboard subsystem. `discoverProjects()` scans
   one level below its root for `.aide/project.yaml` and does not
   recurse, so a nested manifest at `dashboard/.aide/project.yaml`
   would be a file nothing reads, describing a project nothing shows.
3. The bun toolchain stays inside `dashboard/`. Two toolchains now meet
   in one repo, and the project-command detection in
   `core/skills/tools-and-scripts/SKILL.md` reads the ROOT only: a JS lockfile
   or `package.json` appearing there would silently redirect every AI's
   idea of "run the tests" from pytest to npm.
"""
import pytest


# The detection table in core/skills/tools-and-scripts/SKILL.md, in the order it
# lists them. The first match at the project root wins, and pytest.ini is
# near the bottom — so anything above it landing at the root outranks it.
JS_TOOLCHAIN_MARKERS = ("pnpm-lock.yaml", "package-lock.json", "yarn.lock",
                        "bun.lock", "bun.lockb", "package.json")


# Marker files that prove the dashboard's tree came across, not just an
# empty directory: its package manifest, its deploy entry point and its
# generator entry point.
DASHBOARD_MARKERS = ("package.json", "Makefile", "src/main.ts")


@pytest.mark.validation
class TestDashboardLivesInsideAide:
    """The dashboard subsystem is a subdirectory of this repo."""

    def test_dashboard_directory_has_its_marker_files(self, workspace_root):
        # Arrange
        dashboard = workspace_root / "dashboard"

        # Act & Assert
        assert dashboard.is_dir(), "dashboard/ should exist in the aide repo"
        for marker in DASHBOARD_MARKERS:
            assert (dashboard / marker).is_file(), \
                f"dashboard/{marker} should exist after the subtree merge"


@pytest.mark.validation
class TestSingleFoldedManifest:
    """One manifest at the root, none nested under dashboard/."""

    def test_no_nested_manifest_under_dashboard(self, workspace_root):
        # Arrange
        nested = workspace_root / "dashboard" / ".aide" / "project.yaml"

        # Act & Assert
        assert not nested.exists(), (
            "dashboard/.aide/project.yaml should be folded into the root "
            "manifest — discoverProjects() never looks that deep"
        )

    def test_root_manifest_mentions_the_dashboard_subsystem(self, workspace_root):
        # Arrange
        manifest = workspace_root / ".aide" / "project.yaml"
        assert manifest.is_file(), ".aide/project.yaml should exist"

        # Act
        content = manifest.read_text().lower()

        # Assert
        assert "dashboard" in content, (
            "the root manifest should describe the dashboard subsystem — "
            "folding the manifest means the content moves, not vanishes"
        )


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

    def test_the_root_still_declares_pytest(self, workspace_root):
        # Assert
        assert (workspace_root / "pytest.ini").is_file(), \
            "pytest.ini is what makes the root resolve to pytest"

    def test_the_bun_toolchain_lives_one_level_down(self, workspace_root):
        # Assert — the other half: it did come across, just not to the root
        assert (workspace_root / "dashboard" / "bun.lock").is_file(), \
            "dashboard/bun.lock should exist — that is where bun is driven from"


@pytest.mark.validation
class TestTheMergeInstallRefreshesEveryTool:
    """A code merge installs the shared sources for BOTH supported tools.

    Claude Code and Codex read the same skills and the same rules, but
    each has an installer of its own, and the post-merge script ran only
    Claude Code's. Codex therefore went on reading its install-time copy:
    on 2026-08-19 it created a spec on the four-file layout spec 82
    replaced, because its copy of `aide-create` still described the old
    one. Copilot is parked (no subscription) and reads
    `~/.agents/skills/`, which the Codex installer refreshes anyway.
    """

    def test_both_installers_run_after_a_merge(self, workspace_root):
        # Arrange
        script = workspace_root / "dashboard" / "deploy" / "install-after-merge.sh"

        # Act
        content = script.read_text(encoding="utf-8")

        # Assert
        for tool in ("claude-code", "codex"):
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
