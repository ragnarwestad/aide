"""aide-run-spec: a scheduled job may commit to the project repository and
the specs root, the same repositories a spec's step reaches. What it
commits is pushed and left on its branch, exactly like every other
command — the board is what lands it from there (spec 558).
"""

import json
import os
import re
import signal
import subprocess

import pytest

from ..conftest import READ_SPECS, STOP_DEADLINE_SEC, git
from .run_spec_invoking import SCHEDULE_KEY, wait_until
from .run_spec_invoking import schedule as run_schedule
from .run_spec_results import RESULT_OK

BRANCH = f"aide/{SCHEDULE_KEY}"
FINISHED = f"echo '{json.dumps(RESULT_OK)}'"
COMMIT_IN_PROJECT = (
    'echo "changed by the job" > "$PWD/changed.txt"\n'
    'git add -A && git -c user.name=Job -c user.email=job@example.com commit -qm "job change"\n'
)
COMMIT_IN_SPECS = (
    READ_SPECS
    + 'echo "changed by the job" > "$specs/job-note.txt"\n'
    + 'git -C "$specs" add -A && git -C "$specs" -c user.name=Job -c user.email=job@example.com commit -qm "job note"\n'
)


def schedule(runner, workspace, claude, **kwargs):
    """The dashboard's own way of starting a job: the branch is pushed."""
    kwargs.setdefault("push", "branch")
    return run_schedule(runner, workspace, claude, **kwargs)


def with_prompt(workspace):
    project = workspace["project"]
    (project / "docs").mkdir(exist_ok=True)
    (project / "docs" / "nightly-report.md").write_text("Write the report.\n")
    git(project, "add", "docs/nightly-report.md")
    git(project, "commit", "-qm", "add the job's prompt")


def job(fake_claude, body):
    return fake_claude("cat > /dev/null\n" + body)


def heads(bare):
    return git(bare, "ls-remote", "--heads", ".").strip()


@pytest.mark.usefixtures("origin")
def test_a_job_that_only_writes_its_report_ends_completed_without_a_branch_AC_5(
    runner, workspace, fake_claude
):
    with_prompt(workspace)
    report = workspace["project"].parent / "report"
    claude = job(fake_claude, f'mkdir -p {report}\necho "<p>all quiet</p>" > {report}/index.html\n{FINISHED}')
    rc, out, _ = schedule(runner, workspace, claude)
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert not out.get("branchUrls"), out
    assert (report / "index.html").read_text().strip() == "<p>all quiet</p>"


def test_a_job_that_commits_in_the_project_is_pushed_and_left_on_its_branch(runner, workspace, fake_claude, origin):
    with_prompt(workspace)
    rc, out, _ = schedule(runner, workspace, job(fake_claude, COMMIT_IN_PROJECT + FINISHED))
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert BRANCH in heads(origin["project"]), heads(origin["project"])
    roots = {r["root"]: r for r in out["repos"]}
    project = roots[str(workspace["project"])]
    assert project["headBefore"] != project["headAfter"]


def test_a_job_that_commits_in_the_specs_repository_is_pushed_and_left_on_its_branch(
    runner, workspace, fake_claude, origin
):
    with_prompt(workspace)
    rc, out, _ = schedule(runner, workspace, job(fake_claude, COMMIT_IN_SPECS + FINISHED))
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert BRANCH in heads(origin["specs"]), heads(origin["specs"])


def test_a_job_that_commits_and_hits_its_time_limit_keeps_the_commit_on_the_branch(
    runner, workspace, fake_claude, origin
):
    with_prompt(workspace)
    claude = job(fake_claude, COMMIT_IN_PROJECT + "sleep 120\n")
    rc, out, _ = schedule(runner, workspace, claude, timeout_sec=STOP_DEADLINE_SEC)
    assert out["terminalReason"] == "timeout", out
    # The message that used to be a lie for a schedule run is now true
    # for it too, the same as for every other command.
    assert "committed to the branch" in out["error"], out
    assert BRANCH in heads(origin["project"]), heads(origin["project"])


def test_a_cancelled_job_that_has_committed_keeps_it_on_the_branch(runner, workspace, fake_claude, origin, tmp_path):
    with_prompt(workspace)
    ready = tmp_path / "ready"
    claude = job(fake_claude, COMMIT_IN_PROJECT + f"touch {ready}\nsleep 60\n")
    env = {**os.environ, "AIDE_CLAUDE_BIN": str(claude)}
    proc = subprocess.Popen(
        [
            str(runner),
            "--project-dir", str(workspace["project"]),
            "--command", "schedule",
            "--spec", SCHEDULE_KEY,
            "--prompt-file", "docs/nightly-report.md",
            "--timeout-sec", "120",
            "--permission-mode", "acceptEdits",
            "--push", "branch",
            "--result-file", str(tmp_path / "result.json"),
            "--worktree-base", str(workspace["wtbase"]),
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
    )
    try:
        wait_until(ready.exists, 60, "the job never committed")
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=60)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
    assert BRANCH in heads(origin["project"]), heads(origin["project"])


def test_a_non_scheduled_step_still_commits_and_pushes_its_work(runner, workspace, fake_claude, origin):
    claude = job(fake_claude, 'echo "written by the step" > "$PWD/new-code.txt"\n' + FINISHED)
    rc, out, _ = schedule(runner, workspace, claude, command="implement", spec=workspace["folder"], prompt_file=None)
    assert rc == 0, out
    assert "aide/81-queue-and-runner" in heads(origin["project"])


def test_a_scheduled_prompt_now_carries_a_request_for_a_commit_message(runner, workspace, fake_claude):
    """The exclusion that made this a lie for `schedule` alone is gone: a
    schedule prompt asks for the commit-message file exactly the way
    every command but `create` and `wiki` already does."""
    with_prompt(workspace)
    seen = fake_claude.calls.parent / "prompt-seen.txt"
    rc, out, _ = schedule(runner, workspace, fake_claude(f"cat > {seen}\n{FINISHED}"))
    assert rc == 0, out
    prompt = seen.read_text()
    assert prompt.startswith("Write the report."), prompt
    assert "headless" in prompt
    assert "write the commit message for that change to " in prompt, prompt


def test_an_analyze_prompt_still_asks_for_a_commit_message(runner, workspace, fake_claude):
    seen = fake_claude.calls.parent / "prompt-seen.txt"
    rc, out, _ = schedule(
        runner, workspace, fake_claude(f"cat > {seen}\n{FINISHED}"),
        command="analyze", spec=workspace["folder"], prompt_file=None,
    )
    assert rc == 0, out
    assert "write the commit message for that change to " in seen.read_text()


def test_a_job_that_leaves_a_file_uncommitted_still_gets_it_committed_and_pushed(runner, workspace, fake_claude, origin):
    """The generic commit loop that picks up whatever a session leaves
    dirty runs for `schedule` now, the same as for every other command —
    it is no longer bypassed on the way to a guard that only ever looked
    for commits the session made itself."""
    with_prompt(workspace)
    claude = job(fake_claude, 'echo "left behind" > "$PWD/scratch.txt"\n' + FINISHED)
    rc, out, _ = schedule(runner, workspace, claude)
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert BRANCH in heads(origin["project"]), heads(origin["project"])
    assert git(origin["project"], "show", f"{BRANCH}:scratch.txt").strip() == "left behind"


def test_a_job_that_does_nothing_leaves_no_branch(runner, workspace, fake_claude, origin):
    with_prompt(workspace)
    rc, out, _ = schedule(runner, workspace, job(fake_claude, FINISHED))
    assert rc == 0, out
    assert out["ok"] is True, out
    assert BRANCH not in heads(origin["project"]), heads(origin["project"])
    assert BRANCH not in heads(origin["specs"]), heads(origin["specs"])


def test_no_scope_violation_error_line_is_written_for_an_ordinary_commit(runner, workspace, fake_claude, origin):
    with_prompt(workspace)
    _, out, _, err = schedule(runner, workspace, job(fake_claude, COMMIT_IN_PROJECT + FINISHED), return_stderr=True)
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert "a scheduled job cannot change the repository" not in err, err
    assert "scope-violation" not in err, err


def test_the_schedule_guard_file_is_gone(runner):
    """`run-spec-schedule-guard.sh` and the `discard_scheduled_commits`
    it called existed only to take back a scheduled job's own commits —
    with nothing left to discard, deleting the guard is the fix, not a
    dangling reference to keep around."""
    lib = runner.parent / "lib"
    assert not (lib / "run-spec-schedule-guard.sh").exists()
    source_text = runner.read_text()
    assert "run-spec-schedule-guard.sh" not in source_text
    for part in lib.glob("run-spec-*.sh"):
        assert "discard_scheduled_commits" not in part.read_text(), part
