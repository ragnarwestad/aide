"""E2E: the runner runs a spec's analyze step on Codex, headless, and the
spec is really analyzed.

The spec is made with aide-create-spec (no AI); `analyze` goes through
core/scripts/aide-run-spec with the real `codex` on a small model, inside
the real srt sandbox, the way the board runs it. Real CLI calls, billed:
deselected by pytest.ini, run with `-m e2e`.
"""
import pytest

from .conftest import analyze_with, available

MODEL = "gpt-6-luna"


@pytest.mark.e2e
@pytest.mark.codex
@pytest.mark.slow
@pytest.mark.skipif(not available("codex"), reason="Codex CLI not installed")
@pytest.mark.skipif(not available("srt"), reason="srt (the sandbox a Codex step runs in) not installed")
def test_runner_analyzes_a_spec_on_codex(runner, workspace, workspace_root, real_cli):
    analyze_with("codex", MODEL, runner, workspace, workspace_root)
