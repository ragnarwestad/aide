"""E2E: Claude Code runs /aide-create and /aide-analyze as the installed
skills, headless, and the spec it makes is really analyzed.

Real CLI calls, billed: deselected by pytest.ini, run with `-m e2e`.
"""
import subprocess

import pytest

from .conftest import available, run_workflow


@pytest.mark.e2e
@pytest.mark.claude_code
@pytest.mark.slow
@pytest.mark.skipif(not available("claude"), reason="Claude CLI not installed")
def test_aide_create_then_analyze(e2e_env):
    workspace, specs, env = e2e_env

    def invoke(skill: str, argument: str, timeout: int) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["claude", "-p", f"/{skill} {argument}", "--allowedTools", "Bash,Read,Write,Edit"],
            capture_output=True, text=True, timeout=timeout, cwd=str(workspace), env=env,
        )

    run_workflow(invoke, specs)
