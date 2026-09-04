"""aide-run-spec: the live stream a run keeps while it works.

One part of a suite that was one 7348-line file until 2026-09-04;
the tests are unchanged and keep their names. What they share sits
in conftest.py beside them.
"""

import json
import os
import pathlib
import re
import shlex
import shutil
import signal
import subprocess
import time
import pytest
from .conftest import run
from .run_spec_results import RESULT_BUDGET, RESULT_OK, STREAM_NOISE, stream_body

def test_the_kept_stream_survives_the_work_dir_cleanup(runner, workspace, fake_claude, tmp_path):
    stream = tmp_path / "job.stream.jsonl"
    claude = fake_claude(stream_body(RESULT_OK))
    rc, out, _ = run(runner, workspace, claude, stream_file=str(stream))
    assert rc == 0, out
    assert stream.exists(), "the transcript must outlive the run's temporary directory"
    lines = [l for l in stream.read_text().splitlines() if l.strip()]
    assert len(lines) == 3
    assert json.loads(lines[0])["type"] == "system"
    assert json.loads(lines[-1])["type"] == "result"

def test_the_terminal_result_is_selected_by_type_not_by_position(runner, workspace, fake_claude, tmp_path):
    """A trailing event after the result would silently corrupt cost,
    session and terminal reason for every run if the parser just took
    the last line."""
    stream = tmp_path / "job.stream.jsonl"
    trailing = [{"type": "system", "subtype": "shutdown"}, {"type": "rate_limit_event"}]
    claude = fake_claude(stream_body(RESULT_OK, after=trailing))
    rc, out, _ = run(runner, workspace, claude, stream_file=str(stream))
    assert rc == 0, out
    assert out["sessionId"] == RESULT_OK["session_id"]
    assert out["costUsd"] == pytest.approx(0.5357)
    assert out["costMeasured"] is True
    assert out["terminalReason"] == "completed"

def test_a_rejected_provider_limit_overrides_a_contradictory_success(runner, workspace, fake_claude):
    limit = {
        "type": "rate_limit_event",
        "rate_limit_info": {
            "status": "rejected",
            "rateLimitType": "seven_day",
            "resetsAt": 1787587200,
        },
    }
    result = {
        **RESULT_OK,
        "is_error": True,
        "terminal_reason": "api_error",
        "api_error_status": 429,
    }
    claude = fake_claude(stream_body(result, before=[limit], exit_code=1))
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert out["ok"] is False
    assert out["terminalReason"] == "provider-limit"
    assert "seven day" in out["error"]
    assert "2026-08-24" in out["error"]

def test_credit_carrying_a_spent_window_is_not_a_stop(runner, workspace, fake_claude):
    """`status: rejected` says the subscription window is spent, not
    that the call was refused. The event below is verbatim from the
    07:26 run on 2026-08-25: purchased credit carried every call, the
    step finished its work, and the run was reported stopped anyway."""
    limit = {
        "type": "rate_limit_event",
        "rate_limit_info": {
            "status": "rejected",
            "rateLimitType": "seven_day",
            "resetsAt": 1787803200,
            "overageStatus": "allowed",
            "overageResetsAt": 1788220800,
            "isUsingOverage": True,
            "overageInUse": True,
        },
    }
    claude = fake_claude(stream_body(RESULT_OK, before=[limit]))
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"

def test_is_error_prevents_a_success_subtype_from_completing(runner, workspace, fake_claude):
    result = {**RESULT_OK, "is_error": True, "errors": ["provider request failed"]}
    claude = fake_claude(stream_body(result))
    _, out, _ = run(runner, workspace, claude)
    assert out["ok"] is False
    assert out["terminalReason"] == "cli-error"
    assert "provider request failed" in out["error"]

def test_nonzero_exit_prevents_a_success_subtype_from_completing(runner, workspace, fake_claude):
    claude = fake_claude(stream_body(RESULT_OK, exit_code=1))
    _, out, _ = run(runner, workspace, claude)
    assert out["ok"] is False
    assert out["terminalReason"] == "cli-error"
    assert "exit 1" in out["error"]

def test_exit_zero_and_a_non_error_success_still_complete(runner, workspace, fake_claude):
    claude = fake_claude(stream_body(RESULT_OK, exit_code=0))
    _, out, _ = run(runner, workspace, claude)
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"

def test_a_truncated_last_line_does_not_lose_the_result(runner, workspace, fake_claude, tmp_path):
    """A killed run leaves half a line behind. Refusing the whole file
    over it would throw away a result event that arrived intact."""
    stream = tmp_path / "job.stream.jsonl"
    # The half-line goes BEFORE the exit, or it is never written at all.
    claude = fake_claude(
        stream_body(RESULT_OK, exit_code=0).replace(
            "exit 0", 'printf \'{"type":"assist\'\nexit 0'
        )
    )
    rc, out, _ = run(runner, workspace, claude, stream_file=str(stream))
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert out["costUsd"] == pytest.approx(0.5357)

def test_the_stream_is_kept_when_the_budget_stops_the_run(runner, workspace, fake_claude, tmp_path):
    stream = tmp_path / "job.stream.jsonl"
    claude = fake_claude(stream_body(RESULT_BUDGET, exit_code=1))
    rc, out, _ = run(runner, workspace, claude, stream_file=str(stream))
    assert rc == 0, out
    assert out["terminalReason"] == "budget"
    assert stream.exists()
    assert '"error_max_budget_usd"' in stream.read_text()

def test_the_stream_is_kept_when_the_deadline_kills_the_run(runner, workspace, fake_claude, tmp_path):
    """The longest runs are exactly the ones whose transcript is worth
    keeping, and they are the ones that get killed."""
    stream = tmp_path / "job.stream.jsonl"
    claude = fake_claude(
        "cat > /dev/null\n"
        f"echo '{json.dumps(STREAM_NOISE[0])}'\n"
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    rc, out, _ = run(runner, workspace, claude, stream_file=str(stream),
                     timeout_sec="8", kill_grace_sec="2")
    assert out["terminalReason"] == "timeout"
    assert stream.exists(), "a killed run's transcript must survive too"
    assert '"init"' in stream.read_text()

def test_the_stream_is_readable_while_the_run_is_still_going(
    runner, workspace, fake_claude, tmp_path
):
    """The dashboard's "what it has been doing" panel reads this file to
    show a RUNNING job. Copying it out of $work_dir at exit filled the
    panel the instant the job stopped needing it: five minutes into a
    live analyze, the panel was empty and the run looked stuck."""
    stream = tmp_path / "job.stream.jsonl"
    ready, go = tmp_path / "ready", tmp_path / "go"
    # Emit one event, announce it, and hold until the test releases us.
    claude = fake_claude(
        "cat > /dev/null\n"
        f"echo '{json.dumps(STREAM_NOISE[0])}'\n"
        f"touch {ready}\n"
        f"while [ ! -f {go} ]; do sleep 0.05; done\n"
        f"echo '{json.dumps(RESULT_OK)}'\n"
        "exit 0"
    )
    proc = subprocess.Popen(
        [
            str(runner),
            "--project-dir", str(workspace["project"]),
            "--command", "analyze",
            "--spec", workspace["folder"],
            "--budget-usd", "3",
            "--timeout-sec", "30",
            "--permission-mode", "acceptEdits",
            "--result-file", str(workspace["project"].parent / "result.json"),
            "--stream-file", str(stream),
            "--worktree-base", str(workspace["wtbase"]),
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, env={**os.environ, "AIDE_CLAUDE_BIN": str(claude)},
    )
    try:
        deadline = time.time() + 30
        while not ready.exists() and time.time() < deadline:
            if proc.poll() is not None:
                raise AssertionError(f"the run ended early: {proc.communicate()}")
            time.sleep(0.05)
        assert ready.exists(), "the fake claude never started"
        # THE POINT: mid-run, with claude still holding, the events it
        # has already emitted must be on disk where the dashboard looks.
        assert stream.exists(), "the stream file must exist while the run is going"
        assert '"init"' in stream.read_text(), "already-emitted events must be readable mid-run"
    finally:
        go.touch()
        proc.wait(timeout=30)
    # And the run still finishes normally, with the result parsed out of
    # the same file.
    out = json.loads(proc.stdout.read().strip().splitlines()[-1])
    assert out["terminalReason"] == "completed"
    assert json.loads(stream.read_text().splitlines()[-1])["type"] == "result"

def test_the_stream_is_kept_when_the_cli_produces_no_result(runner, workspace, fake_claude, tmp_path):
    stream = tmp_path / "job.stream.jsonl"
    claude = fake_claude("cat > /dev/null\necho 'not json at all'\nexit 1")
    rc, out, _ = run(runner, workspace, claude, stream_file=str(stream))
    assert out["terminalReason"] == "cli-error"
    assert stream.exists()
    assert "not json at all" in stream.read_text()

def test_without_the_flag_nothing_is_kept_and_nothing_changes(runner, workspace, fake_claude, tmp_path):
    """Opt-in means opt-in: a caller that does not ask still gets
    today's behaviour, temporary directory discarded and all."""
    stream = tmp_path / "job.stream.jsonl"
    claude = fake_claude(stream_body(RESULT_OK))
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert out["sessionId"] == RESULT_OK["session_id"]
    assert not stream.exists()
    assert not list(tmp_path.glob("**/*.stream.jsonl"))

def test_an_unwritable_stream_path_never_fails_a_finished_run(runner, workspace, fake_claude, tmp_path):
    """Keeping a transcript is a convenience. A run whose work
    succeeded must not be reported as failed because a directory was
    missing."""
    claude = fake_claude(stream_body(RESULT_OK))
    rc, out, _ = run(runner, workspace, claude, stream_file=str(tmp_path / "nope" / "x.jsonl"))
    assert rc == 0, out
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"

def test_the_session_id_we_supplied_is_the_one_the_run_reports(runner, workspace, fake_claude):
    """The queue generates the id BEFORE spawning, so it can watch the
    session while the step runs. That is worth nothing unless the id it
    passed is the id the run actually used."""
    chosen = "11111111-2222-4333-8444-555555555555"
    echoed = {**RESULT_OK, "session_id": chosen}
    claude = fake_claude(
        "cat > /dev/null\n"
        f"echo '{json.dumps(echoed)}'"
    )
    rc, out, _ = run(runner, workspace, claude, session_id=chosen)
    assert rc == 0, out
    assert f"--session-id {chosen}" in fake_claude.calls.read_text()
    assert out["sessionId"] == chosen
