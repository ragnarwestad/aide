"""How full the context window got in a step: the result line's `context`
key — the most tokens the model was sent in one call of the step's main
session, the same before the runner's own follow-up turns, the window the
tool states, and the two shares of it.

Claude's calls are the `assistant` events of the transcript (a subagent's
carry a `parent_tool_use_id`); Codex's are the `token_count` events of its
own session file for the thread, after the file's last `task_started`.
"""

import json
import shlex

from ...conftest import run
from ..run_spec_results import CODEX_STREAM_OK, CODEX_THREAD_ID, RESULT_OK, emits, init_event, stream_body
from ..run_spec_status_files import with_status

REVIEW_MARKER = "Read this spec's own description"
FIX_MARKER = "A review of what you changed found"

IMPLEMENT_SESSION = "ee80227f-510c-45e9-bfbf-c5124f7761c0"
REVIEW_SESSION = "review-throwaway-session-id"
REVIEW_THREAD_ID = "0199f4c2-6d1a-7c31-9f0e-2b7a5c8d9999"

MAIN_MODEL = "claude-opus-5-5"
WINDOW = 1_000_000


# --- Claude -------------------------------------------------------------------

_message_ids = iter(range(1, 10_000))


def _call(input_t, creation, read, parent=None):
    """One `assistant` event: a call's `message.usage`, as Claude Code writes it."""
    return {
        "type": "assistant", "parent_tool_use_id": parent,
        "message": {
            "id": f"msg_{next(_message_ids)}",
            "usage": {"input_tokens": input_t, "cache_creation_input_tokens": creation,
                      "cache_read_input_tokens": read, "output_tokens": 50},
            "content": [{"type": "text", "text": "working"}],
        },
    }


def _call_of(total, parent=None):
    """A call of `total` tokens, split the way a real one is: the input
    field alone is almost nothing."""
    return _call(2, total // 4, total - 2 - total // 4, parent=parent)


def _result(session, text="done", window=WINDOW, helper_window=200_000):
    event = {
        "type": "result", "subtype": "success", "is_error": False,
        "session_id": session, "total_cost_usd": 0.1, "num_turns": 1,
        "terminal_reason": "completed", "result": text,
    }
    if window is not None:
        event["modelUsage"] = {
            MAIN_MODEL: {"inputTokens": 10, "outputTokens": 10, "cacheReadInputTokens": 10,
                         "cacheCreationInputTokens": 10, "contextWindow": window},
            "claude-haiku-5-5": {"inputTokens": 1, "outputTokens": 1, "cacheReadInputTokens": 1,
                                 "cacheCreationInputTokens": 1, "contextWindow": helper_window},
        }
    return event


def _echo(events):
    return "".join(f"echo '{json.dumps(e)}'\n" for e in events)


def _turn(session, calls, text="done", window=WINDOW):
    """One whole turn of the stream: init, its calls, the closing result."""
    return _echo([init_event(MAIN_MODEL), *calls, _result(session, text, window)])


def _implementing_claude(fake_claude, own, fix, review):
    """An implement whose own turn, review turn and fix turn make the calls
    given (lists of totals). The review reports a defect, so the fix turn
    runs in the implement session; the review answers in its own."""
    return fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        + _turn(REVIEW_SESSION, [_call_of(t) for t in review], "review: 1 defect(s) found\n1. A defect") +
        f"elif printf '%s' \"$prompt\" | grep -q \"{FIX_MARKER}\"; then\n"
        "  printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n"
        + _turn(IMPLEMENT_SESSION, [_call_of(t) for t in fix]) +
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        + _turn(IMPLEMENT_SESSION, [_call_of(t) for t in own]) +
        "fi\n"
    )


def _implement_claude(runner, workspace, fake_claude, own, fix, review):
    with_status(workspace, ["create", "analyze"])
    claude = _implementing_claude(fake_claude, own, fix, review)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "completed", out
    return out


def test_the_most_tokens_of_one_call_are_the_input_and_both_caches_together(
    runner, workspace, fake_claude
):
    """The 120,000 call is 2 + 29,998 + 90,000: a reader of `input_tokens`
    alone reads 2. The window is the init model's, not the helper model's."""
    calls = [_call(1, 9_999, 30_000), _call(2, 29_998, 90_000), _call(3, 0, 89_997)]
    claude = fake_claude(stream_body(_result("s"), before=[init_event(MAIN_MODEL), *calls]))
    rc, out, _ = run(runner, workspace, claude)
    assert out["context"]["fullest"] == 120_000, out
    assert out["context"]["window"] == 1_000_000, out


def test_a_step_with_no_follow_up_turn_has_the_same_figure_before_its_checks(
    runner, workspace, fake_claude
):
    calls = [_call_of(40_000), _call_of(120_000)]
    claude = fake_claude(stream_body(_result("s"), before=[init_event(MAIN_MODEL), *calls]))
    rc, out, _ = run(runner, workspace, claude)
    assert out["context"]["beforeChecks"] == 120_000 == out["context"]["fullest"], out


def test_the_figure_before_the_checks_leaves_out_the_fix_turn_that_follows(
    runner, workspace, fake_claude
):
    out = _implement_claude(runner, workspace, fake_claude, own=[60_000, 100_000], fix=[150_000], review=[58_000])
    assert out["context"]["beforeChecks"] == 100_000, out
    assert out["context"]["fullest"] == 150_000, out


def test_both_figures_are_a_whole_number_percentage_of_the_window(runner, workspace, fake_claude):
    """31.26 rounds down and 18.5 rounds up."""
    out = _implement_claude(runner, workspace, fake_claude, own=[185_000], fix=[312_600], review=[58_000])
    assert out["context"]["fullestPercent"] == 31, out
    assert out["context"]["beforeChecksPercent"] == 19, out


def test_calls_without_a_result_event_leave_the_window_and_the_shares_out(
    runner, workspace, fake_claude
):
    """A turn killed before it wrote its result still wrote each call as it
    was made: the figures are there, the window is not."""
    claude = fake_claude("cat > /dev/null\n" + _echo([init_event(MAIN_MODEL), _call_of(70_000)]) + "exit 1")
    rc, out, _ = run(runner, workspace, claude)
    assert out["context"] == {"fullest": 70_000, "beforeChecks": 70_000}, out


def test_a_result_naming_a_window_but_no_call_leaves_context_out(runner, workspace, fake_claude):
    claude = fake_claude(stream_body(_result("s"), before=[init_event(MAIN_MODEL)]))
    rc, out, _ = run(runner, workspace, claude)
    assert "context" not in out, out


def test_a_step_with_no_call_writes_the_result_line_it_wrote_before(runner, workspace, fake_claude):
    """The result without calls is the old line, every existing field in place."""
    claude = fake_claude(stream_body(RESULT_OK))
    rc, out, _ = run(runner, workspace, claude)
    assert out["terminalReason"] == "completed", out
    assert "context" not in out, out


def test_a_subagents_calls_are_not_the_main_sessions(runner, workspace, fake_claude):
    calls = [_call_of(80_000), _call_of(500_000, parent="toolu_01subagent"), _call_of(100_000)]
    claude = fake_claude(stream_body(_result("s"), before=[init_event(MAIN_MODEL), *calls]))
    rc, out, _ = run(runner, workspace, claude)
    assert out["context"]["fullest"] == 100_000, out


def test_the_reviews_own_session_is_not_the_main_session(runner, workspace, fake_claude):
    out = _implement_claude(runner, workspace, fake_claude, own=[100_000], fix=[150_000], review=[400_000])
    assert out["context"]["fullest"] == 150_000, out
    assert out["context"]["beforeChecks"] == 100_000, out


# --- Codex --------------------------------------------------------------------

CODEX_WINDOW = 258_400
_TASK_STARTED = {"type": "event_msg", "payload": {"type": "task_started"}}


def _count(input_t, cached=0, window=CODEX_WINDOW):
    """One `token_count` for the call just made, as Codex's session file holds it."""
    info = {"last_token_usage": {"input_tokens": input_t, "cached_input_tokens": cached,
                                 "output_tokens": 10, "total_tokens": input_t + 10}}
    if window is not None:
        info["model_context_window"] = window
    return {"type": "event_msg", "payload": {"type": "token_count", "info": info, "rate_limits": None}}


# A count that carries only the rate limits, as one does between calls.
_LIMITS_ONLY = {"type": "event_msg", "payload": {"type": "token_count", "info": None, "rate_limits": {}}}


def _codex_stream(text, thread):
    return "\n".join(json.dumps(e) for e in [
        {"type": "thread.started", "thread_id": thread},
        {"type": "turn.started"},
        {"type": "item.completed", "item": {"id": "item_0", "item_type": "agent_message", "text": text}},
        {"type": "turn.completed", "usage": {"input_tokens": 1, "cached_input_tokens": 0,
                                             "output_tokens": 1, "reasoning_output_tokens": 0}},
    ])


def _writing_task(home, thread, events, stream):
    """Bash that appends one task to the thread's session file, then prints
    the turn's stream — a resumed turn appends to the same file."""
    day = home / "sessions" / "2026" / "09" / "17"
    path = day / f"rollout-2026-09-17T09-00-00-{thread}.jsonl"
    lines = " ".join(shlex.quote(json.dumps(e)) for e in [_TASK_STARTED, *events])
    return (f"mkdir -p {shlex.quote(str(day))} && printf '%s\\n' {lines} >> {shlex.quote(str(path))}\n"
            + emits(stream).replace("cat > /dev/null; ", "") + "\n")


def _implementing_codex(fake_codex, home, own, fix, review):
    """An implement whose own turn and fix turn append to the implement
    thread's file, and whose review writes a file of its own thread."""
    return fake_codex(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        + _writing_task(home, REVIEW_THREAD_ID, review,
                        _codex_stream("review: 1 defect(s) found\n1. A defect", REVIEW_THREAD_ID)) +
        f"elif printf '%s' \"$prompt\" | grep -q \"{FIX_MARKER}\"; then\n"
        "  printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n"
        + _writing_task(home, CODEX_THREAD_ID, fix, CODEX_STREAM_OK) +
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        + _writing_task(home, CODEX_THREAD_ID, own, CODEX_STREAM_OK) +
        "fi\n"
    )


def test_codex_counts_the_input_once_whether_or_not_it_was_cached(
    runner, workspace, fake_codex, tmp_path, monkeypatch
):
    home = tmp_path / "codex-home"
    monkeypatch.setenv("CODEX_HOME", str(home))
    codex = fake_codex(_writing_task(home, CODEX_THREAD_ID,
                                     [_count(30_000), _LIMITS_ONLY, _count(80_000, cached=70_000)], CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["context"]["fullest"] == 80_000, out


def test_codex_states_its_window_on_the_counts(runner, workspace, fake_codex, tmp_path, monkeypatch):
    home = tmp_path / "codex-home"
    monkeypatch.setenv("CODEX_HOME", str(home))
    codex = fake_codex(_writing_task(home, CODEX_THREAD_ID, [_count(80_000)], CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["context"]["window"] == CODEX_WINDOW, out
    assert out["context"]["fullestPercent"] == 31, out


def test_counts_that_state_no_window_leave_it_and_the_shares_out(
    runner, workspace, fake_codex, tmp_path, monkeypatch
):
    home = tmp_path / "codex-home"
    monkeypatch.setenv("CODEX_HOME", str(home))
    codex = fake_codex(_writing_task(home, CODEX_THREAD_ID, [_count(80_000, window=None)], CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["context"] == {"fullest": 80_000, "beforeChecks": 80_000}, out


def test_a_codex_thread_with_no_session_file_leaves_context_out(
    runner, workspace, fake_codex, tmp_path, monkeypatch
):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "empty-codex-home"))
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["terminalReason"] == "completed", out
    assert "context" not in out, out


def test_codex_reads_each_turn_after_its_own_task_started(
    runner, workspace, fake_codex, tmp_path, monkeypatch
):
    with_status(workspace, ["create", "analyze"])
    home = tmp_path / "codex-home"
    monkeypatch.setenv("CODEX_HOME", str(home))
    codex = _implementing_codex(fake_codex, home, own=[_count(40_000), _count(60_000)],
                                fix=[_count(90_000)], review=[_count(240_000)])
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, command="implement")
    assert out["terminalReason"] == "completed", out
    assert out["context"]["beforeChecks"] == 60_000, out
    assert out["context"]["fullest"] == 90_000, out


def test_codex_leaves_out_the_tasks_a_resumed_thread_ran_before_the_step(
    runner, workspace, fake_codex, tmp_path, monkeypatch
):
    """The implement resumes the analysis's thread, whose file already holds
    the analysis's own, fuller task."""
    home = tmp_path / "codex-home"
    monkeypatch.setenv("CODEX_HOME", str(home))
    (home / "sessions" / "2026" / "09" / "17").mkdir(parents=True)
    path = home / "sessions" / "2026" / "09" / "17" / f"rollout-2026-09-17T09-00-00-{CODEX_THREAD_ID}.jsonl"
    path.write_text("".join(json.dumps(e) + "\n" for e in [_TASK_STARTED, _count(200_000)]))
    codex = fake_codex(_writing_task(home, CODEX_THREAD_ID, [_count(50_000)], CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["context"]["fullest"] == 50_000, out


def test_codexs_review_thread_is_not_the_main_session(runner, workspace, fake_codex, tmp_path, monkeypatch):
    with_status(workspace, ["create", "analyze"])
    home = tmp_path / "codex-home"
    monkeypatch.setenv("CODEX_HOME", str(home))
    codex = _implementing_codex(fake_codex, home, own=[_count(60_000)], fix=[_count(90_000)],
                                review=[_count(250_000)])
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, command="implement")
    assert out["context"]["fullest"] == 90_000, out
