"""E2E: Codex runs /aide-create and /aide-analyze as the installed skills
(~/.agents/skills), headless, and the spec it makes is really analyzed.

Called the way the dashboard's runner calls it: `codex exec` with the
prompt on stdin, in the workspace-write sandbox. Real CLI calls, billed:
deselected by pytest.ini, run with `-m e2e`.
"""
import subprocess

import pytest

from .conftest import available, run_workflow


@pytest.mark.e2e
@pytest.mark.codex
@pytest.mark.slow
@pytest.mark.skipif(not available("codex"), reason="Codex CLI not installed")
def test_aide_create_then_analyze(e2e_env):
    workspace, specs, env = e2e_env

    def invoke(skill: str, argument: str, timeout: int) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["codex", "exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "-"],
            input=f"/{skill} {argument}",
            capture_output=True, text=True, timeout=timeout, cwd=str(workspace), env=env,
        )

    run_workflow(invoke, specs)
