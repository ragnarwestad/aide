"""Validation tests for the shared shell scripts in core/scripts."""
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.specs.unit.core.validation.test_templates import structure_block

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

    def test_the_installers_parse_as_bash(self, workspace_root):
        # The installers live outside core/scripts and so fell outside the
        # check above — a syntax error in one of them used to reach a user
        # before anything noticed (spec 175).
        scripts = [workspace_root / "install-all.sh", workspace_root / "uninstall-all.sh"]
        for tool in ("claude-code", "codex", "copilot"):
            scripts.append(workspace_root / "implementations" / tool / "install.sh")
            scripts.append(workspace_root / "implementations" / tool / "uninstall.sh")
        for script in scripts:
            assert script.is_file(), f"{script} is missing"
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
        """Two AIDE_* environment variables remain; the specs path is
        per-project .aide/config (spec 73) and must NOT be checked as env."""
        env = {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"]}
        result = subprocess.run(
            [str(workspace_root / "core" / "scripts" / "validate-env")],
            capture_output=True,
            text=True,
            env=env,
        )
        for var in ("AIDE_INSTALLATION_PATH", "AIDE_PROJECTS_PATH"):
            assert var in result.stdout, \
                f"validate-env does not mention {var}:\n{result.stdout}"
        assert "AIDE_SPECS_PATH is not set" not in result.stdout, \
            "the retired env var must not be checked"


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

    def test_aide_record_test_run_is_installed(self, workspace_root, tmp_path):
        """The archive gate calls it by name. It shipped without being in
        COMMON_BIN_SCRIPTS, so the serving host never had it: the gate
        could not make the record it refuses for the lack of, and every
        archive was refused with nothing to show for it."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "aide-record-test-run").is_file(), \
            "aide-record-test-run is not in COMMON_BIN_SCRIPTS, so the archive gate cannot run it"

    def test_aide_resolve_test_cmd_is_installed(self, workspace_root, tmp_path):
        """Spec 361. aide-archive-spec calls it by name, next to itself
        in the same installed directory — missing from
        COMMON_BIN_SCRIPTS, the same way aide-record-test-run once was,
        would leave the gate unable to resolve a command at all on a
        freshly installed host."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True, text=True, env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "aide-resolve-test-cmd").is_file(), \
            "aide-resolve-test-cmd is not in COMMON_BIN_SCRIPTS, so the archive gate cannot run it"

    def test_spec_state_lib_and_backfill_are_installed(self, workspace_root, tmp_path):
        """Spec 355 moved the spec's state into lib/spec-state.sh, which
        aide-archive-spec sources when present — and treats every spec as
        not implemented when absent. It shipped without being in the
        installer's lists, so the serving host refused every archive."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True, text=True, env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "lib" / "spec-state.sh").is_file(), \
            "lib/spec-state.sh is not in COMMON_BIN_LIB_SCRIPTS"
        assert (tmp_path / ".local" / "bin" / "aide-backfill-spec-state").is_file(), \
            "aide-backfill-spec-state is not in COMMON_BIN_SCRIPTS"

    def test_aide_create_spec_is_installed(self, workspace_root, tmp_path):
        """Spec 248, AC9. aide-create-spec is /aide-create's own Step 4
        script — if it drops out of COMMON_BIN_SCRIPTS, install-all.sh
        stops shipping it and every Step 4 invocation breaks."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "aide-create-spec").is_file(), \
            "aide-create-spec is not in COMMON_BIN_SCRIPTS, so it never reaches ~/.local/bin"

    def test_aide_write_spec_is_installed(self, workspace_root, tmp_path):
        """Spec 282. aide-write-spec is the one legitimate way
        /aide-analyze, /aide-implement and /aide-archive land a spec
        file's content on disk — if it drops out of COMMON_BIN_SCRIPTS,
        every one of those Bash calls breaks."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "aide-write-spec").is_file(), \
            "aide-write-spec is not in COMMON_BIN_SCRIPTS, so it never reaches ~/.local/bin"

    def test_aide_print_specs_guard_is_installed(self, workspace_root, tmp_path):
        """Spec 282, REQ-4. aide-print-specs-guard is how a developer
        gets a ready-to-paste deny-rule snippet for their own project —
        if it drops out of COMMON_BIN_SCRIPTS, it never reaches
        ~/.local/bin at all."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "aide-print-specs-guard").is_file(), \
            "aide-print-specs-guard is not in COMMON_BIN_SCRIPTS, so it never reaches ~/.local/bin"

    def test_workflow_steps_json_is_installed(self, workspace_root, tmp_path):
        """Spec 349, REQ-3a. workflow-steps.json is the one file both
        aide-run-spec (jq) and the dashboard (import) read the workflow's
        step lists from — if it drops out of COMMON_BIN_LIB_SCRIPTS, a
        freshly installed runner has no file to read and refuses every
        command."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "lib" / "workflow-steps.json").is_file(), \
            "workflow-steps.json is not in COMMON_BIN_LIB_SCRIPTS, so it never reaches ~/.local/bin/lib"



















@pytest.mark.validation
class TestInstalledVersionStamp:
    """install_common_bin records which repo checkout and commit produced
    this ~/.local/bin copy, so aide-preflight can later tell it apart from
    the repo's current HEAD (REQ-7)."""

    def test_install_common_bin_writes_a_stamp(self, workspace_root, tmp_path):
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env={"PATH": os.environ["PATH"], "HOME": str(tmp_path)},
        )
        assert result.returncode == 0, result.stderr
        stamp = tmp_path / ".local" / "bin" / ".aide-installed-version"
        assert stamp.is_file(), "install_common_bin did not write a version stamp"
        lines = stamp.read_text().splitlines()
        expected_sha = subprocess.run(
            ["git", "-C", str(workspace_root), "rev-parse", "HEAD"],
            capture_output=True, text=True,
        ).stdout.strip()
        assert len(lines) >= 2, f"stamp has too few lines: {lines}"
        assert lines[1] == expected_sha, (
            f"stamp's second line should be the repo's HEAD SHA "
            f"({expected_sha}), got: {lines}"
        )


@pytest.mark.validation
class TestJqRequiredContractStaysConsistent:
    """Every script that refuses to run without jq must say so in the same
    JSON shape (REQ-6) — widened to five scripts after plan review found
    aide-run-spec's own check was weaker than the other four."""

    JQ_REQUIRING_SCRIPTS = (
        "aide-write-spec", "aide-create-spec", "aide-archive-spec",
        "aide-record-test-run", "aide-run-spec",
    )

    def test_all_five_jq_scripts_share_the_same_error_shape(self, workspace_root, tmp_path):
        import json

        # A scratch PATH that mirrors every real system bin directory
        # MINUS jq — never plain /usr/bin:/bin, which still resolves a
        # real jq on this development machine (plan review, feasibility
        # should-fix 2). A truly jq-less-but-otherwise-empty PATH is not
        # enough either: these scripts reach for ordinary utilities
        # (mktemp, dirname, ...) before their own jq check runs, and env's
        # own "#!/usr/bin/env bash" shebang resolution needs bash on PATH
        # too — so this copies everything else through and omits only jq.
        empty_bin = tmp_path / "empty-bin"
        empty_bin.mkdir()
        for real_dir in dict.fromkeys(os.environ["PATH"].split(":")):
            real_path = Path(real_dir)
            if not real_path.is_dir():
                continue
            for entry in real_path.iterdir():
                if entry.name == "jq" or (empty_bin / entry.name).exists():
                    continue
                try:
                    (empty_bin / entry.name).symlink_to(entry)
                except OSError:
                    pass
        for name in self.JQ_REQUIRING_SCRIPTS:
            script = workspace_root / "core" / "scripts" / name
            result = subprocess.run(
                [str(script)],
                capture_output=True,
                text=True,
                env={"PATH": str(empty_bin), "HOME": str(tmp_path)},
            )
            assert result.returncode == 2, f"{name}: expected exit 2, got {result.returncode}"
            payload = json.loads(result.stdout.strip().splitlines()[0])
            assert payload.get("ok") is False, f"{name}: {payload}"
            assert payload.get("exitCode") == 2, f"{name}: {payload}"
            assert payload.get("terminalReason") == "refused", f"{name}: {payload}"
            assert "jq" in payload.get("error", ""), f"{name}: {payload}"

























class TestTheSuiteKeepsOutOfTheRealGateLog:
    def test_the_gate_log_is_pointed_at_tmp_for_every_test(self):
        """The archive gate's fixture runs used to land in the serving
        host's own test-gate.log (2026-09-02/03), interleaved with real
        gates until nobody could read either."""
        log = os.environ.get("AIDE_TEST_GATE_LOG", "")
        assert log, "tests/conftest.py must point AIDE_TEST_GATE_LOG at a temp file"
        assert "Library/Logs" not in log
