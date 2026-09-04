"""The second tool: what Codex is told on its command line, what it
records, how a permission mode reaches it, and what it refuses.

Split out of test_aide_run_spec_tools.py 2026-09-04; the tests are
unchanged and keep their names.
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
import pytest
from ..conftest import run
from .run_spec_invoking import worktrees
from .run_spec_results import CODEX_STREAM_FAILED, CODEX_STREAM_OK, CODEX_THREAD_ID, CODEX_USAGE, RESULT_OK, emits


def test_a_codex_run_records_tool_and_tokens_but_no_cost(runner, workspace, fake_codex):
    """Criterion 1. Codex reports tokens and NO dollar figure anywhere in
    its output, so `costUsd` is absent — not zero, and not Claude's
    over-charge-to-budget fallback, which has nothing to approximate
    from here."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert rc == 0, out
    assert out["tool"] == "codex"
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"
    assert "costUsd" not in out, "a Codex step has no dollar figure to report"
    assert out["costMeasured"] is False
    # Codex's own thread id, read back the way Claude's session id is.
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
    """Criterion 2. Codex's safety is TWO axes where Claude's is one
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
    """Criterion 3. `codex exec` is non-interactive and has no
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
    """Criterion 4. The same "typed out or the run does not start"
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
    """REQ-3: Codex has no `--effort` equivalent, and a chosen effort for
    a Codex-run phase is accepted and dropped, the same "ignored, not
    refused" treatment the script already gives Codex's other
    Claude-only knobs."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, effort="high")
    assert rc == 0, out
    argv = fake_codex.calls.read_text().split()
    assert "--effort" not in argv

def test_a_codex_run_past_its_deadline_is_killed_the_same_way(runner, workspace, fake_codex):
    """Criterion 5. The timeout loop operates on a PID and a process
    group, never on a tool — so the only thing worth proving here is that
    a Codex step reaches it, and that a killed Codex step still reports
    no dollar figure (Claude's over-charge rule has nothing to work
    with)."""
    codex = fake_codex(
        "cat > /dev/null\n"
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    started = time.time()
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex,
                     timeout_sec="8", kill_grace_sec="2")
    elapsed = time.time() - started
    assert out["terminalReason"] == "timeout"
    assert out["ok"] is False
    assert out["tool"] == "codex"
    assert "costUsd" not in out
    assert out["costMeasured"] is False
    assert "tokens" not in out
    assert elapsed < 90, f"the kill took too long: {elapsed:.1f}s"

def test_a_failed_codex_turn_is_reported_not_swallowed(runner, workspace, fake_codex):
    codex = fake_codex(emits(CODEX_STREAM_FAILED))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["ok"] is False
    assert out["terminalReason"] == "cli-error"
    assert "refused the turn" in (out["error"] or "")

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
