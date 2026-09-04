"""aide-run-spec: what a run pushes and when: the push modes, a branch reused or already landed, origin as the source of truth, and the retry that follows a losing race.

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
from ..conftest import READ_SPECS, git, run
from .run_spec_fakes import conflicting_race_claude, partially_committing_claude, project_only_claude, race_pushing_claude, self_committing_claude, self_pushing_claude, specs_only_claude, writing_claude
from .run_spec_invoking import create
from .run_spec_origins import is_ancestor, run_with_gh
from .run_spec_results import RESULT_OK
from .run_spec_status_files import subject, with_status, workflow_steps_line

def test_push_none_keeps_everything_on_this_machine(runner, workspace, fake_claude, fake_gh, origin):
    claude = writing_claude(fake_claude, workspace)
    gh = fake_gh()
    rc, out, _ = run_with_gh(runner, workspace, claude, gh, push="none")
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    assert git(origin["project"], "branch", "--list", branch) == "", "nothing may leave the machine in `none`"
    assert not fake_gh.calls.exists(), "gh is only for `pr`"
    assert out.get("prUrl") is None

def test_the_default_is_to_push_nothing(runner, workspace, fake_claude, origin):
    """A hand-run must not publish anything nobody asked it to. The
    dashboard passes `--push branch` from its config."""
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert git(origin["project"], "branch", "--list", "aide/81-queue-and-runner") == ""

def test_push_branch_publishes_the_branch_and_links_to_the_diff(
    runner, workspace, fake_claude, fake_gh, origin
):
    claude = writing_claude(fake_claude, workspace)
    gh = fake_gh()
    rc, out, _ = run_with_gh(runner, workspace, claude, gh, push="branch")
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    assert branch in git(origin["project"], "branch", "--list", branch)
    assert not fake_gh.calls.exists(), "gh is only for `pr`"
    # The compare page is the diff view a reviewer opens on a phone.
    assert out["branchUrl"] == f"https://github.com/ragnarwestad/aide/compare/main...{branch}"

def test_push_branch_puts_the_spec_work_on_the_branch_too(runner, workspace, fake_claude, origin):
    """The whole point of `branch` is that unattended work lands
    somewhere a human looks at it before it reaches main. Pushing the
    specs repo's HEAD while only the project was branched sent every
    analysis straight to main — measured 2026-08-16 on spec 84."""
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, push="branch")
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    assert branch in git(origin["specs"], "branch", "--list", branch), "the analysis must be on the branch"
    log = subprocess.run(
        ["git", "-C", str(origin["specs"]), "log", "-1", "--pretty=%s", branch],
        capture_output=True, text=True, check=True,
    ).stdout
    assert "analyze" in log

def test_a_run_never_moves_main_in_the_specs_repo(runner, workspace, fake_claude, origin):
    before = subprocess.run(
        ["git", "-C", str(origin["specs"]), "rev-parse", "main"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace), push="branch")
    assert rc == 0, out
    after = subprocess.run(
        ["git", "-C", str(origin["specs"]), "rev-parse", "main"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert before == after, "unattended work must not land on main"

def test_a_repo_with_no_changes_gets_no_branch(runner, workspace, fake_claude, origin):
    """An analyze step touches nothing in the project. Pushing an empty
    branch there gave a compare page with no diff on it — which is
    exactly what you get when you click the link."""
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace), push="branch")
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    assert git(origin["project"], "branch", "--list", branch) == "", "nothing changed there"
    assert branch in git(origin["specs"], "branch", "--list", branch)

def test_the_link_points_at_the_repo_that_actually_changed(runner, workspace, fake_claude, origin):
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace), push="branch")
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    assert out["branchUrl"] == f"https://github.com/ragnarwestad/aide-specs/compare/main...{branch}"

def test_every_changed_repo_is_listed_with_its_own_link(runner, workspace, fake_claude, origin):
    """Both changed, so both are reviewable. `branchUrl` stays the
    project's for the reader who wants one link; `branchUrls` carries
    the rest."""
    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace), push="branch")
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    assert out["branchUrl"] == f"https://github.com/ragnarwestad/aide/compare/main...{branch}"
    urls = {e["url"] for e in out["branchUrls"]}
    assert urls == {
        f"https://github.com/ragnarwestad/aide/compare/main...{branch}",
        f"https://github.com/ragnarwestad/aide-specs/compare/main...{branch}",
    }

def test_a_repo_with_no_web_link_is_still_a_repo_the_dashboard_can_land(
    runner, workspace, fake_claude, local_origin
):
    """branchUrls is the dashboard's own "which repos got pushed" answer
    (queue/types.ts's doc comment on the field) — landNewSpec/
    landStepBranch read it as their landing candidates whenever a step
    does not name its own repos. A repo whose origin has no GitHub-style
    URL still gets pushed; leaving it out of branchUrls made every
    create/analyze/implement step against a local-only origin land
    nothing at all, silently."""
    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace), push="branch")
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    assert branch in git(local_origin["project"], "branch", "--list", branch)
    assert branch in git(local_origin["specs"], "branch", "--list", branch)
    roots = {e["root"] for e in out["branchUrls"]}
    assert roots == {str(workspace["project"]), str(workspace["specs"])}
    assert all(e["url"] == "" for e in out["branchUrls"])
    assert out.get("branchUrl") is None

def test_push_pr_opens_a_pull_request_and_reports_its_url(
    runner, workspace, fake_claude, fake_gh, origin
):
    claude = writing_claude(fake_claude, workspace)
    gh = fake_gh()
    rc, out, _ = run_with_gh(runner, workspace, claude, gh, push="pr")
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    assert branch in git(origin["project"], "branch", "--list", branch), "pr pushes too"
    called = fake_gh.calls.read_text()
    assert "pr create" in called
    assert branch in called
    assert out["prUrl"] == "https://github.com/ragnarwestad/aide/pull/7"
    assert out.get("prError") is None

def test_a_broken_gh_never_fails_a_finished_run(runner, workspace, fake_claude, fake_gh, origin, command="implement"):
    """`gh` on the mini needs an interactive re-auth only the user can
    do. A run whose work succeeded must not be reported as failed
    because the PR could not be opened."""
    claude = writing_claude(fake_claude, workspace)
    gh = fake_gh('echo "the token in default is invalid" >&2; exit 1')
    rc, out, _ = run_with_gh(runner, workspace, claude, gh, push="pr", command="implement")
    assert rc == 0
    assert out["ok"] is True, "the step did its work"
    assert out["terminalReason"] == "completed"
    assert out["prError"], "but the failure is recorded, not swallowed"
    assert "aide/81-queue-and-runner" in git(
        origin["project"], "branch", "--list", "aide/81-queue-and-runner"
    ), "the push still happened"

def test_a_push_that_cannot_reach_its_remote_is_recorded_not_fatal(runner, workspace, fake_claude):
    """No origin at all: spec 328's own words for this used to be "the
    work is committed locally, and the run says so instead of failing" —
    REQ-3 overturns exactly that for the step's own bookkeeping. The work
    still lands in a local commit (nothing here undoes that), but the
    step must never be counted as having reached anywhere it did not."""
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, push="branch", command="implement")
    assert rc == 0
    assert out["ok"] is False
    assert out["terminalReason"] == "unpushed"
    assert out["pushError"], "a push that did not happen must not be silent"
    branch = "aide/81-queue-and-runner"
    line = workflow_steps_line(workspace["specs"], branch, workspace["folder"])
    # Unchanged from the workspace fixture's own starting line (REQ-3) —
    # `implement` never lands, `analyze` stays exactly as it was.
    assert line == "- **Workflow steps completed:** analyze", line

def test_an_unpushed_step_never_lands_on_the_workflow_steps_line(
    runner, workspace, fake_claude, rejecting_origin
):
    """REQ-1/REQ-3/REQ-6: origin is reachable and refuses every push —
    the step's own tool turn reports success, but nothing it produced
    ever reaches origin in either root, so neither root's own content is
    confirmed and the step must never be counted as having run.
    `command="implement"` (with `analyze` already on the line, spec 344's
    own precondition) so a step that legitimately touches BOTH roots
    proves REQ-1's "every repository it branched", not just one."""
    with_status(workspace, claims=["analyze"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement", push="branch")
    assert rc == 0, out
    assert out["ok"] is False
    assert out["terminalReason"] == "unpushed"
    # REQ-3: the repository (or repositories) that did not confirm are
    # named, not just "a push failed" generically.
    assert str(workspace["project"]) in out["error"], out["error"]
    assert str(workspace["specs"]) in out["error"], out["error"]
    branch = "aide/81-queue-and-runner"
    line = workflow_steps_line(workspace["specs"], branch, workspace["folder"])
    assert line == "- **Workflow steps completed:** analyze", line

def test_a_re_run_after_unpushed_reaches_origin_and_lands_on_the_line(
    runner, workspace, fake_claude, rejecting_origin
):
    """REQ-4: the PROJECT root already carries real content on this
    spec's branch before either run even starts — the shape of a root a
    PRIOR run committed to and never managed to push, stranded there with
    nothing for THIS run's own session to add (an `analyze` step never
    touches the project at all, so there genuinely is none). The first
    run ends `unpushed` for both roots; the re-run's own session changes
    nothing either — a `fake_claude` that does nothing — so only the push
    loop's WIDENED gate (retry on "not yet what origin has", never "moved
    THIS run") can be what makes the stranded project commit land."""
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    (project / "from-an-earlier-run.txt").write_text("stranded, never pushed\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "an earlier run's own work")
    stranded = git(project, "rev-parse", "HEAD")
    git(project, "switch", "-q", "main")

    with_status(workspace, claims=["create"])
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, push="branch")
    assert rc == 0, out
    assert out["ok"] is False
    assert out["terminalReason"] == "unpushed"
    assert str(project) in out["error"], out["error"]
    assert str(workspace["specs"]) in out["error"], out["error"]

    # Origin now accepts pushes — the same two bare repos, hook removed.
    (rejecting_origin["project"] / "hooks" / "pre-receive").unlink()
    (rejecting_origin["specs"] / "hooks" / "pre-receive").unlink()

    claude2 = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc2, out2, _ = run(runner, workspace, claude2, push="branch")
    assert rc2 == 0, out2
    assert out2["ok"] is True, out2
    assert out2["terminalReason"] == "completed"
    line = workflow_steps_line(workspace["specs"], branch, workspace["folder"])
    assert "analyze" in line, line
    # The project root's own stranded commit — nothing the second run's
    # own session touched — reached origin too.
    assert is_ancestor(project, stranded, branch)
    assert git(rejecting_origin["project"], "branch", "--list", branch) != ""

def test_the_second_pass_alone_can_fail_unpushed(
    runner, workspace, fake_claude, specs_origin_rejecting_the_second_push
):
    """REQ-2: pass 1 (the step's own analysis) reaches origin; pass 2 (the
    line's own small commit, made only because pass 1 was confirmed)
    does not — proving the line's own push is confirmed independently,
    never assumed to have succeeded because the content before it did."""
    with_status(workspace, claims=["create"])
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, push="branch")
    assert rc == 0, out
    assert out["ok"] is False
    assert out["terminalReason"] == "unpushed"
    assert out["pushError"]
    branch = "aide/81-queue-and-runner"
    # Origin's own copy is exactly pass 1's content — the line's own
    # commit never reached it.
    origin_line = workflow_steps_line(specs_origin_rejecting_the_second_push, branch, workspace["folder"])
    assert origin_line == "- **Workflow steps completed:** create", origin_line

def test_a_repo_the_step_committed_itself_is_still_pushed(runner, workspace, fake_claude, origin):
    """Spec 92's archive step committed its own two commits, the run's
    commit loop found a clean tree, counted the repo as unchanged and
    pushed nothing — the branch existed on the serving host only. HEAD
    moved, so the branch belongs on origin, whoever made the commit."""
    rc, out, _ = run(runner, workspace, self_committing_claude(fake_claude, workspace), push="branch")
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    roots = {r["root"]: r for r in out["repos"]}
    project = roots[str(workspace["project"])]
    assert project["changedFiles"] == 0, "the step left the tree clean — the loop had nothing to commit"
    assert project["headBefore"] != project["headAfter"], "but HEAD moved"
    assert branch in git(origin["project"], "branch", "--list", branch), "so the branch must reach origin"

def test_a_repo_the_step_committed_itself_gets_its_compare_link(
    runner, workspace, fake_claude, origin
):
    """The link is what a reader opens; a pushed branch nobody is told
    about is the same silence in a different place."""
    rc, out, _ = run(runner, workspace, self_committing_claude(fake_claude, workspace), push="branch")
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    url = f"https://github.com/ragnarwestad/aide/compare/main...{branch}"
    assert url in {e["url"] for e in out["branchUrls"]}
    assert out["branchUrl"] == url

def test_a_step_that_commits_part_of_its_own_work_gets_one_commit_not_two(
    runner, workspace, fake_claude
):
    """Spec 146: the step committed one file under its own message and
    left another on disk, so the run's loop opened a SECOND commit under
    the generic subject and the change arrived split down a line no
    reader can use. The leftover belongs in the commit the step already
    made."""
    rc, out, _ = run(runner, workspace, partially_committing_claude(fake_claude, workspace))
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    project = {r["root"]: r for r in out["repos"]}[str(workspace["project"])]

    count = git(workspace["project"], "rev-list", "--count", f"{project['headBefore']}..{branch}")
    assert count == "1", "one step, one commit"
    subject = git(workspace["project"], "log", "-1", "--pretty=%s", branch)
    assert subject == "The step wrote this itself", "the step's own message survives"
    assert "Run /aide-" not in subject

    # Both halves are in that one commit.
    for name in ("self-committed.txt", "left-behind.txt"):
        assert git(workspace["project"], "show", f"{branch}:{name}"), name
    assert git(workspace["project"], "status", "--porcelain") == ""

def test_a_stopped_run_still_folds_into_the_step_s_own_commit(runner, workspace, fake_claude):
    """The stop reason is the whole point of the fallback commit's
    message. Folding the leftover into the step's own commit must not
    drop it — and it belongs on its own line, below a body that is the
    step's."""
    claude = partially_committing_claude(
        fake_claude, workspace, then="trap '' TERM\nwhile true; do sleep 0.2; done\n"
    )
    rc, out, _ = run(runner, workspace, claude, timeout_sec="8", kill_grace_sec="2")
    assert out["terminalReason"] == "timeout"
    branch = "aide/81-queue-and-runner"
    project = {r["root"]: r for r in out["repos"]}[str(workspace["project"])]

    count = git(workspace["project"], "rev-list", "--count", f"{project['headBefore']}..{branch}")
    assert count == "1", "a stopped run does not get an extra commit either"
    message = git(workspace["project"], "log", "-1", "--pretty=%B", branch)
    assert message.startswith("The step wrote this itself"), message
    assert "And explained why" in message
    assert message.rstrip().endswith("(stopped: timeout)"), message
    assert git(workspace["project"], "show", f"{branch}:left-behind.txt")
    assert git(workspace["project"], "status", "--porcelain") == ""

def test_an_unknown_push_mode_is_refused_before_anything_starts(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, push="everywhere")
    assert rc == 2
    assert "push" in out["error"].lower()
    assert not fake_claude.calls.exists()
