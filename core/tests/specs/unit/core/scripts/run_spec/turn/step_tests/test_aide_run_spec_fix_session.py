"""The session chosen when an implement's own test run is red."""

import json
import shlex

from ....conftest import run
from ...run_spec_results import (
    CODEX_STREAM_OK,
    CODEX_THREAD_ID,
    OPENCODE_SESSION_ID,
    OPENCODE_STREAM_OK,
    emits,
    init_event,
)
from ...run_spec_status_files import with_status

MAIN_SESSION = "ee80227f-510c-45e9-bfbf-c5124f7761c0"
FRESH_SESSION = "fresh-fix-session"
MODEL = "claude-opus-5-5"


def _project_with_red_test(workspace, target="fixed.txt"):
    manifest = workspace["project"] / ".aide" / "project.yaml"
    manifest.write_text(manifest.read_text().replace("AIDE_TEST_CMD: true", f"AIDE_TEST_CMD: test -f {target}"))


def _call(total):
    return {
        "type": "assistant",
        "parent_tool_use_id": None,
        "message": {
            "id": f"msg-{total}",
            "usage": {
                "input_tokens": 2,
                "cache_creation_input_tokens": total // 4,
                "cache_read_input_tokens": total - 2 - total // 4,
                "output_tokens": 10,
            },
            "content": [{"type": "text", "text": "working"}],
        },
    }


def _result(session, cost, total, window=1_000_000):
    return {
        "type": "result",
        "subtype": "success",
        "is_error": False,
        "session_id": session,
        "total_cost_usd": cost,
        "num_turns": 1,
        "terminal_reason": "completed",
        "result": "done",
        "modelUsage": {
            MODEL: {
                "inputTokens": 2,
                "outputTokens": 10,
                "cacheReadInputTokens": total - 2 - total // 4,
                "cacheCreationInputTokens": total // 4,
                "contextWindow": window,
            }
        },
    }


def _echo(*events):
    return "".join(f"echo {shlex.quote(json.dumps(event))}\n" for event in events)


def _claude_fix(
    fake_claude, tmp_path, main_total, fresh_total=950_000, two_rounds=False,
    fix_session=FRESH_SESSION,
):
    prompt_log = tmp_path / "fix-prompts.txt"
    second_fix = (
        "if [ -f fixed-once.txt ]; then printf 'fixed\\n' > fixed.txt; "
        "else printf 'once\\n' > fixed-once.txt; fi\n"
        if two_rounds
        else "printf 'fixed\\n' > fixed.txt\n"
    )
    body = (
        'prompt="$(cat)"\n'
        f"printf '%s\\n---PROMPT---\\n' \"$prompt\" >> {shlex.quote(str(prompt_log))}\n"
        "if printf '%s' \"$prompt\" | grep -q 'test suite is red'; then\n"
        "  git diff --quiet && git diff --cached --quiet && "
        "git ls-files --error-unmatch implemented.txt >/dev/null || exit 1\n"
        f"  {second_fix}"
        "  git add -A && git commit -q -m 'the fix'\n"
        + _echo(init_event(MODEL), _call(fresh_total), _result(fix_session, 0.3, fresh_total))
        + "else\n"
        "  printf 'work\\n' > implemented.txt\n"
        + _echo(init_event(MODEL), _call(main_total), _result(MAIN_SESSION, 0.1, main_total))
        + "fi\n"
    )
    return fake_claude(body), prompt_log


def test_a_full_claude_session_hands_red_tests_to_a_fresh_session_ac_1_ac_3_ac_4_ac_6_ac_7(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _project_with_red_test(workspace)
    claude, prompt_log = _claude_fix(fake_claude, tmp_path, 850_000)

    rc, out, _, log = run(
        runner, workspace, claude, command="implement", model=MODEL, effort="high", return_stderr=True
    )

    assert rc == 0 and out["terminalReason"] == "completed", out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 2, calls
    assert "--resume" not in calls[1] and "--session-id" not in calls[1], calls[1]
    assert "--model claude-opus-5-5" in calls[1] and "--permission-mode acceptEdits" in calls[1], calls[1]
    assert "--add-dir" in calls[1], calls[1]
    prompt = prompt_log.read_text()
    assert "1-description.md" in prompt and "3-solution.md" in prompt, prompt
    assert "git diff " in prompt and "git status --porcelain" in prompt, prompt
    assert "The change is committed on this branch" in prompt and "Do not commit" in prompt, prompt
    assert "Do not run the whole suite" in prompt, prompt
    assert "fresh session" in log and "85 %" in log, log
    assert out["sessionId"] == MAIN_SESSION, out
    assert out["context"]["fullest"] == 850_000, out
    assert abs(out["costUsd"] - 0.4) < 1e-6, out


def test_a_session_below_the_default_is_resumed_ac_2_ac_3_ac_7(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _project_with_red_test(workspace)
    claude, _ = _claude_fix(fake_claude, tmp_path, 846_000, fix_session=MAIN_SESSION)

    rc, out, _, log = run(runner, workspace, claude, command="implement", return_stderr=True)

    assert rc == 0, out
    assert "--resume" in fake_claude.calls.read_text().splitlines()[1]
    assert "the step's session" in log and "84.6 %" in log, log

    workspace["project"].joinpath("fixed.txt").unlink(missing_ok=True)


def test_the_threshold_override_starts_a_fresh_session_ac_3(
    runner, workspace, fake_claude, tmp_path, monkeypatch
):
    with_status(workspace, ["create", "analyze"])
    _project_with_red_test(workspace)
    monkeypatch.setenv("AIDE_TEST_FIX_FRESH_PERCENT", "50")
    claude, _ = _claude_fix(fake_claude, tmp_path, 600_000)

    rc, out, _ = run(runner, workspace, claude, command="implement")

    assert rc == 0, out
    fresh_call = fake_claude.calls.read_text().splitlines()[1]
    assert "--resume" not in fresh_call
    assert f"--model {MODEL}" in fresh_call


def test_later_rounds_resume_the_fresh_session_ac_5_ac_7(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _project_with_red_test(workspace)
    claude, _ = _claude_fix(fake_claude, tmp_path, 900_000, two_rounds=True)

    rc, out, _, log = run(runner, workspace, claude, command="implement", return_stderr=True)

    assert rc == 0, out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 3, calls
    assert "--resume fresh-fix-session" in calls[2], calls[2]
    assert "fresh session, which took over at 90 %" in log, log


def test_opencode_without_a_context_figure_resumes_its_step_session_ac_2_ac_8(
    runner, workspace, fake_opencode
):
    with_status(workspace, ["create", "analyze"])
    _project_with_red_test(workspace)
    opencode = fake_opencode(
        f"if [ \"$(wc -l < '{fake_opencode.calls}')\" -eq 1 ]; then "
        "printf 'work\\n' > implemented.txt; else printf 'fixed\\n' > fixed.txt; fi; "
        "git add -A; git commit -q -m 'the turn'\n"
        + emits(OPENCODE_STREAM_OK).replace("cat > /dev/null; ", "")
    )

    rc, out, _, log = run(
        runner, workspace, tool="opencode", opencode=opencode, command="implement", return_stderr=True
    )

    assert rc == 0, out
    calls = fake_opencode.calls.read_text().splitlines()
    assert len(calls) == 2 and f"--session {OPENCODE_SESSION_ID}" in calls[1], calls
    assert "states no context figure" in log, log


def test_a_full_codex_thread_starts_fresh_and_later_resumes_that_thread_ac_8(
    runner, workspace, fake_codex, tmp_path, monkeypatch
):
    with_status(workspace, ["create", "analyze"])
    _project_with_red_test(workspace)
    home = tmp_path / "codex-home"
    monkeypatch.setenv("CODEX_HOME", str(home))
    session_dir = home / "sessions" / "2026" / "11" / "16"
    session_dir.mkdir(parents=True)
    session_file = session_dir / f"rollout-2026-11-16T09-00-00-{CODEX_THREAD_ID}.jsonl"
    count = {
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "info": {
                "last_token_usage": {"input_tokens": 240_000},
                "model_context_window": 258_400,
            },
        },
    }
    fresh_stream = CODEX_STREAM_OK.replace(CODEX_THREAD_ID, FRESH_SESSION)
    body = (
        'prompt="$(cat)"\n'
        "if printf '%s' \"$prompt\" | grep -q 'test suite is red'; then\n"
        "  if [ -f fixed-once.txt ]; then printf 'fixed\\n' > fixed.txt; "
        "else printf 'once\\n' > fixed-once.txt; fi\n"
        "  git add -A && git commit -q -m 'the fix'\n"
        f"  {emits(fresh_stream).replace('cat > /dev/null; ', '')}\n"
        "else\n"
        "  printf 'work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  mkdir -p {shlex.quote(str(session_dir))}\n"
        f"  printf '%s\\n' {shlex.quote(json.dumps({'type': 'event_msg', 'payload': {'type': 'task_started'}}))} "
        f"{shlex.quote(json.dumps(count))} > {shlex.quote(str(session_file))}\n"
        f"  {emits(CODEX_STREAM_OK).replace('cat > /dev/null; ', '')}\n"
        "fi\n"
    )
    codex = fake_codex(body)

    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, command="implement")

    assert rc == 0, out
    calls = fake_codex.calls.read_text().splitlines()
    assert calls[1].startswith("exec --json") and "exec resume" not in calls[1], calls[1]
    assert "--sandbox" in calls[1], calls[1]
    assert calls[2].startswith("exec resume --json"), calls[2]
    assert calls[2].endswith(f"{FRESH_SESSION} -"), calls[2]
    assert '-c sandbox_mode="workspace-write"' in calls[2], calls[2]
    assert out["sessionId"] == CODEX_THREAD_ID, out
