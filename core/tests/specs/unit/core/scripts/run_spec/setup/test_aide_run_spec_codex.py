"""The second tool: what Codex is told on its command line, what it
records, how a permission mode reaches it, and what it refuses.

Split out of test_aide_run_spec_tools.py 2026-09-04; the tests are
unchanged and keep their names.
"""

import json
import pytest
import pytest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from ...conftest import READ_SPECS, STOP_DEADLINE_SEC, git, run
from ..run_spec_results import (
    CODEX_STREAM_AT_CAPACITY, CODEX_STREAM_AT_CAPACITY_NO_TURN, CODEX_STREAM_FAILED, CODEX_STREAM_OK,
    CODEX_STREAM_RECOVERED, CODEX_STREAM_USAGE_LIMIT, CODEX_THREAD_ID, CODEX_USAGE, RESULT_OK, emits,
)


def test_a_codex_run_records_tool_and_tokens_but_no_cost(runner, workspace, fake_codex):
    """Codex reports tokens and NO dollar figure anywhere in
    its output, so `costUsd` is absent — not zero, and not a stand-in for
    a cost that was never there to measure."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert rc == 0, out
    assert out["tool"] == "codex"
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"
    assert "costUsd" not in out, "a Codex step has no dollar figure to report"
    assert out["costMeasured"] is False
    # Codex's own thread id, read back the way Claude's session id is.
    assert "modelId" not in out, "AC-3: no second id beside the one the tool was given"
    assert out["sessionId"] == CODEX_THREAD_ID
    tokens = out["tokens"]
    u = CODEX_USAGE
    assert tokens["input"] == u["input_tokens"]
    # Codex bills reasoning tokens as output; both halves count.
    assert tokens["output"] == u["output_tokens"] + u["reasoning_output_tokens"]
    assert tokens["cacheRead"] == u["cached_input_tokens"]
    # Codex exposes no separate cache-WRITE count at all.
    assert tokens["cacheCreation"] == 0
    assert tokens["total"] == (
        u["input_tokens"] + u["output_tokens"] + u["reasoning_output_tokens"] + u["cached_input_tokens"]
    )

def test_a_claude_run_still_says_which_tool_ran_it(runner, workspace, fake_claude):
    """The field is on every result, not only Codex's: the dashboard
    reads it to pick a transcript parser, and "absent means claude" is a
    rule two readers would have to agree on separately."""
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert out["tool"] == "claude"
    # And the dollar figure is exactly what it always was.
    assert out["costUsd"] == pytest.approx(0.5357)

def test_bypass_permissions_becomes_codex_s_one_bypass_flag(runner, workspace, fake_codex):
    """Codex's safety is TWO axes where Claude's is one
    string, and its single all-off flag replaces both — passing
    `--sandbox` beside it would be saying two things at once."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex,
                     permission_mode="bypassPermissions")
    assert rc == 0, out
    argv = fake_codex.calls.read_text()
    assert "--dangerously-bypass-approvals-and-sandbox" in argv
    assert "--sandbox" not in argv

def test_accept_edits_becomes_a_writable_workspace(runner, workspace, fake_codex):
    """`codex exec` is non-interactive and has no
    `--ask-for-approval` flag at all (verified against codex-cli 0.147.0
    — that flag is the interactive command's); the sandbox mode is the
    whole of what it takes."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex,
                     permission_mode="acceptEdits")
    assert rc == 0, out
    argv = fake_codex.calls.read_text().split()
    assert "--sandbox" in argv
    assert argv[argv.index("--sandbox") + 1] == "workspace-write"
    assert "--ask-for-approval" not in argv

def test_plan_mode_becomes_a_read_only_sandbox(runner, workspace, fake_codex):
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, permission_mode="plan")
    assert rc == 0, out
    argv = fake_codex.calls.read_text().split()
    assert argv[argv.index("--sandbox") + 1] == "read-only"

def test_an_unrecognised_permission_mode_refuses_before_codex_starts(runner, workspace, fake_codex):
    """The same "typed out or the run does not start"
    discipline `--permission-mode` already has for Claude: a mode with no
    entry in the table is refused rather than guessed at, because
    guessing wrong means a step running in the wrong sandbox."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex,
                     permission_mode="acceptEdit")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "acceptEdit" in out["error"]
    assert not fake_codex.calls.exists(), "the run must refuse before spawning anything"

def test_an_unknown_tool_is_refused(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, tool="gemini")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "gemini" in out["error"]

def test_an_unknown_effort_is_refused(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, effort="turbo")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "turbo" in out["error"]
    assert not fake_claude.calls.exists(), "the run must refuse before spawning anything"

def test_effort_lands_in_the_claude_argv(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, effort="high")
    assert rc == 0, out
    argv = fake_claude.calls.read_text().split()
    assert argv[argv.index("--effort") + 1] == "high"

def test_no_effort_flag_at_all_when_none_is_chosen(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    argv = fake_claude.calls.read_text().split()
    assert "--effort" not in argv

def test_effort_is_dropped_silently_for_a_codex_run(runner, workspace, fake_codex):
    """Codex has no `--effort` equivalent, and a chosen effort for
    a Codex-run phase is accepted and dropped, the same "ignored, not
    refused" treatment the script already gives Codex's other
    Claude-only knobs."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, effort="high")
    assert rc == 0, out
    argv = fake_codex.calls.read_text().split()
    assert "--effort" not in argv

def test_a_codex_run_past_its_deadline_is_killed_the_same_way(runner, workspace, fake_codex):
    """The timeout loop operates on a PID and a process
    group, never on a tool — so the only thing worth proving here is that
    a Codex step reaches it, and that a killed Codex step still reports
    no dollar figure (Claude's over-charge rule has nothing to work
    with)."""
    codex = fake_codex(
        "cat > /dev/null\n"
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex,
                     timeout_sec=STOP_DEADLINE_SEC, kill_grace_sec="2")
    assert out["terminalReason"] == "timeout"
    assert out["ok"] is False
    assert out["tool"] == "codex"
    assert "costUsd" not in out
    assert out["costMeasured"] is False
    assert "tokens" not in out

def test_a_failed_codex_turn_is_reported_not_swallowed(runner, workspace, fake_codex):
    codex = fake_codex(emits(CODEX_STREAM_FAILED))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["ok"] is False
    assert out["terminalReason"] == "cli-error"
    assert "refused the turn" in (out["error"] or "")

def _codex_session(home, *rate_limits):
    """Codex's own session file for the thread the fake reports, holding
    one `token_count` event per `rate_limits` — the only place Codex
    states its limits."""
    day = home / "sessions" / "2026" / "09" / "17"
    day.mkdir(parents=True, exist_ok=True)
    events = [{"type": "event_msg", "payload": {"type": "token_count", "rate_limits": r}} for r in rate_limits]
    (day / f"rollout-2026-09-17T09-00-00-{CODEX_THREAD_ID}.jsonl").write_text(
        "".join(json.dumps(e) + "\n" for e in events))


def test_a_codex_turn_stopped_by_a_full_window_is_a_provider_limit(runner, workspace, fake_codex, tmp_path, monkeypatch):
    """`codex exec --json` never names a usage limit; the session file
    Codex keeps for the same thread does. A failed turn with a full
    window there is the account running out, not the CLI failing."""
    home = tmp_path / "codex-home"
    _codex_session(home, {
        "primary": {"used_percent": 100.0, "window_minutes": 300, "resets_at": 1789639800},
        "secondary": {"used_percent": 41.4, "window_minutes": 10080, "resets_at": 1789866000},
        "plan_type": "plus", "rate_limit_reached_type": None})
    monkeypatch.setenv("CODEX_HOME", str(home))
    codex = fake_codex(emits(CODEX_STREAM_FAILED))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["ok"] is False
    assert out["terminalReason"] == "provider-limit"
    assert "five hour provider limit reached" in out["error"]
    assert out["providerLimit"] == {
        "tool": "codex",
        "window": "five_hour",
        "resetsAt": "2026-09-17T10:10:00Z",
        "windows": [
            {"name": "five_hour", "usedPercent": 100, "resetsAt": "2026-09-17T10:10:00Z"},
            {"name": "seven_day", "usedPercent": 41, "resetsAt": "2026-09-20T01:00:00Z"},
        ],
        "plan": "plus",
    }


def test_a_codex_limit_is_read_past_a_later_count_with_no_windows(runner, workspace, fake_codex, tmp_path, monkeypatch):
    """A real Codex session that ran out (2026-08-25) ended on a second
    count, for its `premium` limit, with no window at all. The spent
    `codex` window came one event before it, and that is the one read."""
    home = tmp_path / "codex-home"
    _codex_session(
        home,
        {"limit_id": "codex", "primary": {"used_percent": 100.0, "window_minutes": 10080, "resets_at": 1788156893},
         "secondary": None, "plan_type": "plus", "rate_limit_reached_type": None},
        {"limit_id": "premium", "primary": None, "secondary": None, "plan_type": "plus", "rate_limit_reached_type": None},
    )
    monkeypatch.setenv("CODEX_HOME", str(home))
    codex = fake_codex(emits(CODEX_STREAM_FAILED))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["terminalReason"] == "provider-limit"
    assert out["providerLimit"]["window"] == "seven_day"
    assert "seven day provider limit reached" in out["error"]


def test_a_codex_turn_that_failed_with_room_left_is_still_a_cli_error(runner, workspace, fake_codex, tmp_path, monkeypatch):
    home = tmp_path / "codex-home"
    _codex_session(home, {
        "primary": {"used_percent": 3.0, "window_minutes": 10080, "resets_at": 1789866000},
        "plan_type": "plus", "rate_limit_reached_type": None})
    monkeypatch.setenv("CODEX_HOME", str(home))
    codex = fake_codex(emits(CODEX_STREAM_FAILED))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["terminalReason"] == "cli-error"
    assert "providerLimit" not in out


def test_a_codex_turn_refused_for_a_spent_account_is_a_provider_limit(
        runner, workspace, fake_codex, tmp_path, monkeypatch):
    """A real Codex step (2026-10-22) found the account spent before its
    first request: the session file holds only a `premium` count with no
    window, and the limit is named in Codex's own error alone. The step
    stops on the provider's limit, with the time Codex gave to try again."""
    home = tmp_path / "codex-home"
    _codex_session(home, {
        "limit_id": "premium", "primary": None, "secondary": None,
        "credits": {"has_credits": False, "unlimited": False, "balance": "0"},
        "plan_type": None, "rate_limit_reached_type": None})
    monkeypatch.setenv("CODEX_HOME", str(home))
    monkeypatch.setenv("TZ", "Europe/Oslo")
    codex = fake_codex(emits(CODEX_STREAM_USAGE_LIMIT) + "; exit 1")
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, command="implement")
    assert out["ok"] is False
    assert out["terminalReason"] == "provider-limit", out
    assert "press Implement again once it resets" in out["error"], out["error"]
    oslo = ZoneInfo("Europe/Oslo")
    now = datetime.now(oslo)
    at = now.replace(hour=15, minute=42, second=0, microsecond=0)
    if at <= now:
        at += timedelta(days=1)
    expected = at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert out["providerLimit"] == {"tool": "codex", "window": "usage", "resetsAt": expected}


def test_a_codex_usage_limit_with_no_time_to_try_again_has_no_reset(runner, workspace, fake_codex):
    stream = CODEX_STREAM_USAGE_LIMIT.replace(" or try again at 3:42 PM", "")
    codex = fake_codex(emits(stream) + "; exit 1")
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["terminalReason"] == "provider-limit", out
    assert out["providerLimit"] == {"tool": "codex", "window": "usage"}


def test_a_codex_model_at_capacity_is_its_own_stop_and_the_commit_says_so(runner, workspace, fake_codex):
    """Codex says the model is full in its stream and exits 1. That is the
    provider having no room, not the CLI failing: the step stops with a
    reason of its own, and it reaches the commit subject."""
    body = emits(CODEX_STREAM_AT_CAPACITY) + "; exit 1"
    codex = fake_codex(
        body.replace(
            "cat > /dev/null; ",
            "cat > /dev/null\n" + READ_SPECS
            + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n',
            1,
        )
    )
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, command="analyze", model="gpt-5.6")
    assert rc == 0, out
    assert out["ok"] is False
    assert out["terminalReason"] == "model-at-capacity", out
    assert "at capacity right now" in out["error"], out["error"]
    assert "press Analyze again" in out["error"] and "choose another model" in out["error"], out["error"]
    assert "gpt-5.6" in out["error"], out["error"]
    subject_line = git(workspace["specs"], "log", "-1", "--pretty=%s", "aide/81-queue-and-runner")
    assert subject_line.endswith("(stopped: model-at-capacity)"), subject_line


def test_a_codex_at_capacity_error_with_no_failed_turn_is_the_same_stop(runner, workspace, fake_codex):
    codex = fake_codex(emits(CODEX_STREAM_AT_CAPACITY_NO_TURN) + "; exit 1")
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["ok"] is False
    assert out["terminalReason"] == "model-at-capacity", out


def test_a_codex_at_capacity_error_the_turn_got_past_is_not_a_stop(runner, workspace, fake_codex):
    """"Ends with" is the condition: an earlier error in a turn that then
    completed is not how the step ended."""
    codex = fake_codex(emits(CODEX_STREAM_RECOVERED))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert rc == 0, out
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"


def test_a_codex_at_capacity_error_a_later_error_followed_is_a_cli_error(runner, workspace, fake_codex):
    """The last error decides: a different one after the at-capacity one is
    what the step ended on."""
    stream = CODEX_STREAM_AT_CAPACITY_NO_TURN + "\n" + CODEX_STREAM_FAILED.split("\n", 1)[1]
    codex = fake_codex(emits(stream) + "; exit 1")
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["terminalReason"] == "cli-error"


def test_a_codex_exit_1_with_no_at_capacity_error_is_a_cli_error(runner, workspace, fake_codex):
    codex = fake_codex(emits(CODEX_STREAM_FAILED) + "; exit 1")
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["terminalReason"] == "cli-error"


def test_a_codex_turn_at_capacity_with_a_full_window_keeps_the_provider_limit(
        runner, workspace, fake_codex, tmp_path, monkeypatch):
    home = tmp_path / "codex-home"
    _codex_session(home, {
        "primary": {"used_percent": 100.0, "window_minutes": 300, "resets_at": 1789639800},
        "secondary": {"used_percent": 41.4, "window_minutes": 10080, "resets_at": 1789866000},
        "plan_type": "plus", "rate_limit_reached_type": None})
    monkeypatch.setenv("CODEX_HOME", str(home))
    codex = fake_codex(emits(CODEX_STREAM_AT_CAPACITY) + "; exit 1")
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["terminalReason"] == "provider-limit"
    assert out["providerLimit"]["window"] == "five_hour"
    assert out["providerLimit"]["resetsAt"] == "2026-09-17T10:10:00Z"
    assert "resets 2026-09-17T10:10:00Z" in out["error"]


def test_a_codex_run_gets_no_session_id_argument(runner, workspace, fake_codex):
    """Every session id the dashboard hands down is freshly minted, so
    passing it to Codex would be asking it to resume a thread that has
    never existed. Codex assigns its own, and the run reads that back."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex,
                     session_id="11111111-2222-4333-8444-555555555555")
    assert rc == 0, out
    argv = fake_codex.calls.read_text()
    assert "--session-id" not in argv
    assert "resume" not in argv
    assert out["sessionId"] == CODEX_THREAD_ID

def test_a_codex_run_is_told_about_every_worktree_it_may_write_in(runner, workspace, fake_codex):
    """`--add-dir` is the same flag name on both CLIs (verified against
    codex-cli 0.147.0), so the one loop that hands over the sibling
    worktrees needs no branch — but nothing said so until this test."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert rc == 0, out
    argv = fake_codex.calls.read_text().split()
    added = [argv[i + 1] for i, a in enumerate(argv) if a == "--add-dir"]
    assert added, "no --add-dir at all"
    assert any(a.endswith("/" + workspace["specs"].name) for a in added), added

def test_a_codex_run_is_started_with_exec_and_json(runner, workspace, fake_codex):
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, model="gpt-5.6")
    assert rc == 0, out
    argv = fake_codex.calls.read_text().split()
    assert argv[0] == "exec"
    assert "--json" in argv
    assert argv[argv.index("--model") + 1] == "gpt-5.6"
    # Claude's own flags have no meaning here and must not leak across.
    assert "--max-budget-usd" not in argv
    assert "--output-format" not in argv
    assert "--permission-mode" not in argv

def test_the_dry_run_shows_the_codex_argv(runner, workspace, fake_codex):
    codex = fake_codex("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, dry_run=True)
    assert rc == 0, out
    assert out["dryRun"] is True
    assert out["argv"][0] == str(codex)
    assert out["argv"][1] == "exec"
    assert not fake_codex.calls.exists()
