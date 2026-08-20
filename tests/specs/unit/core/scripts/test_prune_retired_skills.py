"""Tests for prune_retired_skills in core/scripts/_install-skills.sh —
the half of the install that SUBTRACTS.

Four skills left core/skills/ on 2026-08-20 (commit ae42856). The
installed copies stayed in ~/.claude/skills/ and ~/.agents/skills/ on
both machines until someone deleted them by hand, and the uninstaller
could not have removed them either: the same commit took their names out
of its own list. The installers copy in and never remove, and the list
that says what to remove is a snapshot of what is shipped TODAY.

The manifest is the memory that snapshot never had: written on the
target machine by each install, naming exactly what that install
shipped, read by the NEXT one before it is overwritten. So these tests
are about the diff — what a name in the manifest but not in the source
means — and about the guards around an `rm -rf` driven by a file.

Run against /bin/bash on purpose, not `bash`: this machine's /bin/bash
is 3.2, and aide-run-spec already had to work around it once.
"""
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


def prune(helper, source_dir, target_dir, manifest):
    """Source the shared file and call the helper, the way an installer
    does — nothing else in the file runs."""
    return subprocess.run(
        [
            BASH,
            "-c",
            f'set -e; source "{helper}"; '
            f'prune_retired_skills "{source_dir}" "{target_dir}" "{manifest}"',
        ],
        capture_output=True,
        text=True,
    )


@pytest.fixture
def dirs(tmp_path):
    source = tmp_path / "core" / "skills"
    target = tmp_path / "installed"
    source.mkdir(parents=True)
    target.mkdir(parents=True)
    return source, target, target / ".aide-installed-manifest"


@pytest.mark.unit
class TestPruneRetiredSkills:
    def test_a_skill_that_left_the_source_is_removed(self, helper, dirs):
        """Criterion 6: the manifest names four, the source ships three."""
        source, target, manifest = dirs
        for name in ("aide-create", "aide-analyze", "aide-implement"):
            skill(source, name)
            installed(target, name)
        installed(target, "aide-to-html")
        manifest.write_text("aide-create\naide-analyze\naide-implement\naide-to-html\n")

        result = prune(helper, source, target, manifest)

        assert result.returncode == 0, result.stderr
        assert not (target / "aide-to-html").exists()
        for name in ("aide-create", "aide-analyze", "aide-implement"):
            assert (target / name).exists(), f"{name} is still shipped and must stay"

    def test_the_manifest_is_rewritten_to_what_is_shipped_now(self, helper, dirs):
        """Criterion 6: and the next install has a current memory to diff
        against, or the same name is pruned forever."""
        source, target, manifest = dirs
        skill(source, "aide-create")
        skill(source, "aide-analyze")
        manifest.write_text("aide-create\naide-analyze\naide-to-html\n")

        prune(helper, source, target, manifest)

        assert sorted(manifest.read_text().split()) == ["aide-analyze", "aide-create"]

    def test_a_first_install_removes_nothing_and_writes_a_manifest(self, helper, dirs):
        """Criterion 7: a machine with no history yet has nothing to
        accuse. Whatever is in the target was not put there by a prior
        install this mechanism knows about."""
        source, target, manifest = dirs
        skill(source, "aide-create")
        installed(target, "aide-create")
        installed(target, "somebody-elses-skill")

        result = prune(helper, source, target, manifest)

        assert result.returncode == 0, result.stderr
        assert (target / "somebody-elses-skill").exists()
        assert manifest.read_text().split() == ["aide-create"]

    def test_a_skill_never_named_by_the_manifest_is_never_touched(self, helper, dirs):
        """The no---delete guarantee the rsync already gives: ~/.claude/
        skills/ is allowed to hold skills aide did not put there."""
        source, target, manifest = dirs
        skill(source, "aide-create")
        installed(target, "aide-create")
        installed(target, "dataviz")
        manifest.write_text("aide-create\n")

        result = prune(helper, source, target, manifest)

        assert result.returncode == 0, result.stderr
        assert (target / "dataviz").exists()

    def test_a_name_whose_directory_is_already_gone_is_not_an_error(self, helper, dirs):
        """Criterion 8: removal is idempotent — somebody deleted it by
        hand, which is exactly what happened on 2026-08-20."""
        source, target, manifest = dirs
        skill(source, "aide-create")
        installed(target, "aide-create")
        manifest.write_text("aide-create\naide-to-html\n")

        result = prune(helper, source, target, manifest)

        assert result.returncode == 0, result.stderr
        assert (target / "aide-create").exists()

    def test_an_empty_manifest_line_removes_nothing(self, helper, dirs):
        """A blank line must never resolve to the target directory
        itself. This is an `rm -rf` driven by a file."""
        source, target, manifest = dirs
        skill(source, "aide-create")
        installed(target, "aide-create")
        manifest.write_text("\n\naide-create\n\n")

        result = prune(helper, source, target, manifest)

        assert result.returncode == 0, result.stderr
        assert target.exists()
        assert (target / "aide-create").exists()

    def test_a_manifest_name_that_is_a_path_is_refused(self, helper, dirs):
        """Same reason: a name is a directory name, and nothing else. A
        `..` in it would walk out of the skills directory."""
        source, target, manifest = dirs
        outside = target.parent / "not-a-skill"
        outside.mkdir()
        skill(source, "aide-create")
        manifest.write_text("../not-a-skill\n/etc\n.\n")

        result = prune(helper, source, target, manifest)

        assert result.returncode == 0, result.stderr
        assert outside.exists()

    def test_every_shipped_skill_survives_when_nothing_was_retired(self, helper, dirs):
        source, target, manifest = dirs
        for name in ("aide-create", "aide-analyze"):
            skill(source, name)
            installed(target, name)
        manifest.write_text("aide-create\naide-analyze\n")

        result = prune(helper, source, target, manifest)

        assert result.returncode == 0, result.stderr
        assert (target / "aide-create").exists()
        assert (target / "aide-analyze").exists()

    def test_a_source_directory_without_a_skill_md_is_not_a_skill(self, helper, dirs):
        """The install loop skips those, so the manifest must too — a
        name in the manifest that the install never copied would be
        pruned on the load after."""
        source, target, manifest = dirs
        skill(source, "aide-create")
        (source / "references").mkdir()

        prune(helper, source, target, manifest)

        assert manifest.read_text().split() == ["aide-create"]


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
        assert (target / "aide-create" / "SKILL.md").exists()
        manifest = (target / ".aide-installed-manifest").read_text().split()
        assert "aide-create" in manifest
        assert "aide-to-html" not in manifest
        assert set(manifest) == {
            d.name
            for d in (workspace_root / "core" / "skills").iterdir()
            if (d / "SKILL.md").exists()
        }


@pytest.mark.unit
class TestUninstallAgentsSkills:
    """install and uninstall must mirror each other (the repo's own rule
    in .claude/rules/development.md). The install writes a manifest now,
    so the uninstall is what removes it — and while it has the file
    open, the names in it are exactly the ones its own loop over
    core/skills/ cannot see."""

    def run_uninstall(self, helper, home):
        return subprocess.run(
            [BASH, "-c", f'set -e; source "{helper}"; uninstall_agents_skills'],
            capture_output=True,
            text=True,
            env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        )

    def test_it_removes_the_manifest_it_wrote(self, helper, tmp_path):
        home = tmp_path / "home"
        target = home / ".agents" / "skills"
        target.mkdir(parents=True)
        manifest = target / ".aide-installed-manifest"
        manifest.write_text("aide-create\n")

        result = self.run_uninstall(helper, home)

        assert result.returncode == 0, result.stderr
        assert not manifest.exists()

    def test_it_removes_a_retired_skill_the_source_no_longer_names(self, helper, tmp_path):
        home = tmp_path / "home"
        target = home / ".agents" / "skills"
        target.mkdir(parents=True)
        installed(target, "aide-to-html")
        (target / ".aide-installed-manifest").write_text("aide-to-html\n")

        result = self.run_uninstall(helper, home)

        assert result.returncode == 0, result.stderr
        assert not (target / "aide-to-html").exists()

    def test_a_skill_no_manifest_names_is_left_alone(self, helper, tmp_path):
        home = tmp_path / "home"
        target = home / ".agents" / "skills"
        target.mkdir(parents=True)
        installed(target, "somebody-elses-skill")
        (target / ".aide-installed-manifest").write_text("aide-to-html\n")

        result = self.run_uninstall(helper, home)

        assert result.returncode == 0, result.stderr
        assert (target / "somebody-elses-skill").exists()

    def test_a_machine_with_no_manifest_uninstalls_exactly_as_before(self, helper, tmp_path):
        home = tmp_path / "home"
        target = home / ".agents" / "skills"
        target.mkdir(parents=True)
        installed(target, "aide-create")

        result = self.run_uninstall(helper, home)

        assert result.returncode == 0, result.stderr
        assert not (target / "aide-create").exists()
