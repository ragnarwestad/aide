"""aide-run-spec: a scheduled job produces a report and never changes a
repository. A session that commits anyway ends the run as failed, its
commit is discarded, and nothing of it reaches origin or stays as a
branch — in the project or in the specs repository.
"""

import json
import os
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


def local_branches(repo):
    return git(repo, "branch", "--list", "aide/schedule-*").strip()


def assert_nothing_left(workspace, origin):
    assert BRANCH not in heads(origin["project"]), heads(origin["project"])
    assert BRANCH not in heads(origin["specs"]), heads(origin["specs"])
    assert local_branches(workspace["project"]) == ""
    assert local_branches(workspace["specs"]) == ""


@pytest.mark.usefixtures("origin")
def test_a_job_that_only_writes_its_report_ends_completed_without_a_branch_AC_1(
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


def test_a_job_that_commits_in_the_project_fails_and_leaves_nothing_AC_2(runner, workspace, fake_claude, origin):
    with_prompt(workspace)
    main_before = heads(origin["project"])
    rc, out, _ = schedule(runner, workspace, job(fake_claude, COMMIT_IN_PROJECT + FINISHED))
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "a scheduled job cannot change the repository" in out["error"], out
    assert heads(origin["project"]) == main_before
    assert_nothing_left(workspace, origin)


def test_a_job_that_pushes_its_own_branch_has_it_deleted_from_origin_AC_2(runner, workspace, fake_claude, origin):
    with_prompt(workspace)
    claude = job(fake_claude, COMMIT_IN_PROJECT + "git push -q origin HEAD\n" + FINISHED)
    rc, out, _ = schedule(runner, workspace, claude)
    assert out["terminalReason"] == "scope-violation", out
    assert_nothing_left(workspace, origin)


def test_a_job_that_commits_in_the_specs_repository_fails_the_same_way_AC_2(runner, workspace, fake_claude, origin):
    with_prompt(workspace)
    rc, out, _ = schedule(runner, workspace, job(fake_claude, COMMIT_IN_SPECS + FINISHED))
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "a scheduled job cannot change the repository" in out["error"], out
    assert_nothing_left(workspace, origin)


def test_a_job_that_commits_and_hits_its_time_limit_stays_timeout_and_is_discarded_AC_2(
    runner, workspace, fake_claude, origin
):
    with_prompt(workspace)
    claude = job(fake_claude, COMMIT_IN_PROJECT + "sleep 120\n")
    rc, out, _ = schedule(runner, workspace, claude, timeout_sec=STOP_DEADLINE_SEC)
    assert out["terminalReason"] == "timeout", out
    assert "committed to the branch" not in out["error"], out
    assert_nothing_left(workspace, origin)


def test_a_cancelled_job_that_has_committed_leaves_nothing_behind_AC_2(runner, workspace, fake_claude, origin, tmp_path):
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
    assert_nothing_left(workspace, origin)


def test_a_non_scheduled_step_still_commits_and_pushes_its_work_AC_2(runner, workspace, fake_claude, origin):
    claude = job(fake_claude, 'echo "written by the step" > "$PWD/new-code.txt"\n' + FINISHED)
    rc, out, _ = schedule(runner, workspace, claude, command="implement", spec=workspace["folder"], prompt_file=None)
    assert rc == 0, out
    assert "aide/81-queue-and-runner" in heads(origin["project"])


def test_a_scheduled_prompt_carries_no_request_for_a_commit_message_AC_2(runner, workspace, fake_claude):
    with_prompt(workspace)
    seen = fake_claude.calls.parent / "prompt-seen.txt"
    rc, out, _ = schedule(runner, workspace, fake_claude(f"cat > {seen}\n{FINISHED}"))
    assert rc == 0, out
    prompt = seen.read_text()
    assert prompt.startswith("Write the report."), prompt
    assert "headless" in prompt
    assert "commit message" not in prompt, prompt


def test_an_analyze_prompt_still_asks_for_a_commit_message_AC_2(runner, workspace, fake_claude):
    seen = fake_claude.calls.parent / "prompt-seen.txt"
    rc, out, _ = schedule(
        runner, workspace, fake_claude(f"cat > {seen}\n{FINISHED}"),
        command="analyze", spec=workspace["folder"], prompt_file=None,
    )
    assert rc == 0, out
    assert "write the commit message for that change to " in seen.read_text()


def test_a_job_that_writes_a_file_and_commits_nothing_leaves_no_branch_AC_3(runner, workspace, fake_claude, origin):
    with_prompt(workspace)
    claude = job(fake_claude, 'echo "left behind" > "$PWD/scratch.txt"\n' + FINISHED)
    rc, out, _ = schedule(runner, workspace, claude)
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert_nothing_left(workspace, origin)


def test_a_job_that_does_nothing_leaves_no_branch_AC_3(runner, workspace, fake_claude, origin):
    with_prompt(workspace)
    rc, out, _ = schedule(runner, workspace, job(fake_claude, FINISHED))
    assert rc == 0, out
    assert out["ok"] is True, out
    assert_nothing_left(workspace, origin)
