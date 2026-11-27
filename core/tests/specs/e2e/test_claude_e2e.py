"""E2E: the runner runs a spec's analyze step on Claude Code, headless,
and the spec is really analyzed.

The spec is made with aide-create-spec (no AI); `analyze` goes through
core/scripts/aide-run-spec with the real `claude` on a Haiku model, the
way the board runs it. Real CLI calls, billed: deselected by pytest.ini,
run with `-m e2e`.
"""
import pytest

from .conftest import analyze_with, available

MODEL = "haiku"


@pytest.mark.e2e
@pytest.mark.claude_code
@pytest.mark.slow
@pytest.mark.skipif(not available("claude"), reason="Claude CLI not installed")
def test_runner_analyzes_a_spec_on_claude(runner, workspace, workspace_root, real_cli):
    analyze_with("claude", MODEL, runner, workspace, workspace_root)
