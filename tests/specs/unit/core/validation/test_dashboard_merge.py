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
   `core/rules/tools-and-scripts.md` reads the ROOT only: a JS lockfile
   or `package.json` appearing there would silently redirect every AI's
   idea of "run the tests" from pytest to npm.
"""
import pytest


# The detection table in core/rules/tools-and-scripts.md, in the order it
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
