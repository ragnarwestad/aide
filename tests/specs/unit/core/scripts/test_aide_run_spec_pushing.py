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
from .conftest import READ_SPECS, git, run
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

def test_a_reused_branch_is_brought_up_to_the_default_branch(runner, workspace, fake_claude):
    """A spec's branch survives between steps, so analyze and
    implement build on each other. But the default branch moves on, and a
    branch left over from the morning made the step read the morning's
    code. Measured 2026-08-16, while review-plan was still a separate step
    (spec 181 folded it into analyze): it reviewed a file whose bug had
    been fixed hours earlier."""
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    git(project, "switch", "-q", "main")
    (project / "moved-on.txt").write_text("landed on main after the branch was made\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "later work on main")

    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'test -f "$PWD/moved-on.txt" && echo yes > "$PWD/saw-it.txt"\n'
        + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert "saw-it.txt" in git(project, "show", "--name-only", "--pretty=", branch), \
        "the step must see what landed on main after the branch was made"
    assert is_ancestor(project, "main", branch), "the branch must contain main"

def test_a_reused_branch_keeps_its_own_work(runner, workspace, fake_claude):
    """Bringing the branch up to date must not throw away the previous
    step's commits — that is the whole reason the branch is reused."""
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    (project / "from-the-earlier-step.txt").write_text("analyze wrote this\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "an earlier step")
    earlier = git(project, "rev-parse", "HEAD")
    git(project, "switch", "-q", "main")
    (project / "moved-on.txt").write_text("meanwhile\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "later work on main")

    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert is_ancestor(project, earlier, branch), "the earlier step's work must survive"
    assert is_ancestor(project, "main", branch), "and main must be in there too"

def test_a_rejected_push_that_only_needed_a_pull_is_retried_not_reported(
    runner, workspace, fake_claude, fetchable_origin_both_roots, tmp_path
):
    """REQ-1/REQ-4/REQ-6. Another process pushes to origin's copy of this
    exact branch while the step is still working — the run's own push is
    rejected as non-fast-forward, and `push_with_retry` must `pull
    --rebase` and push again before reporting anything. A retry-recovered
    success must leave no `pushError` (REQ-4), and `repos_json`'s own
    `headAfter` for the rebased root must be the POST-rebase tip, the one
    origin actually holds — not the tip the commit loop left before the
    retry ran (REQ-6, the field spec 343's own gate reads)."""
    branch = "aide/81-queue-and-runner"
    race_dir = tmp_path / "race-clone"
    race_marker = tmp_path / "raced-sha.txt"
    project_bare = fetchable_origin_both_roots["project"]
    claude = race_pushing_claude(fake_claude, workspace, project_bare, branch, race_marker, race_dir)
    rc, out, _ = run(runner, workspace, claude, push="branch", command="implement")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out.get("pushError") is None, "a retry-recovered push must leave no trace of failure"
    project = workspace["project"]
    raced_sha = race_marker.read_text().strip()
    local_tip = git(project, "rev-parse", branch)
    origin_tip = git(project_bare, "rev-parse", branch)
    assert local_tip == origin_tip, "nothing may be stranded between local and origin"
    assert is_ancestor(project, raced_sha, branch), "the concurrent commit must survive the rebase"
    project_repo = next(r for r in out["repos"] if r["root"] == str(project))
    assert project_repo["headAfter"] == origin_tip, "headAfter must be the POST-rebase tip"

def test_a_push_that_cannot_reach_origin_is_retried_then_succeeds(
    runner, workspace, fake_claude, fetchable_origin_both_roots, tmp_path
):
    """REQ-2/REQ-4. Origin is briefly unreachable — not rejected, just
    not there — when the push loop's first attempt runs: the step's own
    script hides the bare repo, then backgrounds its own restore (never
    inheriting the step's stdout, or the runner would wait on that pipe
    forever), timed to land AFTER the first two attempts (immediate,
    then the 1s retry) and BEFORE the third (the 1s+2s retry) — so only
    a run that actually waits and retries up to the bound can succeed;
    one that reports on the first failure never gets the chance."""
    project_bare = fetchable_origin_both_roots["project"]
    hidden = tmp_path / "hidden-origin.git"
    project_bare.rename(hidden)
    claude = fake_claude(
        "cat > /dev/null\n"
        + f'( sleep 2.5 && mv "{hidden}" "{project_bare}" ) >/dev/null 2>&1 & disown\n'
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, push="branch", command="implement")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out.get("pushError") is None

def test_a_conflicting_rebase_is_reported_not_resolved(
    runner, workspace, fake_claude, fetchable_origin_both_roots, tmp_path
):
    """REQ-3/REQ-7. The retry's `pull --rebase` hits a real conflict —
    both sides edited the same line of the same file — so the script
    must abort it, leave the branch exactly where its own commit left
    it, and report which commits are on each side, with no further push
    attempted and never a `-X`/force resolution of its own."""
    branch = "aide/81-queue-and-runner"
    race_dir = tmp_path / "race-clone"
    race_marker = tmp_path / "their-sha.txt"
    project_bare = fetchable_origin_both_roots["project"]
    claude = conflicting_race_claude(fake_claude, workspace, project_bare, branch, race_marker, race_dir)
    rc, out, _ = run(runner, workspace, claude, push="branch", command="implement")
    assert rc == 0, out
    assert out["ok"] is False
    assert out["terminalReason"] == "unpushed"
    assert out["pushError"], "a diverged push must not be silent"
    assert branch in out["pushError"], out["pushError"]
    their_sha = race_marker.read_text().strip()
    assert their_sha[:7] in out["pushError"], "names the commit on origin's side"
    project = workspace["project"]
    # REQ-7: never auto-resolved — their commit never entered this
    # branch, and the file still reads exactly what the step's own
    # commit wrote, not some -X-resolved blend of the two sides.
    assert not is_ancestor(project, their_sha, branch)
    assert git(project, "show", f"{branch}:README.md") == "our line"

def test_a_push_that_cannot_reach_its_remote_at_all_still_needs_no_retry(
    runner, workspace, fake_claude
):
    """Confirms the existing no-origin-remote case (spec 328/343) is
    untouched by push_with_retry: nothing to retry against, so it is
    still reported on the first and only attempt, exactly as before."""
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, push="branch", command="implement")
    assert rc == 0
    assert out["ok"] is False
    assert out["terminalReason"] == "unpushed"
    assert out["pushError"]
    assert "no origin remote" in out["pushError"]

def test_a_reused_branch_is_taken_from_origin_not_from_this_checkout(
    runner, workspace, fake_claude, fetchable_origin
):
    """The branch is a shared thing; this machine's ref is one copy of it.
    A resolve done anywhere else leaves the serving host at the old tip,
    and reusing that ref re-runs the step against the code the conflict
    was already resolved away from. Seen on spec 150 (2026-08-21): two
    Runs refused for a conflict fixed and pushed an hour earlier."""
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    (project / "first.txt").write_text("the tip this machine knows\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "branch side")
    behind = git(project, "rev-parse", "HEAD")
    (project / "resolved-elsewhere.txt").write_text("pushed from another machine\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "work done elsewhere")
    ahead = git(project, "rev-parse", "HEAD")
    git(project, "push", "-q", "origin", branch)
    # Rewind this checkout to where it would be if the newer commit had
    # been made anywhere but here — remote-tracking ref included, so the
    # run has to ask origin rather than read a local answer.
    git(project, "switch", "-q", "main")
    git(project, "branch", "-f", branch, behind)
    git(project, "update-ref", "-d", f"refs/remotes/origin/{branch}")

    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert is_ancestor(project, ahead, branch), \
        "the step must run on origin's copy of the branch, not this machine's"

def test_a_branch_that_has_diverged_from_origin_refuses_by_name(
    runner, workspace, fake_claude, fetchable_origin
):
    """Fast-forward only. A local ref carrying commits origin has not got
    is work this machine has not pushed, and overwriting it would throw
    that away — so the run says which branch and why instead."""
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    (project / "shared.txt").write_text("common\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "common ancestor")
    common = git(project, "rev-parse", "HEAD")
    (project / "theirs.txt").write_text("pushed elsewhere\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "their side")
    git(project, "push", "-q", "origin", branch)
    git(project, "switch", "-q", "main")
    git(project, "branch", "-f", branch, common)
    git(project, "update-ref", "-d", f"refs/remotes/origin/{branch}")
    git(project, "switch", "-q", branch)
    (project / "ours.txt").write_text("made here, never pushed\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "our side")
    ours = git(project, "rev-parse", "HEAD")
    git(project, "switch", "-q", "main")

    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "diverged" in out["error"], out["error"]
    assert branch in out["error"]
    # The refusal is not a conflict: no in-worktree resolution would
    # finish it, so the row must not be told one could.
    assert "errorReason" not in out
    # And nothing local was thrown away.
    assert git(project, "rev-parse", branch) == ours
    assert not fake_claude.calls.exists()

def test_a_step_that_pushed_its_own_commit_is_not_amended(
    runner, workspace, fake_claude, fetchable_origin, tmp_path
):
    """REQ-1. `fetchable_origin` answers both fetch and push, so the
    pre-amend check can reach it and must catch the commit already being
    public — the leftover then belongs in a NEW commit, and the step's
    own commit must stay an ancestor of the branch tip, not get rewritten
    into a sibling of it."""
    sha_marker = tmp_path / "pushed-sha.txt"
    claude = self_pushing_claude(fake_claude, workspace, sha_marker)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    project = workspace["project"]
    pushed_sha = sha_marker.read_text().strip()
    assert is_ancestor(project, pushed_sha, branch), (
        "the step's own pushed commit must still be an ancestor of the "
        "branch tip, not rewritten away by an amend"
    )
    assert git(project, "log", "-1", "--pretty=%s", pushed_sha) == "The step wrote this itself"

def test_the_leftover_after_a_self_pushed_commit_still_reaches_origin(
    runner, workspace, fake_claude, origin, tmp_path
):
    """REQ-2/REQ-6, black-box. `origin` (unlike `fetchable_origin`) points
    the fetch url at an address nothing here can reach, so the pre-amend
    check cannot tell the step's commit is already public and misses it —
    the same best-effort shape `sync_branch_with_origin` already has. The
    commit loop then amends anyway, same as before this fix; what must be
    different is that the amended commit still reaches origin (a
    retried, scoped force-with-lease) rather than being silently rejected
    the way spec 327's run was."""
    sha_marker = tmp_path / "pushed-sha.txt"
    claude = self_pushing_claude(fake_claude, workspace, sha_marker)
    rc, out, _ = run(runner, workspace, claude, push="branch", command="implement")
    assert rc == 0, out
    assert out["ok"] is True
    branch = "aide/81-queue-and-runner"
    local_tip = git(workspace["project"], "rev-parse", branch)
    origin_tip = git(origin["project"], "rev-parse", branch)
    assert origin_tip == local_tip, "nothing may be stranded between local and origin"

def test_a_second_run_after_a_self_pushing_step_does_not_see_a_diverged_branch(
    runner, workspace, fake_claude, fetchable_origin, tmp_path
):
    """REQ-6, reusing `test_a_branch_that_has_diverged_from_origin_refuses_by_name`'s
    own oracle: a branch this fix left consistent between local and
    origin must not refuse a later run as diverged from itself."""
    sha_marker = tmp_path / "pushed-sha.txt"
    claude = self_pushing_claude(fake_claude, workspace, sha_marker)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out

    claude2 = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc2, out2, _ = run(runner, workspace, claude2)
    assert rc2 == 0, out2
    assert out2["terminalReason"] != "refused"
    assert "diverged" not in (out2.get("error") or "")

def test_a_branch_that_cannot_be_updated_refuses_rather_than_running(runner, workspace, fake_claude):
    """A conflict between the branch and main is a human's problem. Running
    the step anyway would spend money producing work on a tree nobody can
    merge."""
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    (project / "contested.txt").write_text("the branch's version\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "branch side")
    git(project, "switch", "-q", "main")
    (project / "contested.txt").write_text("main's version\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "main side")

    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "up to date" in out["error"] or "conflict" in out["error"]
    # Spec 153: and it says WHY in a field, not only in the sentence. The
    # row draws its Resolve button off this, and the way out of a
    # conflict found here is the same step as the way out of one found
    # by a landing.
    assert out["errorReason"] == "conflict"
    # And the tree is left clean, not mid-merge.
    assert git(project, "status", "--porcelain") == ""

def test_a_branch_already_landed_on_origin_is_not_reused(
    runner, workspace, fake_claude, fetchable_origin
):
    """The state spec 181 hit: this checkout still holds the branch it
    made, but the work landed through a DIFFERENT checkout — so this
    checkout's own main, and its cached knowledge of origin's main, are
    both exactly what they were before any of that happened. A run must
    not silently go on using the stale branch as though nothing landed.
    """
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    (project / "landed.txt").write_text("this reached main\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "the spec's own work")
    before = git(project, "rev-parse", branch)
    git(project, "push", "-q", "origin", branch)
    git(project, "switch", "-q", "main")

    # The landing happens elsewhere: compute it on a throwaway ref, push
    # that as origin's main, delete the branch on origin — then erase
    # every trace of it from THIS checkout, so its knowledge stays as
    # stale as a real reopened spec's.
    git(project, "switch", "-q", "-c", "throwaway-landing", "main")
    git(project, "merge", "-q", "--no-edit", branch)
    git(project, "push", "-q", "origin", "throwaway-landing:main")
    git(project, "push", "-q", "origin", "--delete", branch)
    git(project, "switch", "-q", "main")
    git(project, "branch", "-D", "throwaway-landing")
    git(project, "update-ref", "-d", "refs/remotes/origin/main")

    # The step writes in the PROJECT, which is where the stale branch is:
    # since spec 215 a branch carrying nothing does not outlive the run
    # that cut it, so a step committing nothing here would leave no
    # branch to ask a question about.
    claude = project_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    # Without the check, the stale branch is reused as it stands and the
    # step's commit is stacked on top of it, leaving the landed work in
    # the branch's history. The fix throws it away and builds a new one
    # from the current base, where that work is not reachable.
    assert not is_ancestor(project, before, branch), \
        "a branch whose work already landed must be rebuilt, not reused"

def test_a_branch_that_has_not_landed_is_still_reused(
    runner, workspace, fake_claude, fetchable_origin
):
    """The one case where a leftover is the only copy of something: work
    that never reached the default branch. Reachable origin or not, that
    branch is left exactly as it was found."""
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    (project / "still-unlanded.txt").write_text("only on the branch\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "unlanded work")
    unlanded = git(project, "rev-parse", "HEAD")
    git(project, "switch", "-q", "main")

    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert is_ancestor(project, unlanded, branch), "the unlanded commit must survive"

def test_an_unreachable_origin_leaves_a_local_branch_reused_as_before(
    runner, workspace, fake_claude
):
    """The check is a network call like every other one in this script:
    best effort, and never fatal. An origin nobody can reach must not be
    read as proof that a branch has landed. No `origin` remote is
    configured here at all — the plainest form of unreachable there is.
    """
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    (project / "from-the-earlier-step.txt").write_text("analyze wrote this\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "an earlier step")
    earlier = git(project, "rev-parse", "HEAD")
    git(project, "switch", "-q", "main")

    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert is_ancestor(project, earlier, branch), \
        "the earlier step's work must survive when origin cannot be reached"

def test_extra_project_dir_is_no_longer_an_argument(runner, workspace, fake_claude):
    claude = fake_claude(f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, extra_project_dir="/tmp/whatever")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "unknown argument" in out["error"]
    assert "--extra-project-dir" in out["error"]
