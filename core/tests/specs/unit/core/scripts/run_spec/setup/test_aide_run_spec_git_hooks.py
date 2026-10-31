"""The runner's own git runs no hooks.

A hook is a program git starts on its own, and the runner runs git outside
the sandbox. A hook that reads the working tree — a relative
`core.hooksPath`, lefthook's `lefthook.yml` — runs whatever the step wrote
there, so the runner turns hooks off for every git command of its own.
What it starts itself (the AI tool, the project's tests) is left alone.
"""

import json
import shlex

from ...conftest import git, run
from ..run_spec_origins import fetchable_origin_both_roots
from ..run_spec_results import RESULT_OK


def _planting_claude(fake_claude, marker):
    """A step that adds hooks to its worktree, each of which leaves a mark."""
    hook = shlex.quote(f'#!/bin/sh\necho "$0" >> {shlex.quote(str(marker))}\n')
    return fake_claude(
        "cat > /dev/null\n"
        'mkdir -p "$PWD/.githooks"\n'
        "for h in pre-commit commit-msg post-commit pre-push post-checkout; do\n"
        f'  printf %s {hook} > "$PWD/.githooks/$h"; chmod +x "$PWD/.githooks/$h"\n'
        "done\n"
        'echo "written by the step" > "$PWD/new-code.txt"\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )


def test_hooks_the_step_wrote_do_not_run_when_the_runner_commits_and_pushes(
    runner, workspace, fake_claude, fetchable_origin_both_roots, tmp_path
):
    marker = tmp_path / "hooks-that-ran.txt"
    git(workspace["project"], "config", "core.hooksPath", ".githooks")
    rc, out, _ = run(runner, workspace, _planting_claude(fake_claude, marker),
                     push="branch", command="implement")
    assert rc == 0, out
    assert out["ok"] is True, (out.get("terminalReason"), out.get("pushError"), out.get("error"))
    pushed = git(fetchable_origin_both_roots["project"], "ls-tree", "-r", "--name-only",
                 "aide/81-queue-and-runner")
    assert "new-code.txt" in pushed, "the step's work was committed and pushed"
    assert not marker.exists(), marker.read_text()


def test_the_steps_own_git_still_runs_its_hooks(runner, workspace, fake_claude, tmp_path):
    """Only the runner's own git is changed: a command the step runs is
    the step's, and runs inside the sandbox with the repository's hooks.
    Each hook writes the git command that started it."""
    marker = tmp_path / "hooks-that-ran.txt"
    hook = f'#!/bin/sh\nps -o command= -p "$PPID" >> {shlex.quote(str(marker))}\n'
    git(workspace["project"], "config", "core.hooksPath", ".githooks")
    claude = fake_claude(
        "cat > /dev/null\n"
        'mkdir -p "$PWD/.githooks"\n'
        f'printf %s {shlex.quote(hook)} > "$PWD/.githooks/pre-commit"\n'
        'chmod +x "$PWD/.githooks/pre-commit"\n'
        'echo "written by the step" > "$PWD/new-code.txt"\n'
        'git add new-code.txt && git commit -q -m "The step commits its own work"\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    started_by = marker.read_text().splitlines()
    assert started_by, "the step's own commit ran its pre-commit hook"
    assert set(started_by) == {"git commit -q -m The step commits its own work"}
