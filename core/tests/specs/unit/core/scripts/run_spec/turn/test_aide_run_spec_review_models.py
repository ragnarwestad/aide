"""Implement's review on another model than the step, and the verification
that checks each defect it finds before any goes back to the session
(run-spec/turn/review.sh, run-spec/turn/side-turn.sh): --review-tool and
--review-model, --verify-tool and --verify-model.
"""

import json
import re

from ...conftest import run
from ..run_spec_results import CODEX_USAGE, emits
from ..run_spec_status_files import with_status

REVIEW_MARKER = "Read this spec's own description"
VERIFY_MARKER = "A review of this spec's branch reported the defects below"
FIX_MARKER = "A review of what you changed found"
WENT_BACK = "the defect(s) went back to the implement session to be fixed"

IMPLEMENT_SESSION = "ee80227f-510c-45e9-bfbf-c5124f7761c0"
TWO_DEFECTS = "review: 2 defect(s) found\n1. The first is real\n2. The second is not"


def _stamped(err):
    return [m.group(1) for m in re.finditer(r"^aide-run-spec \d\d:\d\d:\d\d \+\d+s (.+)$", err, re.M)]


def _result(session_id, text, cost=0.5):
    return {
        "type": "result", "subtype": "success", "is_error": False,
        "session_id": session_id, "total_cost_usd": cost, "num_turns": 1,
        "terminal_reason": "completed", "result": text,
    }


def _claude(fake_claude, review_reply, verify_reply=None, verify_body=None, keep_in=None):
    """A claude that implements, reviews with `review_reply`, verifies with
    `verify_reply` (or runs `verify_body`), keeps the fix prompt it is
    given, and fixes."""
    def reply(session, text):
        return f"echo '{json.dumps(_result(session, text))}'"
    verify = verify_body or reply("verify-session", verify_reply or "")
    return fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{VERIFY_MARKER}\"; then\n  {verify}\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n  {reply('review-session', review_reply)}\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{FIX_MARKER}\"; then\n"
        f"  printf '%s' \"$prompt\" > '{keep_in}/fix-prompt.txt'\n"
        f"  {reply(IMPLEMENT_SESSION, 'fixed')}\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  {reply(IMPLEMENT_SESSION, 'done')}\n"
        "fi\n"
    )


def _codex_says(text):
    return "\n".join(json.dumps(e) for e in [
        {"type": "thread.started", "thread_id": "codex-review-thread"},
        {"type": "turn.started"},
        {"type": "item.completed", "item": {"id": "item_0", "item_type": "agent_message", "text": text}},
        {"type": "turn.completed", "usage": CODEX_USAGE},
    ])


CODEX_AT_CAPACITY = "\n".join(json.dumps(e) for e in [
    {"type": "thread.started", "thread_id": "codex-review-thread"},
    {"type": "turn.started"},
    {"type": "error", "message": "Selected model is at capacity. Please try a different model."},
    {"type": "turn.failed", "error": {"message": "Selected model is at capacity. Please try a different model."}},
])


def test_the_verification_drops_a_defect_and_only_the_kept_one_goes_back_renumbered(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    claude = _claude(fake_claude, TWO_DEFECTS, "keep 2\ndrop 1. The guard is already at x.ts:10", keep_in=tmp_path)
    rc, out, _, err = run(runner, workspace, claude, command="implement", model="claude-sonnet-4",
                          verify_model="claude-opus-4", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert out["sessionId"] == IMPLEMENT_SESSION, out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 4, calls
    assert "--model claude-opus-4" in calls[2] and "--resume" not in calls[2], calls[2]
    stages = _stamped(err)
    assert "the verification dropped review: 1. The first is real — The guard is already at x.ts:10" in stages, stages
    assert WENT_BACK in stages, stages
    fix_prompt = (tmp_path / "fix-prompt.txt").read_text()
    assert "1. The second is not" in fix_prompt
    assert "The first is real" not in fix_prompt


def test_a_verification_that_drops_every_defect_sends_nothing_back(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    claude = _claude(fake_claude, TWO_DEFECTS, "drop 1. not reachable\ndrop 2. the code handles it")
    rc, out, _, err = run(runner, workspace, claude, command="implement", verify_model="claude-opus-4", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 3
    stages = _stamped(err)
    assert "the verification dropped every defect — nothing goes back to the session" in stages, stages
    assert WENT_BACK not in stages, stages


def test_a_verification_that_does_not_complete_sends_every_defect_back(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    claude = _claude(fake_claude, TWO_DEFECTS, verify_body="exit 3", keep_in=tmp_path)
    rc, out, _, err = run(runner, workspace, claude, command="implement", verify_model="claude-opus-4", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert WENT_BACK in _stamped(err)
    fix_prompt = (tmp_path / "fix-prompt.txt").read_text()
    assert "1. The first is real" in fix_prompt and "2. The second is not" in fix_prompt


def test_a_review_on_codex_beside_a_claude_step_runs_read_only_and_the_fix_resumes_claude(
    runner, workspace, fake_claude, fake_codex
):
    with_status(workspace, ["create", "analyze"])
    claude = _claude(fake_claude, "review: no defects found")
    codex = fake_codex(emits(_codex_says("review: 1 defect(s) found\n1. Something is off")))
    rc, out, _, err = run(runner, workspace, claude, codex=codex, command="implement",
                          review_tool="codex", review_model="gpt-6.1-sol", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert out["sessionId"] == IMPLEMENT_SESSION, out
    (review,) = fake_codex.calls.read_text().splitlines()
    assert review.startswith("exec --json --sandbox read-only --model gpt-6.1-sol"), review
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 2, calls
    assert f"--resume {IMPLEMENT_SESSION}" in calls[1], calls[1]
    assert "review: 1. Something is off" in _stamped(err)


def test_a_codex_review_at_capacity_falls_back_to_the_steps_own_model_and_leaves_no_limit(
    runner, workspace, fake_claude, fake_codex
):
    with_status(workspace, ["create", "analyze"])
    claude = _claude(fake_claude, "review: no defects found")
    codex = fake_codex(emits(CODEX_AT_CAPACITY) + "; exit 1")
    rc, out, _, err = run(runner, workspace, claude, codex=codex, command="implement",
                          review_tool="codex", review_model="gpt-6.1-sol", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert out.get("providerLimit") is None, out
    stages = _stamped(err)
    assert any(s.startswith("error: the review on codex did not complete (model-at-capacity)") for s in stages), stages
    assert "the review found no defects" in stages, stages
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 2 and "--resume" not in calls[1], calls


def test_a_review_tool_that_is_neither_the_steps_nor_codex_is_refused(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    rc, out, _ = run(runner, workspace, fake_claude("exit 0"), command="implement", review_tool="opencode")
    assert rc != 0
    assert "--review-tool" in json.dumps(out), out
