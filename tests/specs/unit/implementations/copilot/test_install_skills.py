"""Tests for the Copilot installer putting skills into ~/.agents/skills/.

Verified hands-on against Copilot CLI 1.0.79: personal skills are read
from ~/.copilot/skills/ or ~/.agents/skills/ — NOT ~/.claude/skills/
anymore (a probe skill placed only there was not listed). So the Copilot
installer must put the skills into ~/.agents/skills/ itself instead of
leaning on the Claude Code installer.

~/.agents/skills/ is shared with Codex, so the individual uninstaller
leaves it alone; only uninstall-all.sh removes the skills (same rule as
the shared ~/.local/bin scripts).
"""
import subprocess

import pytest

SYSTEM_PATH = "/usr/bin:/bin"


def _run(workspace_root, script_path, home, stdin=None):
    return subprocess.run(
        [str(workspace_root / script_path)],
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


@pytest.mark.copilot
class TestCopilotInstallSkills:
    def test_install_copies_every_skill_to_agents_dir(self, workspace_root, tmp_path):
        result = _run(workspace_root, "implementations/copilot/install.sh", home=tmp_path)
        assert result.returncode == 0, result.stdout + result.stderr
        for name in _skill_names(workspace_root):
            skill_md = tmp_path / ".agents" / "skills" / name / "SKILL.md"
            assert skill_md.exists(), f"missing: ~/.agents/skills/{name}/SKILL.md"

    def test_uninstall_keeps_the_shared_skills(self, workspace_root, tmp_path):
        result = _run(workspace_root, "implementations/copilot/install.sh", home=tmp_path)
        assert result.returncode == 0, result.stdout + result.stderr

        result = _run(
            workspace_root, "implementations/copilot/uninstall.sh",
            home=tmp_path, stdin="y\n",
        )
        assert result.returncode == 0, result.stdout + result.stderr
        for name in _skill_names(workspace_root):
            assert (tmp_path / ".agents" / "skills" / name).exists(), (
                f"uninstall removed the shared ~/.agents/skills/{name} — "
                "Codex reads it too; only uninstall-all.sh may remove it"
            )


@pytest.mark.implementations
class TestUninstallAllRemovesSharedSkills:
    def test_uninstall_all_removes_the_skills(self, workspace_root, tmp_path):
        for script in ("implementations/copilot/install.sh",
                       "implementations/codex/install.sh"):
            result = _run(workspace_root, script, home=tmp_path)
            assert result.returncode == 0, result.stdout + result.stderr

        foreign = tmp_path / ".agents" / "skills" / "someone-elses-skill"
        foreign.mkdir(parents=True)
        (foreign / "SKILL.md").write_text("not ours")

        result = _run(workspace_root, "uninstall-all.sh", home=tmp_path, stdin="y\ny\ny\n")
        assert result.returncode == 0, result.stdout + result.stderr
        for name in _skill_names(workspace_root):
            assert not (tmp_path / ".agents" / "skills" / name).exists(), (
                f"uninstall-all left ~/.agents/skills/{name} behind"
            )
        assert (foreign / "SKILL.md").exists(), (
            "uninstall-all must not touch foreign skills"
        )
