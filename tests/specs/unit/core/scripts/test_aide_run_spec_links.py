"""aide-run-spec: the files a worktree borrows from its main checkout, and the state a project has to be in before a run may start.

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
from .conftest import READ_SPECS, git, init_repo, run
from .run_spec_fakes import linking_claude, probing_claude, writing_claude
from .run_spec_invoking import BRANCH, run_traced, worktrees
from .run_spec_origins import leave_branch_on_origin, leave_unmerged_branch_on_origin
from .run_spec_project_state import BASH_UNTESTABLE, PRECEDENCE, READINESS_FIXTURE, READINESS_SCENARIOS, configure_links
from .run_spec_results import RESULT_OK
from .run_spec_status_files import add_spec, set_depends_on

def test_a_worktree_base_inside_a_root_is_refused(runner, workspace, fake_claude):
    """A worktree inside a root would be untracked, and `git add -A`
    would commit a whole second checkout onto the spec branch."""
    claude = fake_claude("exit 1")
    rc, out, _ = run(
        runner, workspace, claude,
        worktree_base=str(workspace["project"] / "wt"),
    )
    assert rc == 2, out
    assert str(workspace["project"]) in out["error"]
    assert not fake_claude.calls.exists()

def test_a_worktree_base_inside_the_specs_repo_is_refused(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, worktree_base=str(workspace["specs"] / "wt"))
    assert rc == 2, out
    assert str(workspace["specs"]) in out["error"]

@pytest.mark.parametrize("entry", ["/etc", "../escape", "deps/../../escape"])
def test_a_link_that_escapes_the_root_is_refused(runner, workspace, fake_claude, entry):
    claude = fake_claude("exit 1")
    (workspace["project"] / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={workspace['specs']}\nAIDE_WORKTREE_LINKS={entry}\n"
    )
    git(workspace["project"], "add", "-f", ".aide/config")
    git(workspace["project"], "commit", "-q", "-m", "a bad link")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2, out
    assert entry in out["error"], out
    assert not fake_claude.calls.exists()

@pytest.mark.parametrize("entry", ["build", "target", "dist", ".gradle", "backend/build"])
def test_a_link_naming_a_build_output_is_refused(runner, workspace, fake_claude, entry):
    claude = fake_claude("exit 1")
    (workspace["project"] / entry).mkdir(parents=True)
    (workspace["project"] / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={workspace['specs']}\nAIDE_WORKTREE_LINKS={entry}\n"
    )
    git(workspace["project"], "add", "-f", ".aide/config")
    git(workspace["project"], "commit", "-q", "-m", "a link into a build output")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2, out
    assert entry in out["error"], out
    assert "build output" in out["error"], out
    assert not fake_claude.calls.exists(), "the refusal must precede the money"

def test_the_dependency_caches_a_build_only_reads_are_not_refused(runner, workspace, fake_claude):
    """Criterion 4: this repo's own setting, unaffected by the denylist."""
    claude = fake_claude("exit 0")
    (workspace["project"] / ".venv").mkdir()
    (workspace["project"] / "dashboard" / "node_modules").mkdir(parents=True)
    (workspace["project"] / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={workspace['specs']}\n"
        "AIDE_WORKTREE_LINKS=.venv dashboard/node_modules\n"
    )
    git(workspace["project"], "add", "-f", ".aide/config")
    git(workspace["project"], "commit", "-q", "-m", "the links this repo uses")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out

def test_the_two_copies_of_the_worktree_link_denylist_agree(workspace_root, run_spec_source):
    import re

    bash = run_spec_source
    m = re.search(r'^WORKTREE_LINK_DENYLIST="([^"]*)"', bash, re.M)
    assert m, "aide-run-spec no longer declares WORKTREE_LINK_DENYLIST as a plain string"
    from_bash = set(m.group(1).split())

    ts = (workspace_root / "dashboard" / "src" / "project" / "project-admin" / "manifest-io.ts").read_text()
    m = re.search(r"export const WORKTREE_LINK_DENYLIST = \[(.*?)\] as const;", ts, re.S)
    assert m, "manifest-io.ts no longer declares WORKTREE_LINK_DENYLIST as a literal array"
    from_ts = set(re.findall(r'"([^"]+)"', m.group(1)))

    assert from_bash == from_ts, (
        "the script and the dashboard disagree about which worktree links name "
        f"a build output: only in the script {sorted(from_bash - from_ts)}, "
        f"only in the dashboard {sorted(from_ts - from_bash)}"
    )

def test_a_link_naming_a_path_that_is_not_there_is_refused(runner, workspace, fake_claude):
    """One rule, two places that have to agree about it: the dashboard's
    Add reports a configured AIDE_WORKTREE_LINKS entry with no source as
    a reason the project cannot run, and the runner refuses the same
    entry rather than starting a step whose test command will fail for a
    reason that has nothing to do with its change.

    Silently skipping it is what made this worth a rule: the run got a
    worktree with no `node_modules` in it, the project's own test command
    failed, and the step was blamed for it."""
    claude = fake_claude("exit 1")
    (workspace["project"] / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={workspace['specs']}\nAIDE_WORKTREE_LINKS=deps node_modules\n"
    )
    git(workspace["project"], "add", "-f", ".aide/config")
    git(workspace["project"], "commit", "-q", "-m", "a link with no source")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2, out
    assert "node_modules" in out["error"], out
    # The one that IS there is not what the refusal is about.
    assert not fake_claude.calls.exists()

def test_links_that_are_all_there_still_run(runner, workspace, fake_claude):
    """The refusal above must not catch the ordinary case: `deps` exists
    in the fixture, and the run goes ahead."""
    claude, _ = probing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out

@pytest.mark.parametrize("case", PRECEDENCE, ids=[c["name"] for c in PRECEDENCE])
def test_the_worktree_links_are_read_from_the_documented_source(
    runner, workspace, fake_claude, case
):
    """Both columns of the shared table at once: WHICH paths end up
    linked into the worktree, and which file the run says it read them
    from. The manifest wins where both are written — the committed file
    is the one that travels with the repo — and the run naming its source
    is what makes a value shadowed in the other file diagnosable rather
    than silently ignored."""
    configure_links(workspace, case["manifest"], case["config"])
    claude, log = linking_claude(fake_claude, workspace, ["deps", "other-deps"])
    rc, out, _, err = run(runner, workspace, claude, return_stderr=True)
    assert rc == 0, out
    linked = log.read_text().split() if log.exists() else []
    assert sorted(linked) == sorted(case["links"].split()), (
        f"{case['name']}: linked {linked}, expected {case['links'].split()}"
    )
    if case["source"]:
        assert f"read from {case['source']}" in err, err
        assert out["worktreeLinksSource"] == case["source"], out
    else:
        assert "read from" not in err, err
        assert "worktreeLinksSource" not in out, out

def test_a_manifest_link_that_escapes_the_root_is_refused_in_the_manifests_own_words(
    runner, workspace, fake_claude
):
    """The refusal named `AIDE_WORKTREE_LINKS` unconditionally, which is
    the wrong file to go and edit once the value came from the manifest."""
    claude = fake_claude("exit 1")
    (workspace["project"] / ".aide" / "project.yaml").write_text(
        "name: proj\nworktreeLinks: ../escape\n"
    )
    git(workspace["project"], "add", "-f", ".aide/project.yaml")
    git(workspace["project"], "commit", "-q", "-m", "a bad manifest link")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2, out
    assert "../escape" in out["error"], out
    assert "worktreeLinks" in out["error"], out
    assert "AIDE_WORKTREE_LINKS" not in out["error"], out
    assert not fake_claude.calls.exists()

def test_a_manifest_link_with_no_source_is_refused_in_the_manifests_own_words(
    runner, workspace, fake_claude
):
    claude = fake_claude("exit 1")
    (workspace["project"] / ".aide" / "project.yaml").write_text(
        "name: proj\nworktreeLinks: deps node_modules\n"
    )
    git(workspace["project"], "add", "-f", ".aide/project.yaml")
    git(workspace["project"], "commit", "-q", "-m", "a manifest link with no source")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2, out
    assert "node_modules" in out["error"], out
    assert "worktreeLinks" in out["error"], out
    assert "AIDE_WORKTREE_LINKS" not in out["error"], out

def test_aides_own_two_paths_are_both_linked_from_the_manifest(runner, workspace, fake_claude):
    """Spec 184, requirement 3: aide's own settings survive the move,
    including that its links name TWO paths — one of them nested.

    The exact value aide's `.aide/project.yaml` now carries, run against
    a scratch project through the same harness every other case here
    uses. `dashboard/node_modules` is the interesting half: a nested link
    needs its parent directory made in the worktree before the symlink
    can go in, and a reader of a space-separated scalar has to split it
    into two entries rather than one path with a space in it."""
    project = workspace["project"]
    (project / ".venv").mkdir()
    (project / ".venv" / "marker.txt").write_text("the virtualenv\n")
    (project / "dashboard" / "node_modules").mkdir(parents=True)
    (project / "dashboard" / "node_modules" / "marker.txt").write_text("the dep tree\n")
    (project / ".gitignore").write_text("/deps/\n/.venv/\ndashboard/node_modules/\n")
    (project / ".aide" / "project.yaml").write_text(
        "name: aide\nworktreeLinks: .venv dashboard/node_modules\n"
    )
    git(project, "add", "-f", ".aide/project.yaml", ".gitignore")
    git(project, "commit", "-q", "-m", "aide's own links, in the manifest")
    claude, log = linking_claude(fake_claude, workspace, [".venv", "dashboard/node_modules"])
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert sorted(log.read_text().split()) == [".venv", "dashboard/node_modules"], log.read_text()
    assert out["worktreeLinksSource"] == "project.yaml", out

def test_a_config_link_is_still_refused_in_the_configs_own_words(runner, workspace, fake_claude):
    """The fallback keeps its own wording: a project not yet migrated has
    nothing in the manifest to go and edit."""
    claude = fake_claude("exit 1")
    (workspace["project"] / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={workspace['specs']}\nAIDE_WORKTREE_LINKS=deps node_modules\n"
    )
    git(workspace["project"], "add", "-f", ".aide/config")
    git(workspace["project"], "commit", "-q", "-m", "a config link with no source")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2, out
    assert "AIDE_WORKTREE_LINKS" in out["error"], out

@pytest.mark.parametrize(
    "case", READINESS_FIXTURE, ids=[f"{c['check']}: {c['failsWhen']}" for c in READINESS_FIXTURE]
)
def test_a_blocking_readiness_prerequisite_is_refused_by_the_runner(runner, workspace, fake_claude, case):
    key = (case["check"], case["failsWhen"])
    if key in BASH_UNTESTABLE:
        pytest.skip("not reliably triggerable via git-state manipulation — see 2-analysis.md, Findings item 4")
    assert key in READINESS_SCENARIOS, f"no scenario wired up for fixture entry {key!r}"
    assert case["blocking"] is True, "every entry in this fixture is blocking today; a non-blocking one needs its own test shape"
    setup, expect_in_error = READINESS_SCENARIOS[key]
    setup(workspace)
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2, out
    assert expect_in_error in out["error"], out
    assert not fake_claude.calls.exists()

def test_the_runner_starts_when_none_of_the_fixtures_prerequisites_fail(runner, workspace, fake_claude):
    claude, _ = probing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out

def test_a_main_checkout_on_the_spec_branch_is_healed_not_refused(runner, workspace, fake_claude):
    """git refuses to check out one branch in two worktrees. A main
    checkout left on `aide/<spec>` — by a cancel, or by any refusal after
    the branch block in an older version — would lock that branch out of
    every later run, with no self-healing path."""
    git(workspace["project"], "switch", "-q", "-c", BRANCH)
    claude, log = probing_claude(
        fake_claude, workspace,
        extra='echo "written by the step" > "$PWD/new-code.txt"\n',
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert log.read_text().split() == ["main", "main"], "healed before the worktree was made"
    assert "new-code.txt" in git(workspace["project"], "show", "--name-only", "--pretty=", BRANCH)

def test_a_failed_fetch_refuses_rather_than_creating_a_branch_from_a_stale_tip(
    runner, workspace, fake_claude, tmp_path
):
    """A spec branch that does not exist yet has never been fetched from
    origin, so a fetch that fails right here is exactly the case where
    base_ref_for would otherwise fall back to this checkout's own tip
    (spec 347). Unlike the courtesy pull on the main checkout, this one
    refuses rather than proceeding on local state."""
    bare = tmp_path / "gone.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", str(bare))
    git(workspace["project"], "push", "-q", "-u", "origin", "main")
    # The remote is then made unreachable, which is what a fetch failure
    # looks like from here.
    git(workspace["project"], "remote", "set-url", "origin", str(tmp_path / "not-there.git"))

    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace), pull=True)
    assert rc == 2, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "refused"
    assert str(workspace["project"]) in out["error"]
    assert BRANCH not in git(workspace["project"], "branch", "--list"), \
        "a failed fetch must not leave a branch cut from this checkout's own tip"

def test_the_pull_advances_the_default_branch_not_whatever_was_checked_out(
    runner, workspace, fake_claude, tmp_path
):
    """`git pull --ff-only` acts on the CURRENT branch. A main checkout
    stuck on an old spec branch would be advanced on that branch every
    run, and the dashboard would keep listing its archived spec as
    runnable — the second problem this spec exists to fix, surviving the
    fix."""
    bare = tmp_path / "shared.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", str(bare))
    git(workspace["project"], "push", "-q", "-u", "origin", "main")
    # Someone else lands a commit on main.
    other = init_repo(tmp_path / "other-clone")
    git(other, "remote", "add", "origin", str(bare))
    git(other, "fetch", "-q", "origin")
    git(other, "reset", "-q", "--hard", "origin/main")
    (other / "from-elsewhere.txt").write_text("landed on main from another machine\n")
    git(other, "add", "-A")
    git(other, "commit", "-q", "-m", "elsewhere")
    git(other, "push", "-q", "origin", "main")
    # And this checkout is sitting on a stale spec branch.
    git(workspace["project"], "switch", "-q", "-c", "aide/79-yesterdays-spec")

    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace), pull=True)
    assert rc == 0, out
    assert git(workspace["project"], "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert (workspace["project"] / "from-elsewhere.txt").exists(), \
        "the DEFAULT branch is what gets fast-forwarded"

def test_a_new_branch_is_cut_from_origin_not_from_this_checkouts_stale_tracking_ref(
    runner, workspace, fake_claude, tmp_path
):
    """REQ-5 (spec 347): a spec branch created for the first time must
    come from origin's copy of the default branch, never from whatever
    this checkout's own refs/remotes/origin/<base> happened to hold last.
    Pushed here WITHOUT `-u`, so the current branch has no upstream
    tracking configured — the exact condition that used to make the
    courtesy pull skip its fetch silently, leaving this checkout's
    tracking ref stale while origin moved on elsewhere."""
    bare = tmp_path / "shared.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", str(bare))
    git(workspace["project"], "push", "-q", "origin", "main")
    # Someone else lands a commit on main, through a different clone —
    # this checkout's own refs/remotes/origin/main never learns about it
    # until (and unless) a fetch is actually attempted.
    other = init_repo(tmp_path / "other-clone")
    git(other, "remote", "add", "origin", str(bare))
    git(other, "fetch", "-q", "origin")
    git(other, "reset", "-q", "--hard", "origin/main")
    (other / "from-elsewhere.txt").write_text("landed on main from another machine\n")
    git(other, "add", "-A")
    git(other, "commit", "-q", "-m", "elsewhere")
    git(other, "push", "-q", "origin", "main")

    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace), pull=True)
    assert rc == 0, out
    assert subprocess.run(
        ["git", "-C", str(workspace["project"]), "cat-file", "-e", f"{BRANCH}:from-elsewhere.txt"]
    ).returncode == 0, \
        "a brand-new spec branch must be cut from origin's tip, not this checkout's stale tracking ref"

def test_an_untracked_aide_config_is_copied_into_the_worktree(runner, workspace, fake_claude):
    """.aide/config is never tracked, in any project including aide's own
    (spec 345) — so a worktree, which checks out tracked files only, has
    no config at all unless it is copied in. Without that copy
    AIDE_SPECS_PATH and AIDE_TEST_CMD would simply vanish for the step."""
    project = workspace["project"]
    assert git(project, "status", "--porcelain") == ""

    seen = project.parent / "specs-seen.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "%s\\n" "$specs" > {seen}\n'
        + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    resolved = seen.read_text().strip()
    assert resolved.startswith(str(workspace["wtbase"])), resolved
    files = git(project, "show", "--name-only", "--pretty=", BRANCH)
    assert ".aide/config" not in files, files
    assert "new-code.txt" in files

def test_a_gitignored_specs_root_inside_the_project_is_linked_and_not_committed(
    runner, workspace, fake_claude, tmp_path
):
    """aide's own default: `specs/` inside the project and gitignored
    (.gitignore:2). A worktree checks out tracked files only, so the specs
    root would simply not be there — and linking it in walks straight into
    the symlink-is-not-a-directory problem."""
    project = init_repo(tmp_path / "inside")
    (project / ".gitignore").write_text("/specs/\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "ignore specs")
    (project / "specs" / "81-queue-and-runner").mkdir(parents=True)
    (project / "specs" / "81-queue-and-runner" / "1-description.md").write_text("# X\n")
    ws = {
        "project": project, "specs": project / "specs",
        "folder": "81-queue-and-runner", "wtbase": tmp_path / "wt-inside",
    }
    seen = tmp_path / "inside-seen.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        + f'echo "analysis" > "$PWD/specs/{ws["folder"]}/2-analysis.md"\n'
        + f'ls "$PWD/specs" > {seen}\n'
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude)
    assert rc == 0, out
    assert "81-queue-and-runner" in seen.read_text()
    # The analysis reached the REAL specs directory, and nothing about it
    # was committed to the project's branch.
    assert (project / "specs" / "81-queue-and-runner" / "2-analysis.md").exists()
    files = git(project, "show", "--name-only", "--pretty=", BRANCH)
    assert "new-code.txt" in files
    assert "specs/" not in files, files

def test_a_specs_root_outside_any_git_repo_still_receives_the_work(
    runner, workspace, fake_claude, tmp_path
):
    """`specs_repo` empty is a shape that exists today. Such a specs root
    was never committed or pushed by this script, and that has to keep
    being true."""
    project = init_repo(tmp_path / "proj-loose")
    loose = tmp_path / "loose-specs"
    (loose / "81-queue-and-runner").mkdir(parents=True)
    (loose / "81-queue-and-runner" / "1-description.md").write_text("# X\n")
    (project / ".aide").mkdir()
    (project / ".aide" / "config").write_text(f"AIDE_SPECS_PATH={loose}\n")
    git(project, "add", "-f", ".aide/config")
    git(project, "commit", "-q", "-m", "config")
    ws = {
        "project": project, "specs": loose,
        "folder": "81-queue-and-runner", "wtbase": tmp_path / "wt-loose",
    }
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "analysis" > "$specs/{ws["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude)
    assert rc == 0, out
    assert (loose / "81-queue-and-runner" / "2-analysis.md").exists()
    assert [r["root"] for r in out["repos"]] == [str(project)]
