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
