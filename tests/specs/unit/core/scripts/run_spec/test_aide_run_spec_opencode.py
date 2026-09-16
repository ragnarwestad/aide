"""The third tool: what opencode is told on its command line, what it
records, how a permission mode reaches it, and how a step asks for its
skill.

opencode differs from the other two in three ways that each get a test
here: its totals are a SUM over every `step_finish` rather than one
closing event, its safety is an agent rather than a sandbox flag, and it
has no slash command for aide's skills, so the prompt names the skill in
words instead.
"""

import json

import pytest

from ..conftest import run
from .run_spec_results import (
    OPENCODE_SESSION_ID,
    OPENCODE_STREAM_FAILED,
    OPENCODE_STREAM_OK,
    OPENCODE_TOTALS,
    emits,
)


def test_an_opencode_run_sums_tokens_and_cost_over_every_step(runner, workspace, fake_opencode):
    """opencode reports per STEP, not per turn. Reading the last event
    alone would report the final step's numbers as the whole run's."""
    oc = fake_opencode(emits(OPENCODE_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="opencode", opencode=oc)
    assert rc == 0, out
    assert out["tool"] == "opencode"
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"
    assert out["sessionId"] == OPENCODE_SESSION_ID
    assert out["costMeasured"] is True
    assert out["costUsd"] == pytest.approx(OPENCODE_TOTALS["cost"])
    tokens = out["tokens"]
    assert tokens["input"] == OPENCODE_TOTALS["input"]
    # Reasoning tokens are billed as output, so both halves count — the
    # same rule Codex's usage block already follows.
    assert tokens["output"] == OPENCODE_TOTALS["output"]
    assert tokens["cacheRead"] == OPENCODE_TOTALS["cacheRead"]
    assert tokens["cacheCreation"] == OPENCODE_TOTALS["cacheCreation"]
    assert tokens["total"] == (
        OPENCODE_TOTALS["input"]
        + OPENCODE_TOTALS["output"]
        + OPENCODE_TOTALS["cacheRead"]
        + OPENCODE_TOTALS["cacheCreation"]
    )


def test_an_opencode_error_event_is_the_failure_and_carries_its_message(
    runner, workspace, fake_opencode
):
    """There is no failed-turn event to select: the `error` event is the
    only place a sentence for the reader exists."""
    oc = fake_opencode(emits(OPENCODE_STREAM_FAILED))
    rc, out, _ = run(runner, workspace, tool="opencode", opencode=oc)
    assert out["ok"] is False, out
    assert "the model refused the turn" in json.dumps(out)
    # The session is read off any event, so a run that failed before a
    # single step finished still says which session it was.
    assert out["sessionId"] == OPENCODE_SESSION_ID


@pytest.mark.parametrize(
    "mode,expected,forbidden",
    [
        ("bypassPermissions", ["--agent", "build", "--auto"], []),
        ("acceptEdits", ["--agent", "build"], ["--auto"]),
        ("plan", ["--agent", "plan"], ["--auto"]),
    ],
)
def test_a_permission_mode_reaches_opencode_as_an_agent(
    runner, workspace, fake_opencode, mode, expected, forbidden
):
    """opencode has no sandbox flag. The agent IS the boundary, and the
    `plan` agent is the read-only one."""
    oc = fake_opencode(emits(OPENCODE_STREAM_OK))
    run(runner, workspace, tool="opencode", opencode=oc, permission_mode=mode)
    argv = fake_opencode.calls.read_text()
    for token in expected:
        assert token in argv, argv
    for token in forbidden:
        assert token not in argv, argv


def test_an_unknown_permission_mode_refuses_rather_than_guessing(
    runner, workspace, fake_opencode
):
    """A mode with no entry must refuse: guessing wrong means a step
    running with the wrong boundary and nobody finding out."""
    oc = fake_opencode(emits(OPENCODE_STREAM_OK))
    rc, out, _ = run(
        runner, workspace, tool="opencode", opencode=oc, permission_mode="noSuchMode"
    )
    assert rc != 0, out
    assert "opencode" in json.dumps(out)


def test_the_prompt_names_the_skill_because_opencode_has_no_slash_command(
    runner, workspace, fake_opencode
):
    """Claude Code and Codex read `/aide-analyze <spec>`. opencode finds
    the same SKILL.md files and reaches them through a `skill` tool, by
    name, so the prompt has to say the name in words."""
    oc = fake_opencode(emits(OPENCODE_STREAM_OK))
    run(runner, workspace, tool="opencode", opencode=oc, command="analyze")
    prompt = fake_opencode.prompt_log.read_text()
    assert "aide-analyze" in prompt, prompt
    assert not prompt.startswith("/aide-analyze"), prompt
    # The spec's own number, which is what every tool is given — the
    # folder name is resolved on the runner's side, not the model's.
    assert workspace["folder"].split("-")[0] in prompt, prompt


def test_the_stream_is_asked_for_as_json_on_stdout(runner, workspace, fake_opencode):
    """One event per line as it happens, the prompt read from stdin —
    the same shape the other two tools are driven in."""
    oc = fake_opencode(emits(OPENCODE_STREAM_OK))
    run(runner, workspace, tool="opencode", opencode=oc)
    argv = fake_opencode.calls.read_text()
    assert "run" in argv.split(), argv
    assert "--format json" in argv, argv


def test_a_missing_opencode_binary_refuses_by_name(runner, workspace, tmp_path):
    """The refusal names the override to set, as the other two do."""
    missing = tmp_path / "not-here"
    rc, out, _ = run(runner, workspace, tool="opencode", opencode=missing)
    assert rc != 0, out
    assert "AIDE_OPENCODE_BIN" in json.dumps(out)
