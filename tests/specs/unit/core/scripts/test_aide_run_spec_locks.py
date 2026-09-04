"""Two runs at once: the per-root lock that keeps them out of each
other's worktrees, what happens when one is killed while holding it,
and why two projects never wait for each other.

Split out of test_aide_run_spec_worktrees.py 2026-09-04; the tests are
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
from .conftest import READ_SPECS, git, init_repo, run
from .run_spec_fakes import make_named_writing_claude, make_worktree_add_gate
from .run_spec_invoking import create, wait_until, worktrees
from .run_spec_origins import origin
from .run_spec_results import RESULT_OK


def test_two_runs_on_the_same_repos_do_not_see_each_other(runner, workspace, fake_claude, tmp_path):
    """The measured problem. Two jobs for two specs against one pair of
    repositories used to be impossible; the only honest way to test that
    they are now independent is to run both at once."""
    specs = workspace["specs"]
    second = "82-second-spec"
    (specs / second).mkdir()
    (specs / second / "1-description.md").write_text("# Second - Description\n")
    # Analyzed already: since spec 344 an implement is refused on a spec
    # whose steps line lacks analyze, and both runs here are implements.
    (specs / second / "4-status.md").write_text(
        "# Second - Status\n\n## Tracking info\n\n- **Task:** `82-second-spec/`\n"
        "- **Workflow steps completed:** create, analyze\n"
    )
    git(specs, "add", "-A")
    git(specs, "commit", "-q", "-m", "add second spec")

    gates = {}
    procs = {}
    for folder, name in ((workspace["folder"], "first"), (second, "second")):
        ready, go = tmp_path / f"{name}-ready", tmp_path / f"{name}-go"
        gates[name] = (ready, go)
        body = (
            "cat > /dev/null\n"
            + READ_SPECS
            + f'echo "{name}" > "$PWD/{name}-code.txt"\n'
            + f'echo "{name}" > "$specs/{folder}/2-analysis.md"\n'
            + f"touch {ready}\n"
            + f"while [ ! -f {go} ]; do sleep 0.05; done\n"
            + f"echo '{json.dumps(RESULT_OK)}'\n"
        )
        claude = tmp_path / f"fake-claude-{name}"
        claude.write_text("#!/usr/bin/env bash\n" + body)
        claude.chmod(0o755)
        procs[name] = subprocess.Popen(
            [
                str(runner),
                "--project-dir", str(workspace["project"]),
                "--command", "implement",
                "--spec", folder,
                "--budget-usd", "3",
                "--timeout-sec", "60",
                "--permission-mode", "acceptEdits",
                "--result-file", str(tmp_path / f"result-{name}.json"),
                "--worktree-base", str(workspace["wtbase"]),
            ],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env={**os.environ, "AIDE_CLAUDE_BIN": str(claude)},
        )
    try:
        deadline = time.time() + 60
        while time.time() < deadline and not all(g[0].exists() for g in gates.values()):
            for name, p in procs.items():
                if p.poll() is not None:
                    raise AssertionError(f"{name} ended early: {p.communicate()}")
            time.sleep(0.05)
        assert all(g[0].exists() for g in gates.values()), "both runs must be going at once"
        # BOTH are inside their step, in different checkouts, against the
        # same two repositories.
        assert git(workspace["project"], "rev-parse", "--abbrev-ref", "HEAD") == "main"
        assert git(specs, "rev-parse", "--abbrev-ref", "HEAD") == "main"
    finally:
        for _, go in gates.values():
            go.touch()
        for p in procs.values():
            p.wait(timeout=60)

    for name, p in procs.items():
        out = json.loads(p.stdout.read().strip().splitlines()[-1])
        assert out["terminalReason"] == "completed", (name, out)
    first_branch, second_branch = f"aide/{workspace['folder']}", f"aide/{second}"
    assert "first-code.txt" in git(workspace["project"], "ls-tree", "-r", "--name-only", first_branch)
    assert "second-code.txt" not in git(workspace["project"], "ls-tree", "-r", "--name-only", first_branch)
    assert "second-code.txt" in git(workspace["project"], "ls-tree", "-r", "--name-only", second_branch)
    assert "first-code.txt" not in git(workspace["project"], "ls-tree", "-r", "--name-only", second_branch)

def test_two_runs_against_the_same_project_for_different_specs_do_not_race(
    runner, workspace, tmp_path, origin
):
    """The measured failure (spec 256): spec 249's `implement` and spec
    251's `implement`, both against the "aide" project, raced
    `git worktree add` against the same root and one refused with
    "cannot create $branch in a worktree of $root". Covers acceptance
    criteria 1, 2 and 6."""
    specs = workspace["specs"]
    project = workspace["project"]
    second = "82-second-spec"
    (specs / second).mkdir()
    (specs / second / "1-description.md").write_text("# Second - Description\n")
    # Analyzed already: since spec 344 an implement is refused on a spec
    # whose steps line lacks analyze, and both runs here are implements.
    (specs / second / "4-status.md").write_text(
        "# Second - Status\n\n## Tracking info\n\n- **Task:** `82-second-spec/`\n"
        "- **Workflow steps completed:** create, analyze\n"
    )
    git(specs, "add", "-A")
    git(specs, "commit", "-q", "-m", "add second spec")
    # The `origin` fixture pushed `main` before this commit — a stale
    # `origin/main` would cut the second spec's branch without its own
    # folder, silently dropping every write this test makes into it.
    git(specs, "push", "-q", "origin", "main")

    # Round 1, sequential: give each spec an existing branch, ahead of
    # base and pushed to origin — so round 2 below actually exercises
    # `sync_branch_with_origin`/`branch_already_landed`'s fixed-name temp
    # refs (both early-return as a no-op when there is no origin at all),
    # instead of only the fresh-branch `git worktree add -b` path.
    for folder, name in ((workspace["folder"], "first"), (second, "second")):
        claude = make_named_writing_claude(tmp_path, f"{name}-r1", folder, f"{name}-round1")
        rc, out, _ = run(runner, workspace, claude, spec=folder, command="implement")
        assert rc == 0, out
        branch = f"aide/{folder}"
        git(project, "push", "-q", "origin", branch)
        git(specs, "push", "-q", "origin", branch)

    # Round 2, concurrent: both branches already exist, so this run's
    # loop body actually calls `sync_branch_with_origin`/
    # `branch_already_landed` before its own `git worktree add`.
    events = tmp_path / "events.log"
    events.write_text("")
    project_root = project

    procs, gos = {}, {}
    for folder, name in ((workspace["folder"], "first"), (second, "second")):
        shim_dir, go = make_worktree_add_gate(tmp_path, name, project_root, events)
        gos[name] = go
        claude = make_named_writing_claude(tmp_path, f"{name}-r2", folder, f"{name}-round2")
        env = {
            **os.environ,
            "AIDE_CLAUDE_BIN": str(claude),
            "PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}",
        }
        procs[name] = subprocess.Popen(
            [
                str(runner),
                "--project-dir", str(project),
                "--command", "implement",
                "--spec", folder,
                "--budget-usd", "3",
                "--timeout-sec", "60",
                "--permission-mode", "acceptEdits",
                "--result-file", str(tmp_path / f"result-{name}.json"),
                "--worktree-base", str(workspace["wtbase"]),
            ],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env=env,
        )

    def ready_names():
        return {
            line.split()[0]
            for line in events.read_text().splitlines()
            if line.split()[1:2] == ["ready"]
        }

    try:
        # Either both reach `worktree add` together (no lock — the
        # unmodified script's actual failure mode) or only one does (a
        # working lock blocks the other before it ever reaches git). A
        # short grace window tells the two apart without hardcoding which
        # is true — Step 3 of the implementation plan runs this same test
        # against both states of the script.
        # 120 s, not 30: on the serving host the archive gate runs this
        # suite beside a full bun suite, and a runner took over 30 s to
        # reach its worktree add there (2026-09-02). The bound only has
        # to be finite; it is not part of what the test measures.
        wait_until(
            lambda: len(ready_names()) >= 1, 120,
            "neither run ever reached its own git worktree add call",
        )
        time.sleep(0.3)
        together = ready_names()
        if len(together) == 2:
            for go in gos.values():
                go.touch()
        else:
            first = next(iter(together))
            second_name = "second" if first == "first" else "first"
            gos[first].touch()
            wait_until(
                lambda: second_name in ready_names(), 60,
                f"{second_name} never reached its own worktree add call — "
                "the lock is stuck",
            )
            gos[second_name].touch()
    finally:
        for go in gos.values():
            go.touch()
        for p in procs.values():
            p.wait(timeout=60)

    for name, p in procs.items():
        out = json.loads(p.stdout.read().strip().splitlines()[-1])
        assert out["terminalReason"] == "completed", (name, out, p.stderr.read())

    # Criterion 2: whichever process reached its own worktree add SECOND
    # must not have started it before the FIRST one's had already returned.
    log = [line.split() for line in events.read_text().splitlines() if line.strip()]
    ready_order = [name for name, event in log if event == "ready"]
    if len(ready_order) == 2 and ready_order[0] != ready_order[1]:
        first_name, second_name = ready_order
        first_done_idx = next(
            i for i, (name, event) in enumerate(log) if name == first_name and event == "done"
        )
        second_ready_idx = next(
            i for i, (name, event) in enumerate(log) if name == second_name and event == "ready"
        )
        assert first_done_idx < second_ready_idx, (
            f"{second_name} started its own worktree add before {first_name}'s had "
            f"returned: {log}"
        )

    # Criterion 6: the fixed-name temp refs (refs/aide-branch/tip,
    # refs/aide-branch/landed-base), exercised for real above since both
    # branches pre-existed and were pushed to origin, must not have
    # leaked either run's branch data into the other's.
    first_branch, second_branch = f"aide/{workspace['folder']}", f"aide/{second}"
    first_files = git(project, "ls-tree", "-r", "--name-only", first_branch)
    second_files = git(project, "ls-tree", "-r", "--name-only", second_branch)
    assert "first-round2.txt" in first_files
    assert "second-round2.txt" not in first_files
    assert "second-round2.txt" in second_files
    assert "first-round2.txt" not in second_files

def test_locks_for_different_projects_do_not_block_each_other(runner, tmp_path, fake_claude):
    """Two entirely separate project roots must never wait on each
    other's worktree lock — `"$root/.git/aide-run-spec-worktree.lock"` is
    scoped by root path, so this holds by construction, but a bug that
    made the lock's path anything less specific (a fixed name, a hash
    collision) would silently re-serialize unrelated projects. Covers
    acceptance criterion 3."""
    events = tmp_path / "events.log"
    events.write_text("")
    claude_ok = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")

    procs, gos = {}, {}
    for name in ("first", "second"):
        project = init_repo(tmp_path / f"proj-{name}")
        specs = init_repo(tmp_path / f"specs-{name}")
        folder = f"{name}-spec"
        (specs / folder).mkdir()
        (specs / folder / "1-description.md").write_text("# Description\n")
        git(specs, "add", "-A")
        git(specs, "commit", "-q", "-m", "add spec")
        (project / ".aide").mkdir()
        (project / ".aide" / "config").write_text(f"AIDE_SPECS_PATH={specs}\n")
        git(project, "add", "-f", ".aide/config")
        git(project, "commit", "-q", "-m", "add config")

        shim_dir, go = make_worktree_add_gate(tmp_path, name, project, events)
        gos[name] = go
        env = {
            **os.environ,
            "AIDE_CLAUDE_BIN": str(claude_ok),
            "PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}",
        }
        procs[name] = subprocess.Popen(
            [
                str(runner),
                "--project-dir", str(project),
                "--command", "analyze",
                "--spec", folder,
                "--budget-usd", "3",
                "--timeout-sec", "60",
                "--permission-mode", "acceptEdits",
                "--result-file", str(tmp_path / f"result-{name}.json"),
                "--worktree-base", str(tmp_path / "worktrees"),
            ],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env=env,
        )

    def ready_names():
        return {
            line.split()[0]
            for line in events.read_text().splitlines()
            if line.split()[1:2] == ["ready"]
        }

    try:
        wait_until(
            lambda: len(ready_names()) == 2, 10,
            "different projects' worktree locks blocked each other",
        )
    finally:
        for go in gos.values():
            go.touch()
        for p in procs.values():
            p.wait(timeout=60)

    for name, p in procs.items():
        out = json.loads(p.stdout.read().strip().splitlines()[-1])
        assert out["terminalReason"] == "completed", (name, out, p.stderr.read())

def test_a_stale_lock_left_by_a_killed_run_is_reclaimed_without_waiting(
    runner, workspace, fake_claude
):
    """A run `SIGKILL`ed while holding the lock cannot release it — the
    same constraint `sweep_worktree` already lives with for a killed run's
    leftover worktree. The next run must reclaim a stale lock (owner pid
    no longer alive) immediately rather than waiting out the full
    timeout. Covers acceptance criterion 4."""
    dead = subprocess.Popen(["true"])
    dead.wait()
    dead_pid = dead.pid

    lock = workspace["project"] / ".git" / "aide-run-spec-worktree.lock"
    lock.mkdir()
    (lock / "pid").write_text(str(dead_pid))

    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    started = time.time()
    rc, out, _ = run(runner, workspace, claude)
    elapsed = time.time() - started

    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert elapsed < 90, (
        f"a stale lock (dead owner pid) must be reclaimed immediately, not "
        f"waited out: took {elapsed:.1f}s"
    )
    # The distinguishing assertion: on the unmodified script nothing ever
    # touches this manually-created directory, so it would still be sitting
    # there after the run. A working reclaim removes it, uses it, and
    # releases it again before the run ends.
    assert not lock.exists(), (
        "the stale lock must be reclaimed and then released, not left in place"
    )

def test_a_run_killed_with_sigterm_while_holding_the_lock_releases_it(
    runner, workspace, fake_claude, tmp_path
):
    """Acceptance criterion 5: a run that acquires the lock and is then
    killed with `SIGTERM` (the deadline/cancel path this script already
    handles) must release it through the existing `EXIT` trap — otherwise
    the next run waits out the full stale-lock timeout for a lock nobody
    will ever release, exactly the "leftover a killed run cannot clean
    up" shape `sweep_worktree` already lives with for the worktree
    itself.

    A `git` shim pauses the run right before its own `worktree add` call
    — by then `acquire_worktree_lock` has already succeeded, so the
    victim genuinely holds the lock — then `SIGTERM` is sent to the run
    itself. Bash only runs a pending trap once its current foreground
    command (the paused `git`) returns, so the shim's own gate is
    released right after, letting the run's `on_signal` handler fire and
    exit through the `EXIT` trap without ever reaching its own
    `release_worktree_lock` call at the bottom of the loop — this is
    what proves the release happens via the TRAP, not the ordinary path.
    """
    project = workspace["project"]
    events = tmp_path / "events.log"
    events.write_text("")
    shim_dir, go = make_worktree_add_gate(tmp_path, "victim", project, events)
    env = {
        **os.environ,
        # A real, executable stand-in — the runner checks it exists before
        # ever reaching the worktree loop. It is never actually invoked:
        # the run is killed before claude would spawn.
        "AIDE_CLAUDE_BIN": str(fake_claude("exit 1")),
        "PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}",
    }
    proc = subprocess.Popen(
        [
            str(runner),
            "--project-dir", str(project),
            "--command", "analyze",
            "--spec", workspace["folder"],
            "--budget-usd", "3",
            "--timeout-sec", "60",
            "--permission-mode", "acceptEdits",
            "--result-file", str(tmp_path / "result-victim.json"),
            "--worktree-base", str(workspace["wtbase"]),
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        env=env,
    )
    lock = project / ".git" / "aide-run-spec-worktree.lock"
    try:
        wait_until(
            lambda: "victim ready" in events.read_text(), 30,
            "the run never reached its own git worktree add call",
        )
        # On the unmodified script nothing ever creates this directory, so
        # this is where a run without the fix already fails — the SIGTERM
        # below would otherwise "release" a lock that was never held,
        # passing for the wrong reason.
        assert lock.exists(), (
            "acquire_worktree_lock must have created the lock by the time "
            "the run reaches its own worktree add"
        )
        proc.send_signal(signal.SIGTERM)
        go.touch()
        proc.wait(timeout=30)
    finally:
        go.touch()
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)

    assert not lock.exists(), (
        "a run killed with SIGTERM while holding the lock must release it "
        "through the EXIT trap"
    )

    ok_claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    started = time.time()
    rc2, out2, _ = run(runner, workspace, ok_claude)
    elapsed = time.time() - started

    assert rc2 == 0, out2
    assert out2["terminalReason"] == "completed"
    assert elapsed < 90, (
        "the second run waited on a lock the first run's EXIT trap should "
        f"have released: {elapsed:.1f}s"
    )
