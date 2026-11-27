"""E2E: the runner runs a spec's analyze step on OpenCode, headless, and
the spec is really analyzed.

The spec is made with aide-create-spec (no AI); `analyze` goes through
core/scripts/aide-run-spec with the real `opencode` on OpenCode Zen's free
model, inside the real srt sandbox, the way the board runs it. Real CLI
calls: deselected by pytest.ini, run with `-m e2e`.
"""
import pytest

from .conftest import analyze_with, available

MODEL = "opencode/nemotron-3.5-lightning-free"


@pytest.mark.e2e
@pytest.mark.slow
@pytest.mark.skipif(not available("opencode"), reason="OpenCode CLI not installed")
@pytest.mark.skipif(not available("srt"), reason="srt (the sandbox an OpenCode step runs in) not installed")
def test_runner_analyzes_a_spec_on_opencode(runner, workspace, workspace_root, real_cli):
    analyze_with("opencode", MODEL, runner, workspace, workspace_root)
