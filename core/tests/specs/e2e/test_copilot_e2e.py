"""E2E: Copilot uses the installed aide-create and aide-analyze skills
(~/.agents/skills), headless, and the spec it makes is really analyzed.

Copilot has no slash command for these, so the prompt names the skill in
words and the argument follows, as the dashboard's runner does for a CLI
without one. Real CLI calls, billed: deselected by pytest.ini, run with
`-m e2e`.
"""
import subprocess

import pytest

from .conftest import available, run_workflow


@pytest.mark.e2e
@pytest.mark.copilot
@pytest.mark.slow
@pytest.mark.skipif(not available("copilot"), reason="Copilot CLI not installed")
def test_aide_create_then_analyze(e2e_env):
    workspace, specs, env = e2e_env

    def invoke(skill: str, argument: str, timeout: int) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["copilot", "-p", f"Use the {skill} skill with this argument: {argument}", "--allow-all-tools"],
            capture_output=True, text=True, timeout=timeout, cwd=str(workspace), env=env,
        )

    run_workflow(invoke, specs)


ENV_MARKER = "AIDE_E2E_ENV_MARKER"


@pytest.mark.e2e
@pytest.mark.copilot
@pytest.mark.slow
@pytest.mark.skipif(not available("copilot"), reason="Copilot CLI not installed")
def test_child_process_inherits_the_job_environment_ac_1(e2e_env):
    """A shell command Copilot starts sees the variables the job sets:
    a harmless marker and AIDE_INSTALLATION_PATH, with the values given."""
    workspace, _specs, env = e2e_env
    marker = "aide-e2e-marker-7f3c"
    env = {**env, ENV_MARKER: marker}
    seen = workspace / "env-seen.txt"
    command = f'printf "%s\\n%s\\n" "${ENV_MARKER}" "$AIDE_INSTALLATION_PATH" > {seen.name}'

    result = subprocess.run(
        ["copilot", "-p", f"Run exactly this shell command and nothing else: {command}",
         "--allow-tool", "shell(printf)"],
        capture_output=True, text=True, timeout=180, cwd=str(workspace), env=env,
    )

    assert result.returncode == 0, f"copilot failed: {result.stderr}"
    assert seen.exists(), f"the shell command did not write {seen.name}: {result.stdout}"
    assert seen.read_text().splitlines() == [marker, env["AIDE_INSTALLATION_PATH"]]
