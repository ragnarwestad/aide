"""Tests for the Codex installer putting skills into ~/.agents/skills/.

Codex reads SKILL.md skills from ~/.agents/skills/ (see the ai-tools
reference), but until now no installer touched that directory, so Codex
only had the workflows as AGENTS.md text. The installer copies every
skill in core/skills/ there; the uninstaller removes exactly those and
leaves foreign skills alone.
"""
import subprocess

import pytest

SYSTEM_PATH = "/usr/bin:/bin"


def _run(workspace_root, script, home, stdin=None):
    path = workspace_root / "implementations" / "codex" / script
    return subprocess.run(
        [str(path)],
        input=stdin,
        capture_output=True,
        text=True,
        env={"PATH": SYSTEM_PATH, "HOME": str(home)},
        stdin=subprocess.DEVNULL if stdin is None else None,
        timeout=120,
    )


def _skill_names(workspace_root):
    skills = workspace_root / "core" / "skills"
    return sorted(p.name for p in skills.iterdir() if p.is_dir())


@pytest.mark.codex
class TestInstallSkills:
    def test_install_copies_every_skill_to_agents_dir(self, workspace_root, tmp_path):
        result = _run(workspace_root, "install.sh", home=tmp_path)
        assert result.returncode == 0, result.stdout + result.stderr
        for name in _skill_names(workspace_root):
            skill_md = tmp_path / ".agents" / "skills" / name / "SKILL.md"
            assert skill_md.exists(), f"missing: ~/.agents/skills/{name}/SKILL.md"

    def test_install_replaces_a_stale_copy(self, workspace_root, tmp_path):
        name = _skill_names(workspace_root)[0]
        stale = tmp_path / ".agents" / "skills" / name
        stale.mkdir(parents=True)
        (stale / "SKILL.md").write_text("stale content")
        (stale / "leftover.md").write_text("should disappear")

        result = _run(workspace_root, "install.sh", home=tmp_path)
        assert result.returncode == 0, result.stdout + result.stderr
        fresh = (workspace_root / "core" / "skills" / name / "SKILL.md").read_text()
        assert (stale / "SKILL.md").read_text() == fresh
        assert not (stale / "leftover.md").exists()

    def test_uninstall_removes_only_aide_skills(self, workspace_root, tmp_path):
        result = _run(workspace_root, "install.sh", home=tmp_path)
        assert result.returncode == 0, result.stdout + result.stderr

        foreign = tmp_path / ".agents" / "skills" / "someone-elses-skill"
        foreign.mkdir(parents=True)
        (foreign / "SKILL.md").write_text("not ours")

        result = _run(workspace_root, "uninstall.sh", home=tmp_path, stdin="y\n")
        assert result.returncode == 0, result.stdout + result.stderr
        for name in _skill_names(workspace_root):
            assert not (tmp_path / ".agents" / "skills" / name).exists(), (
                f"uninstall left ~/.agents/skills/{name} behind"
            )
        assert (foreign / "SKILL.md").exists(), "uninstall must not touch foreign skills"
