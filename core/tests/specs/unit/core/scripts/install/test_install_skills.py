"""Tests for the production skill install and uninstall functions."""
import subprocess

import pytest

BASH = "/bin/bash"


@pytest.fixture
def helper(workspace_root):
    return workspace_root / "core" / "scripts" / "_install-skills.sh"


def skill(source_dir, name, body="# skill\n"):
    """One shipped skill: a directory with a SKILL.md in it."""
    d = source_dir / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(body)
    return d


def installed(target_dir, name):
    """A skill's installed copy, as the last install left it."""
    d = target_dir / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text("# installed\n")
    return d


def run_function(helper, source_dir, function, target_dir, *excluded):
    args = " ".join(f'"{value}"' for value in (target_dir, *excluded))
    return subprocess.run(
        [BASH, "-c", f'set -e; source "{helper}"; _CORE_SKILLS_DIR="{source_dir}"; {function} {args}'],
        capture_output=True,
        text=True,
    )


def test_install_replaces_the_complete_skill_directory_ac_2(helper, dirs):
    source, target, _ = dirs
    shipped = skill(source, "aide-create")
    (shipped / "current.txt").write_text("current")
    old = installed(target, "aide-create")
    (old / "deleted.txt").write_text("stale")

    result = run_function(helper, source, "install_skills", target)

    assert result.returncode == 0, result.stderr
    assert not (target / "aide-create/deleted.txt").exists()
    assert (target / "aide-create/current.txt").read_text() == "current"


def test_install_manifest_contains_only_installed_skills_ac_3(helper, dirs):
    source, target, manifest = dirs
    skill(source, "aide-create")
    skill(source, "spec-structure")
    installed(target, "retired")
    manifest.write_text("retired\n")

    result = run_function(helper, source, "install_skills", target, "spec-structure")

    assert result.returncode == 0, result.stderr
    assert manifest.read_text().splitlines() == ["aide-create"]
    assert not (target / "retired").exists()


def test_uninstall_removes_exactly_the_manifest_ac_3(helper, dirs):
    _, target, manifest = dirs
    for name in ("owned", "shipped-but-not-listed", "foreign"):
        installed(target, name)
    manifest.write_text("owned\n")

    result = run_function(helper, target.parent / "unused", "uninstall_skills", target)

    assert result.returncode == 0, result.stderr
    assert not (target / "owned").exists()
    assert (target / "shipped-but-not-listed").exists()
    assert (target / "foreign").exists()
    assert not manifest.exists()


def test_uninstall_without_manifest_removes_nothing_ac_3(helper, dirs):
    _, target, _ = dirs
    installed(target, "foreign")
    result = run_function(helper, target.parent / "unused", "uninstall_skills", target)
    assert result.returncode == 0, result.stderr
    assert (target / "foreign").exists()


@pytest.fixture
def dirs(tmp_path):
    source = tmp_path / "core" / "skills"
    target = tmp_path / "installed"
    source.mkdir(parents=True)
    target.mkdir(parents=True)
    return source, target, target / ".aide-installed-manifest"


@pytest.mark.unit
class TestProductionSkillManifest:
    @pytest.mark.parametrize("function", ["install_skills", "uninstall_skills"])
    def test_invalid_manifest_names_cannot_escape_the_target_ac_3(self, helper, dirs, function):
        source, target, manifest = dirs
        outside = target.parent / "outside"
        outside.mkdir()
        skill(source, "aide-create")
        installed(target, "aide-create")
        manifest.write_text("\n.\n..\n../outside\n/etc\naide-create\n")

        result = run_function(helper, source, function, target)

        assert result.returncode == 0, result.stderr
        assert outside.exists()
        assert target.exists()

    def test_first_install_keeps_unrecorded_skills_and_skips_non_skills_ac_7(self, helper, dirs):
        source, target, manifest = dirs
        skill(source, "aide-create")
        (source / "references").mkdir()
        installed(target, "user-owned")

        result = run_function(helper, source, "install_skills", target)

        assert result.returncode == 0, result.stderr
        assert (target / "user-owned").exists()
        assert manifest.read_text().splitlines() == ["aide-create"]

    def test_uninstall_ignores_a_recorded_skill_that_is_already_missing_ac_2(self, helper, dirs):
        source, target, manifest = dirs
        manifest.write_text("missing\n")

        result = run_function(helper, source, "uninstall_skills", target)

        assert result.returncode == 0, result.stderr
        assert not manifest.exists()


@pytest.mark.unit
class TestInstallAgentsSkillsPrunes:
    """The shared Codex/Copilot install path calls the helper itself —
    a helper nothing calls fixes nothing."""

    def test_install_agents_skills_removes_a_retired_skill(self, helper, tmp_path, workspace_root):
        home = tmp_path / "home"
        (home / ".agents" / "skills").mkdir(parents=True)
        target = home / ".agents" / "skills"
        installed(target, "aide-to-html")
        (target / ".aide-installed-manifest").write_text("aide-to-html\n")

        result = subprocess.run(
            [BASH, "-c", f'set -e; source "{helper}"; install_agents_skills'],
            capture_output=True,
            text=True,
            env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        )

        assert result.returncode == 0, result.stderr
        assert not (target / "aide-to-html").exists()
        # And the real skills went in, so the prune did not eat the install.
        assert (target / "aide-explore" / "SKILL.md").exists()
        manifest = (target / ".aide-installed-manifest").read_text().split()
        assert "aide-explore" in manifest
        assert "aide-to-html" not in manifest
        assert set(manifest) == {
            d.name
            for d in (workspace_root / "core" / "skills").iterdir()
            if (d / "SKILL.md").exists()
        }

    def test_a_spec_steps_instructions_are_not_a_skill_and_an_earlier_copy_goes(
        self, helper, tmp_path
    ):
        """The spec steps run only on the board: their instructions sit beside
        the runner, and no AI session is offered them as skills."""
        home = tmp_path / "home"
        target = home / ".agents" / "skills"
        steps = ("aide-create", "aide-analyze", "aide-implement", "aide-archive", "aide-close", "aide-reopen")
        for name in steps:
            installed(target, name)
        (target / ".aide-installed-manifest").write_text("".join(f"{name}\n" for name in steps))

        result = subprocess.run(
            [BASH, "-c", f'set -e; source "{helper}"; install_agents_skills'],
            capture_output=True,
            text=True,
            env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        )

        assert result.returncode == 0, result.stderr
        assert [name for name in steps if (target / name).exists()] == []
        assert (target / "aide-explore" / "SKILL.md").exists()


@pytest.mark.unit
class TestUninstallAgentsSkills:
    """install and uninstall must mirror each other (the repo's own rule
    in AGENTS.md). The install writes a manifest now,
    so the uninstall is what removes it — and while it has the file
    open, the names in it are exactly the ones its own loop over
    core/skills/ cannot see."""

    @staticmethod
    def run_uninstall(helper, home):
        return subprocess.run(
            [BASH, "-c", f'set -e; source "{helper}"; uninstall_agents_skills'],
            capture_output=True,
            text=True,
            env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        )

    def test_it_removes_a_retired_skill_the_source_no_longer_names(self, helper, tmp_path):
        home = tmp_path / "home"
        target = home / ".agents" / "skills"
        target.mkdir(parents=True)
        installed(target, "aide-to-html")
        (target / ".aide-installed-manifest").write_text("aide-to-html\n")

        result = self.run_uninstall(helper, home)

        assert result.returncode == 0, result.stderr
        assert not (target / "aide-to-html").exists()
