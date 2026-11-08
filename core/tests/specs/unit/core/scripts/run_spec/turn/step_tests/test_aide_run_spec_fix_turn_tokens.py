"""The tokens of an implement step whose red test run went back to the
session: every turn counted once, as the cost already is.
"""

import json

from ....conftest import run
from ...run_spec_status_files import with_status

RED_MARKER = "test suite is red"
FIRST_TURN = {"inputTokens": 10, "outputTokens": 100, "cacheReadInputTokens": 1000, "cacheCreationInputTokens": 50}
FIX_TURN = {"inputTokens": 7, "outputTokens": 300, "cacheReadInputTokens": 2000, "cacheCreationInputTokens": 100}
# A resumed session reports its whole usage and cost so far, not the turn's own.
SESSION_AFTER_FIX = {k: FIRST_TURN[k] + FIX_TURN[k] for k in FIRST_TURN}


def _result(cost, usage):
    result = {
        "type": "result", "subtype": "success", "is_error": False,
        "session_id": "ee80227f-510c-45e9-bfbf-c5124f7761c0", "total_cost_usd": cost, "num_turns": 1,
        "terminal_reason": "completed", "result": "done",
    }
    if usage is not None:
        result["modelUsage"] = {"claude-sonnet-4": usage}
    return result


def _red_until_the_fix(workspace, fake_claude, fix_usage):
    manifest = workspace["project"] / ".aide" / "project.yaml"
    manifest.write_text(manifest.read_text().replace("AIDE_TEST_CMD: true", "AIDE_TEST_CMD: test -f green.txt"))
    return fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q '{RED_MARKER}'; then\n"
        "  printf 'green\\n' > green.txt && git add -A && git commit -q -m 'the test fix'\n"
        f"  echo '{json.dumps(_result(0.30, fix_usage))}'\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  echo '{json.dumps(_result(0.10, FIRST_TURN))}'\n"
        "fi\n"
    )


def test_a_red_suites_fix_turn_adds_its_tokens_to_the_steps_ac_5(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    claude = _red_until_the_fix(workspace, fake_claude, SESSION_AFTER_FIX)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 2
    assert abs(out["costUsd"] - 0.30) < 1e-6, out
    assert out["tokens"]["total"] == sum(FIRST_TURN.values()) + sum(FIX_TURN.values()), out["tokens"]
    assert out["tokens"]["input"] == 17, out["tokens"]


def test_a_fix_turn_that_metered_nothing_leaves_the_step_with_no_tokens_ac_5(runner, workspace, fake_claude):
    """A token figure is measured or absent: a sum with an unmeasured turn
    in it is not a measurement."""
    with_status(workspace, ["create", "analyze"])
    claude = _red_until_the_fix(workspace, fake_claude, None)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "completed", out
    assert "tokens" not in out, out
