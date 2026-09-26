"""aide-run-spec --resume-session: an implement that continues its analysis's
own session, so it starts with what the analysis read instead of reading it
all again. The board passes the flag only when both steps ran with the same
AI and the analysis ended within the hour; the runner rewrites the argv the
way a red suite's fix turn already does, and starts afresh when the session
cannot be continued.
"""

import json

from ..conftest import run
from .run_spec_results import RESULT_OK

SESSION = "analysis-session-1"


def test_an_implement_continues_the_analysis_session_in_claude(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")  # never called in a dry run
    rc, out, _ = run(runner, workspace, claude, command="implement", resume_session=SESSION, dry_run=True)
    assert rc == 0, out
    argv = out["argv"]
    assert argv[argv.index("--resume") + 1] == SESSION
    assert "--session-id" not in argv


def test_an_implement_continues_the_analysis_thread_in_codex(runner, workspace, fake_codex):
    codex = fake_codex("exit 1")
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, command="implement", resume_session=SESSION, dry_run=True)
    assert rc == 0, out
    argv = out["argv"]
    assert argv[1:3] == ["exec", "resume"]
    assert argv[-2:] == [SESSION, "-"]
    assert "--sandbox" not in argv


def test_an_implement_continues_the_analysis_session_in_opencode(runner, workspace, fake_opencode):
    opencode = fake_opencode("exit 1")
    rc, out, _ = run(runner, workspace, tool="opencode", opencode=opencode, command="implement", resume_session=SESSION, dry_run=True)
    assert rc == 0, out
    argv = out["argv"]
    assert argv[argv.index("--session") + 1] == SESSION


def test_another_step_never_continues_a_session(runner, workspace, fake_claude):
    rc, out, _ = run(runner, workspace, fake_claude("exit 1"), command="analyze", resume_session=SESSION, dry_run=True)
    assert rc == 0, out
    assert "--resume" not in out["argv"]


def test_a_session_that_cannot_be_continued_starts_the_implement_afresh(runner, workspace, fake_claude):
    """The session may be gone, or the tool may refuse it: the implement then
    runs as it would have without the flag, rather than failing."""
    claude = fake_claude(
        'case "$*" in *--resume*) echo "No conversation found with session ID" >&2; exit 1 ;; esac\n'
        "cat > /dev/null\n"
        'echo "written by the step" > "$PWD/new-code.txt"\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement", resume_session=SESSION)
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) >= 2, calls
    assert "--resume" in calls[0] and "--resume" not in calls[1], calls
    assert out["terminalReason"] != "cli-error", out
