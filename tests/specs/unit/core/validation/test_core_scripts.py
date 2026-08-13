"""Validation tests for the shared shell scripts in core/scripts."""
import os
import re
import shutil
import subprocess

import pytest

# Template placeholders such as {{DOMAIN}} — none may survive into core/scripts.
PLACEHOLDER_PATTERN = re.compile(r"\{\{[A-Za-z_]+\}\}")


def _scripts(workspace_root):
    scripts_dir = workspace_root / "core" / "scripts"
    if not scripts_dir.exists():
        pytest.skip("core/scripts not found")
    return sorted(p for p in scripts_dir.iterdir() if p.is_file())


@pytest.mark.validation
class TestCoreScriptsAreWellFormed:
    """The scripts must parse and must not carry migration leftovers."""

    def test_scripts_parse_as_bash(self, workspace_root):
        for script in _scripts(workspace_root):
            result = subprocess.run(
                ["bash", "-n", str(script)], capture_output=True, text=True
            )
            assert result.returncode == 0, \
                f"{script.name} is not valid bash:\n{result.stderr}"

    def test_scripts_have_no_unrendered_placeholders(self, workspace_root):
        for script in _scripts(workspace_root):
            found = PLACEHOLDER_PATTERN.findall(script.read_text())
            assert not found, \
                f"{script.name} still contains template placeholders: {found}"


@pytest.mark.validation
class TestValidateEnv:
    """validate-env must check the variable names the rest of the repo reads."""

    @staticmethod
    def _run(workspace_root, extra_env):
        env = {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"]}
        env.update(extra_env)
        return subprocess.run(
            [str(workspace_root / "core" / "scripts" / "validate-env"), "--quiet"],
            capture_output=True,
            text=True,
            env=env,
        )

    def test_fails_when_installation_path_is_missing(self, workspace_root):
        result = self._run(workspace_root, {})
        assert result.returncode == 1, \
            "Missing AIDE_INSTALLATION_PATH should be reported as an error"

    def test_passes_when_installation_path_is_set(self, workspace_root, tmp_path):
        result = self._run(
            workspace_root, {"AIDE_INSTALLATION_PATH": str(tmp_path)}
        )
        assert result.returncode == 0, \
            f"Set AIDE_INSTALLATION_PATH should pass, got:\n{result.stdout}{result.stderr}"

    def test_checks_all_documented_variables(self, workspace_root):
        """README documents three AIDE_* variables; validate-env must know them all."""
        env = {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"]}
        result = subprocess.run(
            [str(workspace_root / "core" / "scripts" / "validate-env")],
            capture_output=True,
            text=True,
            env=env,
        )
        for var in ("AIDE_INSTALLATION_PATH", "AIDE_PROJECTS_PATH", "AIDE_REPORTS_PATH"):
            assert var in result.stdout, \
                f"validate-env does not mention {var}:\n{result.stdout}"


@pytest.mark.validation
class TestInstallCommonBin:
    """The shared bin installer must ship every user-facing CLI script."""

    def test_validate_env_is_installed(self, workspace_root, tmp_path):
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "validate-env").is_file(), \
            "validate-env is not in COMMON_BIN_SCRIPTS, so it never reaches ~/.local/bin"


class TestBuildAgentsMd:
    """AGENTS.md must carry rule BODIES only, never their YAML frontmatter.

    The rules are concatenated for Copilot/Codex, which have no concept of
    Claude Code's paths frontmatter — before the fix, the raw `paths:` block
    from report-structure.md leaked into AGENTS.md as body text.
    """

    def test_output_contains_no_rule_frontmatter(self, workspace_root, tmp_path):
        core = tmp_path / "core"
        (core / "scripts").mkdir(parents=True)
        shutil.copy(
            workspace_root / "core" / "scripts" / "build-agents-md.sh",
            core / "scripts" / "build-agents-md.sh",
        )
        shutil.copy(workspace_root / "core" / "agents-intro.md", core / "agents-intro.md")
        shutil.copytree(workspace_root / "core" / "rules", core / "rules")

        result = subprocess.run(
            ["bash", str(core / "scripts" / "build-agents-md.sh")],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr

        lines = (core / "AGENTS.md").read_text().splitlines()
        assert "paths:" not in [line.strip() for line in lines], (
            "rule frontmatter leaked into AGENTS.md — build-agents-md.sh "
            "must strip the leading YAML block from each rule"
        )


class TestInstallAgentsSkills:
    """The shared skills installer must refuse to run without its source dir.

    On 2026-08-13 the lib was sourced from a shell where BASH_SOURCE was
    empty, _CORE_SKILLS_DIR resolved to "", and the "$_CORE_SKILLS_DIR"/*/
    glob expanded to the ROOT directories — the installer started copying
    /Applications into ~/.agents/skills/. The functions must fail fast when
    the resolved source directory does not exist.
    """

    def test_install_fails_fast_when_source_dir_is_invalid(self, workspace_root, tmp_path):
        installer = workspace_root / "core" / "scripts" / "_install-skills.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c",
             f'source "{installer}"; _CORE_SKILLS_DIR=/nonexistent; install_agents_skills'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode != 0, (
            "install_agents_skills must refuse to run when the skills source "
            "dir is missing, instead of globbing whatever the path expands to"
        )
        assert not (tmp_path / ".agents" / "skills").exists(), \
            "nothing may be created when the source dir is invalid"

    def test_uninstall_fails_fast_when_source_dir_is_invalid(self, workspace_root, tmp_path):
        installer = workspace_root / "core" / "scripts" / "_install-skills.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c",
             f'source "{installer}"; _CORE_SKILLS_DIR=/nonexistent; uninstall_agents_skills'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode != 0
