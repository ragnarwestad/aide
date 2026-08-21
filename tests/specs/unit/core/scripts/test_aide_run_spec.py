"""Tests for core/scripts/aide-run-spec — the one-shot headless runner
(spec 81, slice 81b).

Criteria 1-4. No test here calls the real Claude CLI: a fake binary on
AIDE_CLAUDE_BIN records its argv and prints a canned result, so the
default suite stays free (pytest.ini deselects the paid markers for the
same reason).

The script's job is the GUARDS, not the invocation — an unguarded
`claude -p` is one line and needs no script. So most of this file is
about what it REFUSES to do, and about leaving the machine in a state
the next run can start from.
"""
import json
import os
import pathlib
import shlex
import subprocess
import time

import pytest


@pytest.fixture
def runner(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-run-spec"


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def init_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "-C", str(path), "init", "-q", "-b", "main"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.name", "Test"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.email", "test@example.com"], check=True)
    (path / "README.md").write_text("start\n")
    subprocess.run(["git", "-C", str(path), "add", "README.md"], check=True)
    subprocess.run(["git", "-C", str(path), "commit", "-qm", "init"], check=True)
    return path


@pytest.fixture
def workspace(tmp_path):
    """A project repo plus a SEPARATE specs repo, the way a real aide
    project is laid out (AIDE_SPECS_PATH in .aide/config).

    Since spec 91 the project also carries a gitignored dependency
    directory and an AIDE_WORKTREE_LINKS line naming it: a worktree
    checks out TRACKED files only, so anything a test run needs — `.venv`
    here, `deps/` in the fixture — has to be linked in or it is simply
    absent.
    """
    project = init_repo(tmp_path / "proj")
    specs = init_repo(tmp_path / "specs")
    (specs / "81-queue-and-runner").mkdir()
    (specs / "81-queue-and-runner" / "1-description.md").write_text("# Queue - Description\n")
    subprocess.run(["git", "-C", str(specs), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(specs), "commit", "-qm", "add spec"], check=True)
    (project / ".gitignore").write_text("/deps/\n")
    (project / "deps").mkdir()
    (project / "deps" / "marker.txt").write_text("the dependency tree\n")
    (project / ".aide").mkdir()
    (project / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={specs}\nAIDE_WORKTREE_LINKS=deps\n"
    )
    # -f: the user's global gitignore covers .aide/config, and an
    # untracked file would read as a dirty tree here.
    subprocess.run(["git", "-C", str(project), "add", "-f", ".aide/config", ".gitignore"], check=True)
    subprocess.run(["git", "-C", str(project), "commit", "-qm", "add config"], check=True)
    return {
        "project": project,
        "specs": specs,
        "folder": "81-queue-and-runner",
        "wtbase": tmp_path / "worktrees",
    }


# The fake `claude` writes RELATIVE to its own working directory, and
# resolves the specs root the way a skill does: out of the .aide/config
# it finds there. Writing by absolute path into the main checkouts —
# which is what these tests did before spec 91 — writes to the wrong tree
# the moment the step runs in a worktree, and the run would then commit
# nothing while reporting success.
READ_SPECS = 'specs="$(sed -n "s|^AIDE_SPECS_PATH=||p" "$PWD/.aide/config" | head -1)"\n'


RESULT_OK = {
    "type": "result", "subtype": "success", "is_error": False,
    "session_id": "ee80227f-510c-45e9-bfbf-c5124f7761c0",
    "total_cost_usd": 0.5357, "num_turns": 1, "terminal_reason": "completed",
    "result": "done",
}
RESULT_BUDGET = {
    "type": "result", "subtype": "error_max_budget_usd", "is_error": True,
    "session_id": "f632eed3-5d7a-40f2-bb40-e3ad6139b8d7",
    "total_cost_usd": 0.2030, "terminal_reason": "budget_exhausted",
    "errors": ["Reached maximum budget ($0.2)"],
}
# What a real result event carries beside the cost, read off an actual
# transcript on this machine (2026-08-19, `claude` 2.1.x): `modelUsage`
# is the SESSION's total, keyed by model and named in camelCase, while
# the flat `usage` block is the last turn's alone. Two models here on
# purpose — a run that switched model mid-session has a block each, and
# reading only the first would under-report every one of them.
MODEL_USAGE = {
    "claude-opus-5": {
        "inputTokens": 86, "outputTokens": 60258,
        "cacheReadInputTokens": 4492445, "cacheCreationInputTokens": 383592,
        "webSearchRequests": 0, "costUSD": 3.93,
    },
    "claude-haiku-4-5": {
        "inputTokens": 14, "outputTokens": 742,
        "cacheReadInputTokens": 5555, "cacheCreationInputTokens": 408,
        "webSearchRequests": 0, "costUSD": 0.01,
    },
}
# The same event's flat block: snake_case, and only what the LAST turn
# used. It is the fallback, never the first choice.
FLAT_USAGE = {
    "input_tokens": 54, "output_tokens": 22054,
    "cache_read_input_tokens": 3177754, "cache_creation_input_tokens": 107458,
    "service_tier": "standard",
}


@pytest.fixture
def fake_claude(tmp_path):
    """Factory for a stand-in `claude`. Records argv, then behaves as
    asked."""
    calls = tmp_path / "claude-calls.txt"

    def make(body: str):
        path = tmp_path / "fake-claude"
        path.write_text(
            "#!/usr/bin/env bash\n"
            f'printf "%s\\n" "$*" >> {calls}\n'
            f'printf "%s\\n" "$PWD" >> {tmp_path / "claude-cwd.txt"}\n'
            # The worktree is gone by the time a test reads anything, so
            # what has to be observed DURING the run is recorded here.
            f'git rev-parse --abbrev-ref HEAD >> {tmp_path / "claude-branch.txt"} 2>/dev/null\n'
            f'git rev-parse --show-toplevel >> {tmp_path / "claude-toplevel.txt"} 2>/dev/null\n'
            f'env >> {tmp_path / "claude-env.txt"}\n'
            f"{body}\n"
        )
        path.chmod(0o755)
        return path

    make.calls = calls  # type: ignore[attr-defined]
    make.cwd_log = tmp_path / "claude-cwd.txt"  # type: ignore[attr-defined]
    make.env_log = tmp_path / "claude-env.txt"  # type: ignore[attr-defined]
    make.branch_log = tmp_path / "claude-branch.txt"  # type: ignore[attr-defined]
    make.toplevel_log = tmp_path / "claude-toplevel.txt"  # type: ignore[attr-defined]
    return make


# --- spec 125: the same fixture pattern, for the second tool ------------------
#
# Codex's non-interactive mode (`codex exec --json`) writes JSONL to
# stdout the way `claude -p --output-format stream-json` does, but the
# events are a different shape: a `thread.started` carrying Codex's own
# thread id, `item.*` events for what it did, and a closing
# `turn.completed` carrying the usage block. Every field below was read
# off the installed CLI (`codex-cli 0.147.0`, 2026-08-20) rather than
# assumed — the event names and the four `usage` keys are in the
# binary's own strings.
CODEX_USAGE = {
    "input_tokens": 4210,
    "cached_input_tokens": 3900,
    "output_tokens": 812,
    "reasoning_output_tokens": 640,
}
CODEX_THREAD_ID = "0199f4c2-6d1a-7c31-9f0e-2b7a5c8d1e44"
def emits(stream: str) -> str:
    """A fake-binary body that consumes the prompt and prints `stream`
    verbatim. One `printf` argument per line: a single quoted blob would
    reach bash with its `\\n` escapes intact and print one long line,
    which parses as nothing at all."""
    args = " ".join(shlex.quote(l) for l in stream.split("\n"))
    return f"cat > /dev/null; printf '%s\\n' {args}"


CODEX_STREAM_OK = "\n".join(
    json.dumps(e)
    for e in [
        {"type": "thread.started", "thread_id": CODEX_THREAD_ID},
        {"type": "turn.started"},
        {"type": "item.completed", "item": {"id": "item_0", "item_type": "agent_message", "text": "done"}},
        {"type": "turn.completed", "usage": CODEX_USAGE},
    ]
)
CODEX_STREAM_FAILED = "\n".join(
    json.dumps(e)
    for e in [
        {"type": "thread.started", "thread_id": CODEX_THREAD_ID},
        {"type": "turn.failed", "error": {"message": "the model refused the turn"}},
    ]
)


@pytest.fixture
def fake_codex(tmp_path):
    """Factory for a stand-in `codex`, mirroring `fake_claude`. Records
    argv, then behaves as asked."""
    calls = tmp_path / "codex-calls.txt"

    def make(body: str):
        path = tmp_path / "fake-codex"
        path.write_text(
            "#!/usr/bin/env bash\n"
            f'printf "%s\\n" "$*" >> {calls}\n'
            f'printf "%s\\n" "$PWD" >> {tmp_path / "codex-cwd.txt"}\n'
            f"{body}\n"
        )
        path.chmod(0o755)
        return path

    make.calls = calls  # type: ignore[attr-defined]
    make.cwd_log = tmp_path / "codex-cwd.txt"  # type: ignore[attr-defined]
    return make


def run(runner, ws, claude=None, codex=None, **kwargs):
    """Invoke the runner; return (returncode, parsed json line, stdout).

    `codex=` is the sibling of `claude=` and exists for the same reason
    (spec 125): the helper has no generic `env=` kwarg, so a Codex test
    would otherwise have no way to point the runner at its fake binary.
    """
    args = [str(kwargs.pop("runner_path", runner))]
    defaults = {
        "--project-dir": str(ws["project"]),
        "--command": "analyze",
        "--spec": ws["folder"],
        "--budget-usd": "3",
        "--timeout-sec": "30",
        "--permission-mode": "acceptEdits",
        "--result-file": str(ws["project"].parent / "result.json"),
        # Never $HOME/aide-worktrees in a test: a suite that writes there
        # would fight the machine's own runs.
        "--worktree-base": str(ws["wtbase"]),
    }
    for key, value in kwargs.items():
        flag = "--" + key.replace("_", "-")
        if value is None:
            defaults.pop(flag, None)
        elif value is True:
            defaults[flag] = None
        else:
            defaults[flag] = str(value)
    for flag, value in defaults.items():
        args.append(flag)
        if value is not None:
            args.append(value)
    env = dict(os.environ)
    if claude:
        env["AIDE_CLAUDE_BIN"] = str(claude)
    if codex:
        env["AIDE_CODEX_BIN"] = str(codex)
    proc = subprocess.run(args, capture_output=True, text=True, env=env)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


# --- Criterion 1: the dry run ------------------------------------------------

def test_dry_run_prints_the_argv_it_would_use_and_spawns_nothing(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(
        runner, workspace, claude,
        command="implement", budget_usd="3", timeout_sec="1200",
        permission_mode="bypassPermissions", dry_run=True,
    )
    assert rc == 0
    argv = out["argv"]
    assert argv[0] == str(claude), "the claude path must be resolved, never a bare name"
    assert "-p" in argv
    # stream-json is the only format that emits anything DURING the run,
    # and print mode refuses it without --verbose (probed against the
    # real CLI 2026-08-16, version 2.1.233).
    assert argv[argv.index("--output-format") + 1] == "stream-json"
    assert "--verbose" in argv
    assert argv[argv.index("--max-budget-usd") + 1] == "3"
    assert argv[argv.index("--permission-mode") + 1] == "bypassPermissions"
    # The spec ID is the folder's numeric prefix, and the prompt SAYS the
    # run is headless rather than leaving it in the environment.
    assert out["prompt"].startswith("/aide-implement 81")
    assert "headless" in out["prompt"].lower()
    assert not fake_claude.calls.exists(), "a dry run must not invoke claude"


def test_the_prompt_itself_says_nobody_can_answer(runner, workspace, fake_claude):
    """AIDE_HEADLESS in the environment was not enough: a skill has to
    remember to go and read it, and on 2026-08-17 an archive run read
    ABOUT the variable while analysing spec 88 and never checked its own.
    It then stopped to ask a question nobody could answer, and reported
    success. A fact the model must act on belongs in the text it is
    given, not in a place it has to think to look."""
    claude = fake_claude("cat > /dev/null\nexit 1")
    rc, out, _ = run(runner, workspace, claude, dry_run=True)
    assert rc == 0
    prompt = out["prompt"]
    assert prompt.startswith("/aide-analyze 81"), prompt
    lowered = prompt.lower()
    assert "headless" in lowered
    # And it must say what follows from it, not merely name the state.
    assert "no one" in lowered or "nobody" in lowered


# --- Criterion 2: the refusals -----------------------------------------------

def test_a_dirty_project_tree_does_not_stop_the_run(runner, workspace, fake_claude):
    """Spec 144. The run works in a worktree cut from origin's default
    branch, so nothing in the main checkout reaches it — dirty or not.
    A stray file used to refuse every job touching the repo, however
    unrelated it was to the spec being run."""
    (workspace["project"] / "scratch.txt").write_text("uncommitted\n")
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert not out.get("error"), out["error"]
    # And the stray file is left exactly as it was: never staged,
    # committed, or removed.
    assert (workspace["project"] / "scratch.txt").read_text() == "uncommitted\n"
    assert git(workspace["project"], "status", "--porcelain") == "?? scratch.txt"
    branch = "aide/81-queue-and-runner"
    assert "scratch.txt" not in git(workspace["project"], "show", "--name-only", "--pretty=", branch)


def test_a_dirty_specs_root_does_not_stop_the_run(runner, workspace, fake_claude):
    """The specs repo is where /aide-analyze actually writes, so it was
    the root the old refusal guarded hardest. Its worktree is cut from
    origin's default branch too (spec 144)."""
    (workspace["specs"] / "stray.md").write_text("uncommitted\n")
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert not out.get("error"), out["error"]
    assert (workspace["specs"] / "stray.md").read_text() == "uncommitted\n"
    assert git(workspace["specs"], "status", "--porcelain") == "?? stray.md"


@pytest.mark.parametrize(
    "kwargs,fragment",
    [
        ({"budget_usd": None}, "budget"),
        ({"permission_mode": None}, "permission"),
        ({"timeout_sec": None}, "timeout"),
        ({"result_file": None}, "result-file"),
        ({"command": "review"}, "command"),
        ({"spec": "99-nope"}, "spec"),
    ],
)
def test_refuses_bad_arguments(runner, workspace, fake_claude, kwargs, fragment):
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, **kwargs)
    assert rc == 2, out
    assert out["ok"] is False
    assert fragment in out["error"].lower()
    assert not fake_claude.calls.exists()


def test_refuses_a_directory_that_is_not_a_git_repo(runner, workspace, fake_claude, tmp_path):
    claude = fake_claude("exit 1")
    plain = tmp_path / "plain"
    plain.mkdir()
    rc, out, _ = run(runner, {**workspace, "project": plain}, claude)
    assert rc == 2
    assert "git" in out["error"].lower()


# --- Criterion 3: carrying the result through --------------------------------

def test_a_successful_run_carries_cost_session_and_subtype(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"
    assert out["subtype"] == "success"
    assert out["sessionId"] == RESULT_OK["session_id"]
    assert out["costUsd"] == pytest.approx(0.5357)
    assert out["costMeasured"] is True
    roots = {r["root"]: r for r in out["repos"]}
    assert str(workspace["project"]) in roots
    assert str(workspace["specs"]) in roots


# --- spec 118: the tokens beside the dollars ---------------------------------
#
# On a subscription plan the dollar figure is notional and the token
# count is what the plan meters, so the run records both. A token figure
# can only ever be MEASURED — there is no equivalent of the over-charge
# rule that gives a killed run an assumed cost — which is why the three
# tests below are as much about when the field is ABSENT as about what it
# holds.

def test_a_successful_run_records_the_tokens_every_model_used(runner, workspace, fake_claude):
    result = {**RESULT_OK, "modelUsage": MODEL_USAGE, "usage": FLAT_USAGE}
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(result)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    tokens = out["tokens"]
    # Summed across models, not taken from the first one.
    assert tokens["input"] == 100
    assert tokens["output"] == 61_000
    assert tokens["cacheRead"] == 4_498_000
    assert tokens["cacheCreation"] == 384_000
    # Every token the call actually processed, cached or not: that is
    # what a subscription plan meters.
    assert tokens["total"] == 100 + 61_000 + 4_498_000 + 384_000
    # And the cost is untouched beside it — this adds a figure, it does
    # not replace one.
    assert out["costUsd"] == pytest.approx(0.5357)


def test_a_result_with_only_a_flat_usage_block_still_records_tokens(runner, workspace, fake_claude):
    """`modelUsage` first, the flat `usage` second. An implementation
    that reads only the per-model block would leave this run with no
    figure at all, so the fallback needs its own case: the priority
    order is invisible to every other test here."""
    result = {**RESULT_OK, "usage": FLAT_USAGE}
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(result)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    tokens = out["tokens"]
    assert tokens["input"] == 54
    assert tokens["output"] == 22_054
    assert tokens["cacheRead"] == 3_177_754
    assert tokens["cacheCreation"] == 107_458
    assert tokens["total"] == 54 + 22_054 + 3_177_754 + 107_458


def test_a_result_with_no_usage_at_all_records_no_tokens(runner, workspace, fake_claude):
    """ABSENT, not zero. A zero would be read as "this step used
    nothing", and the dashboard shows a dash for a field that is not
    there — the same contract a missing cost already has."""
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert "tokens" not in out


def test_the_run_happens_inside_the_project_not_the_callers_directory(runner, workspace, fake_claude):
    """A skill resolves the project from its working directory. The
    first real job ran with the server's cwd and analysed the wrong
    repository — it cost $0.45 to find out, so it gets a test.

    Since spec 91 the directory is the project's WORKTREE rather than its
    main checkout (criterion 2), but the property is the same one: the
    step must stand in the tree the run will commit from.
    """
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    cwd = fake_claude.cwd_log.read_text().strip()
    assert cwd != str(workspace["project"].resolve()), "the step must not stand in the main checkout"
    assert cwd.startswith(str(workspace["wtbase"])), cwd
    assert fake_claude.branch_log.read_text().strip() == "aide/81-queue-and-runner"
    assert fake_claude.toplevel_log.read_text().strip() == cwd, "and it is a checkout of its own"


def test_the_child_process_always_gets_aide_headless(runner, workspace, fake_claude):
    """This runner is the only caller that runs a workflow step with
    nobody there to answer. A skill cannot tell that from inside, so the
    runner states it: three archive jobs stopped on a confirmation
    question, reported `done` and moved nothing."""
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert "AIDE_HEADLESS=1" in fake_claude.env_log.read_text().splitlines()


def test_survives_its_own_file_being_replaced_mid_run(runner, workspace, fake_claude, tmp_path):
    """An aide `implement` step reinstalls aide, which copies this very
    script over itself. Bash reads a script incrementally from disk, so
    without a private copy the runner dies mid-job — measured on the
    first end-to-end run, eight minutes in, after the work had already
    succeeded."""
    copy = tmp_path / "aide-run-spec-under-test"
    copy.write_bytes(pathlib.Path(runner).read_bytes())
    copy.chmod(0o755)
    # The shared library lives beside the script; the copy resolves it
    # from the ORIGINAL directory, so give this stand-in one too.
    (tmp_path / "_aide-spec-lib.sh").write_bytes(
        (pathlib.Path(runner).parent / "_aide-spec-lib.sh").read_bytes()
    )
    # The fake claude overwrites the running script, exactly as the
    # installer would.
    claude = fake_claude(
        "cat > /dev/null\n"
        f'printf "#!/bin/bash\\necho REPLACED\\n" > {copy}\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, runner_path=copy)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", "the run must finish even though its file was replaced"
    assert copy.read_text().startswith("#!/bin/bash"), "the replacement really happened"


def test_a_stale_self_copy_marker_never_deletes_the_installed_script(runner, workspace, fake_claude, tmp_path):
    """The private copy unlinks itself, and it recognises itself by an
    environment variable. That variable is inherited by everything the
    step spawns — including `claude` — so a nested run (a test, a
    terminal inside the run, the next job) would think the INSTALLED
    script was the throwaway copy and delete it. Measured 2026-08-16:
    one test run removed core/scripts/aide-run-spec from the worktree.
    """
    copy = tmp_path / "aide-run-spec-under-test"
    copy.write_bytes(pathlib.Path(runner).read_bytes())
    copy.chmod(0o755)
    (tmp_path / "_aide-spec-lib.sh").write_bytes(
        (pathlib.Path(runner).parent / "_aide-spec-lib.sh").read_bytes()
    )
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    env_marker = str(tmp_path / "some-other-path")
    old = os.environ.get("AIDE_RUN_SPEC_SELF_COPY")
    os.environ["AIDE_RUN_SPEC_SELF_COPY"] = env_marker
    try:
        rc, out, _ = run(runner, workspace, claude, runner_path=copy)
    finally:
        if old is None:
            os.environ.pop("AIDE_RUN_SPEC_SELF_COPY", None)
        else:
            os.environ["AIDE_RUN_SPEC_SELF_COPY"] = old
    assert rc == 0, out
    assert copy.exists(), "the script the caller pointed at must survive its own run"


def test_the_self_copy_marker_does_not_reach_the_step(runner, workspace, fake_claude, tmp_path):
    """Belt and braces for the same bug: the marker must not be in the
    environment claude runs in, or anything that step starts inherits
    it."""
    seen = tmp_path / "marker-seen.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        f'printf "%s\\n" "${{AIDE_RUN_SPEC_SELF_COPY:-none}}" > {seen}\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert seen.read_text().strip() == "none"


def test_a_run_starts_from_the_default_branch_not_the_last_job_s(runner, workspace, fake_claude):
    """The previous job leaves its spec branch checked out. Starting
    there would base new work on stale code — and if that branch was
    merged and deleted upstream, the pull fails outright, which is how
    this was found.

    Restated for spec 91: the step no longer runs in the main checkout at
    all, so what is asserted is the branch the WORKTREE was cut from. The
    main checkout's own branch is criterion 1's business.
    """
    stale = "aide/99-previous-job"
    subprocess.run(["git", "-C", str(workspace["project"]), "switch", "-q", "-c", stale], check=True)
    (workspace["project"] / "leftover.txt").write_text("from the last job\n")
    subprocess.run(["git", "-C", str(workspace["project"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["project"]), "commit", "-qm", "old work"], check=True)

    saw = workspace["project"].parent / "saw-leftover.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        f'test -f "$PWD/leftover.txt" && echo yes > {saw}\n'
        f'echo "written by the step" > "$PWD/new-code.txt"\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    # The worktree came off main, so the previous job's file is absent.
    assert not saw.exists(), "the step must not see the previous job's work"
    # And the main checkout is on the default branch, so the NEXT job
    # does not inherit this one either.
    assert git(workspace["project"], "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert stale in git(workspace["project"], "branch", "--list", stale)


def test_budget_exhausted_is_stopped_not_a_generic_failure(runner, workspace, fake_claude):
    """A cap-stop is a common, healthy outcome under tight caps. It must
    be distinguishable from an agent that broke."""
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_BUDGET)}'; exit 1")
    rc, out, _ = run(runner, workspace, claude)
    assert out["terminalReason"] == "budget"
    assert out["subtype"] == "error_max_budget_usd"
    assert out["costUsd"] == pytest.approx(0.2030)
    assert out["costMeasured"] is True


def test_the_result_file_is_written_as_well_as_stdout(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    result_file = workspace["project"].parent / "result.json"
    rc, out, _ = run(runner, workspace, claude, result_file=result_file)
    assert result_file.exists(), "a detached child has no pipe home: the file IS the contract"
    assert json.loads(result_file.read_text())["sessionId"] == out["sessionId"]


def test_work_is_committed_on_a_branch_in_both_roots(runner, workspace, fake_claude):
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    # The work is ON the branch; the main checkout never left main.
    assert git(workspace["project"], "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert git(workspace["specs"], "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert "analyze" in git(workspace["project"], "log", "-1", "--pretty=%s", branch)
    # The specs repo is branched too, and handed back on main — the
    # analysis lives on the branch, not on main.
    assert "analyze" in git(workspace["specs"], "log", "-1", "--pretty=%s", branch)
    assert "analyze" not in git(workspace["specs"], "log", "-1", "--pretty=%s", "main")
    # Both roots clean afterwards: a run commits its own work on the
    # branch and leaves nothing behind in the main checkouts, so a later
    # reader of either tree sees only what was there before.
    assert git(workspace["project"], "status", "--porcelain") == ""
    assert git(workspace["specs"], "status", "--porcelain") == ""
    roots = {r["root"]: r for r in out["repos"]}
    assert roots[str(workspace["project"])]["changedFiles"] == 1
    assert roots[str(workspace["specs"])]["changedFiles"] == 1


# --- Criterion 4: the graceful stop ------------------------------------------

def test_a_run_past_its_deadline_is_killed_and_reported_as_stopped(runner, workspace, fake_claude):
    claude = fake_claude(
        "cat > /dev/null\n"
        'echo "half-written" > "$PWD/half.txt"\n'
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    started = time.time()
    rc, out, _ = run(runner, workspace, claude, timeout_sec="2", kill_grace_sec="1")
    elapsed = time.time() - started

    assert out["terminalReason"] == "timeout"
    assert out["ok"] is False
    # A SIGKILLed claude prints nothing, so the cost cannot be measured.
    # The accounting must over-charge what it could not measure.
    assert out["costUsd"] == pytest.approx(3.0)
    assert out["costMeasured"] is False
    # And no token figure at all. A cost may be assumed — that is the
    # over-charge rule — but a token count may not: there is nothing to
    # assume it from, so the field stays away rather than saying zero.
    assert "tokens" not in out
    assert elapsed < 12, f"the kill took too long: {elapsed:.1f}s"

    result_file = workspace["project"].parent / "result.json"
    assert result_file.exists(), "a stop must always leave a result file"
    assert json.loads(result_file.read_text())["terminalReason"] == "timeout"

    # Whatever the step managed to write is committed, with the reason,
    # so the tree is clean for the next run.
    assert git(workspace["project"], "status", "--porcelain") == ""
    assert "stopped: timeout" in git(
        workspace["project"], "log", "-1", "--pretty=%s%n%b", "aide/81-queue-and-runner"
    )

    # Spec 152: the sentence a reader actually sees. A stop at OUR OWN
    # limit is not an outside fault, and the work is not lost — the
    # commit asserted two lines above is exactly what makes that true.
    # `error` is read verbatim by the row's panel and the job page's
    # banner, so this string is the whole of what either one says.
    assert "time limit" in out["error"]
    assert "2s" in out["error"], "the limit's own number belongs in the sentence"
    assert "committed" in out["error"]
    assert "killed" not in out["error"], "a limit we set is not something that happened to us"


def test_a_stopped_run_is_charged_its_budget_even_when_it_flushes_json(runner, workspace, fake_claude):
    """Measured on the mini 2026-08-16: a SIGTERM'd `claude -p` DOES
    flush its result JSON — but with subtype error_during_execution and
    total_cost_usd 0. Trusting that number would under-charge exactly
    the runs that ran longest, so a stop is charged its full budget
    whether or not a result was written."""
    flushed = {
        "type": "result", "subtype": "error_during_execution",
        "is_error": True, "session_id": "abc", "total_cost_usd": 0,
        # Spec 118: a flushed result carries a usage block too, and it
        # is no more trustworthy than the $0 beside it.
        "modelUsage": MODEL_USAGE,
    }
    claude = fake_claude(
        "cat > /dev/null\n"
        f"trap 'echo {json.dumps(json.dumps(flushed))}; exit 143' TERM\n"
        "while true; do sleep 0.2; done"
    )
    rc, out, _ = run(runner, workspace, claude, timeout_sec="2", kill_grace_sec="5")
    assert out["terminalReason"] == "timeout"
    assert out["costUsd"] == pytest.approx(3.0), "the flushed $0 must not be believed"
    assert out["costMeasured"] is False
    assert "tokens" not in out, "a stopped run's flushed usage is no more measured than its cost"


def test_a_child_that_exits_on_sigterm_is_never_sigkilled(runner, workspace, fake_claude, tmp_path):
    marker = tmp_path / "term-seen"
    claude = fake_claude(
        "cat > /dev/null\n"
        f"trap 'echo yes > {marker}; exit 0' TERM\n"
        "while true; do sleep 0.2; done"
    )
    started = time.time()
    rc, out, _ = run(runner, workspace, claude, timeout_sec="2", kill_grace_sec="8")
    elapsed = time.time() - started
    assert marker.exists(), "SIGTERM must reach the child"
    assert elapsed < 9, "the run should end when the child exits, not wait out the whole grace"
    assert out["terminalReason"] == "timeout"


# --- Criterion 11: the push modes --------------------------------------------
# `push` is a setting, not a decision baked into the code: none commits
# locally, branch also pushes the spec's branch, pr also opens a pull
# request. Every level is exercised here against a LOCAL bare repo and a
# fake `gh`, so nothing reaches GitHub.


@pytest.fixture
def origin(workspace, tmp_path):
    """Bare repos standing in for GitHub.

    The project's `origin` keeps a real GitHub fetch URL (that is where
    the compare link comes from) while its PUSH url points at the bare
    repo — so a push is observable without a network.
    """
    project_bare = tmp_path / "origin.git"
    specs_bare = tmp_path / "specs-origin.git"
    for bare in (project_bare, specs_bare):
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", "git@github.com:ragnarwestad/aide.git")
    git(workspace["project"], "remote", "set-url", "--push", "origin", str(project_bare))
    git(workspace["project"], "push", "-q", "origin", "main")
    git(workspace["specs"], "remote", "add", "origin", "git@github.com:ragnarwestad/aide-specs.git")
    git(workspace["specs"], "remote", "set-url", "--push", "origin", str(specs_bare))
    git(workspace["specs"], "push", "-q", "origin", "main")
    return {"project": project_bare, "specs": specs_bare}


@pytest.fixture
def fake_gh(tmp_path):
    """Factory for a stand-in `gh`. Records argv, then behaves as asked."""
    calls = tmp_path / "gh-calls.txt"

    def make(body: str = 'echo "https://github.com/ragnarwestad/aide/pull/7"'):
        path = tmp_path / "fake-gh"
        path.write_text("#!/usr/bin/env bash\n" f'printf "%s\\n" "$*" >> {calls}\n' f"{body}\n")
        path.chmod(0o755)
        return path

    make.calls = calls  # type: ignore[attr-defined]
    return make


def writing_claude(fake_claude, workspace):
    """A claude that leaves work behind in both roots, the way a real
    step does — in ITS OWN working directory and in the specs root its
    own .aide/config names, never by absolute path into a main checkout.
    """
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def run_with_gh(runner, workspace, claude, gh, **kwargs):
    env_gh = str(gh) if gh else None
    old = os.environ.get("AIDE_GH_BIN")
    if env_gh:
        os.environ["AIDE_GH_BIN"] = env_gh
    try:
        return run(runner, workspace, claude, **kwargs)
    finally:
        if old is None:
            os.environ.pop("AIDE_GH_BIN", None)
        else:
            os.environ["AIDE_GH_BIN"] = old


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


def specs_only_claude(fake_claude, workspace):
    """An `analyze` step: it changes the specs repo and nothing else.
    This is the shape of most of what the queue actually runs."""
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


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


def test_a_broken_gh_never_fails_a_finished_run(runner, workspace, fake_claude, fake_gh, origin):
    """`gh` on the mini needs an interactive re-auth only the user can
    do. A run whose work succeeded must not be reported as failed
    because the PR could not be opened."""
    claude = writing_claude(fake_claude, workspace)
    gh = fake_gh('echo "the token in default is invalid" >&2; exit 1')
    rc, out, _ = run_with_gh(runner, workspace, claude, gh, push="pr")
    assert rc == 0
    assert out["ok"] is True, "the step did its work"
    assert out["terminalReason"] == "completed"
    assert out["prError"], "but the failure is recorded, not swallowed"
    assert "aide/81-queue-and-runner" in git(
        origin["project"], "branch", "--list", "aide/81-queue-and-runner"
    ), "the push still happened"


def test_a_push_that_cannot_reach_its_remote_is_recorded_not_fatal(runner, workspace, fake_claude):
    """No origin at all: the work is committed locally, and the run says
    so instead of failing."""
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, push="branch")
    assert rc == 0
    assert out["ok"] is True
    assert out["pushError"], "a push that did not happen must not be silent"


def self_committing_claude(fake_claude, workspace):
    """A step that commits its own work before it finishes — the way
    /aide-archive does. The run's own commit loop then finds a clean
    tree, and that must not read as "nothing happened" (spec 98).

    Only the written file is staged: the linked `deps` dependency
    directory is a symlink, which `/deps/` in .gitignore does not match,
    and staging it would put the main checkout's absolute path into the
    commit.
    """
    return fake_claude(
        "cat > /dev/null\n"
        + 'echo "written and committed by the step" > "$PWD/self-committed.txt"\n'
        + "git add self-committed.txt\n"
        + 'git commit -q -m "the step committed this itself"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


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


def test_an_unknown_push_mode_is_refused_before_anything_starts(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, push="everywhere")
    assert rc == 2
    assert "push" in out["error"].lower()
    assert not fake_claude.calls.exists()


# --- a reused branch must not carry stale code -------------------------------

def is_ancestor(repo, a, b):
    return subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", a, b]
    ).returncode == 0


def test_a_reused_branch_is_brought_up_to_the_default_branch(runner, workspace, fake_claude):
    """A spec's branch survives between steps, so analyze, review-plan and
    implement build on each other. But the default branch moves on, and a
    branch left over from the morning made the step read the morning's
    code. Measured 2026-08-16: a review-plan reviewed a file whose bug had
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
    # And the tree is left clean, not mid-merge.
    assert git(project, "status", "--porcelain") == ""


# --- passenger projects (spec 83) --------------------------------------------
# A job's work often spans more than the project and its specs repo: spec
# 81's own implement step wrote to a third repository the run knew nothing
# about, so half the work was left uncommitted on the machine while the
# result reported success.

@pytest.fixture
def passenger(tmp_path):
    return init_repo(tmp_path / "passenger")


# A passenger repo is addressed by absolute path and nothing else, so
# since spec 91 the PROMPT names its worktree — the same answer the
# script already uses for a fact the step cannot infer (headlessness).
# The fake claude reads the prompt off stdin and works where it is told,
# exactly as a step would.
PASSENGER_FROM_PROMPT = (
    'prompt="$(cat)"\n'
    'pwt="$(printf "%s\\n" "$prompt" | sed -n "s|^The repo passenger is checked out '
    'for this run at \\(.*\\)\\.$|\\1|p" | head -1)"\n'
)


def test_a_passenger_repo_is_committed_on_the_branch_and_handed_back_clean(
    runner, workspace, fake_claude, passenger
):
    claude = fake_claude(
        PASSENGER_FROM_PROMPT
        + READ_SPECS
        + 'echo "written by the step" > "$pwt/new-code.txt"\n'
        + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, extra_project_dir=str(passenger))
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    assert "new-code.txt" in git(passenger, "show", "--name-only", "--pretty=", branch)
    assert git(passenger, "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert git(passenger, "status", "--porcelain") == ""
    roots = {r["root"]: r for r in out["repos"]}
    assert roots[str(passenger)]["changedFiles"] == 1


def test_a_dirty_passenger_repo_does_not_stop_the_run(
    runner, workspace, fake_claude, passenger
):
    """A passenger is branched into a worktree like every other root, so
    someone else's work-in-progress in its main checkout is theirs to
    deal with and nobody else's problem (spec 144)."""
    (passenger / "someone-elses-wip.txt").write_text("in progress\n")
    claude = fake_claude(
        PASSENGER_FROM_PROMPT
        + READ_SPECS
        + 'echo "written by the step" > "$pwt/new-code.txt"\n'
        + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, extra_project_dir=str(passenger))
    assert rc == 0, out
    assert not out.get("error"), out["error"]
    branch = "aide/81-queue-and-runner"
    assert "new-code.txt" in git(passenger, "show", "--name-only", "--pretty=", branch)
    # The stray file stays untracked in the main checkout, and off the branch.
    assert git(passenger, "status", "--porcelain") == "?? someone-elses-wip.txt"
    assert "someone-elses-wip.txt" not in git(
        passenger, "show", "--name-only", "--pretty=", branch
    )


def test_a_passenger_that_is_not_a_git_repo_refuses(runner, workspace, fake_claude, tmp_path):
    plain = tmp_path / "not-a-repo"
    plain.mkdir()
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, extra_project_dir=str(plain))
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert str(plain) in out["error"]


def test_a_passenger_that_does_not_exist_refuses(runner, workspace, fake_claude, tmp_path):
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, extra_project_dir=str(tmp_path / "nope"))
    assert rc == 2, out
    assert out["terminalReason"] == "refused"


def test_a_passenger_repo_is_pushed_on_its_branch_not_its_main(
    runner, workspace, fake_claude, passenger, tmp_path
):
    """The code half of a cross-repo job is the half that needs reviewing.
    Publishing it straight to main is the one thing `--push branch` exists
    to prevent."""
    bare = tmp_path / "passenger-origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    git(passenger, "remote", "add", "origin", "git@github.com:ragnarwestad/passenger.git")
    git(passenger, "remote", "set-url", "--push", "origin", str(bare))
    git(passenger, "push", "-q", "origin", "main")
    main_before = git(bare, "rev-parse", "main")

    claude = fake_claude(
        PASSENGER_FROM_PROMPT
        + 'echo "written by the step" > "$pwt/new-code.txt"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, extra_project_dir=str(passenger), push="branch")
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    assert branch in git(bare, "branch", "--list", branch)
    assert git(bare, "rev-parse", "main") == main_before, "main must not move"
    urls = {e["url"] for e in out["branchUrls"]}
    assert f"https://github.com/ragnarwestad/passenger/compare/main...{branch}" in urls


# --- Spec 02: keeping the stream ---------------------------------------------
# The output existed and was thrown away: the whole $work_dir goes with
# the EXIT trap, so nothing of what happened during a 25-minute run
# survived it. --stream-file is opt-in, so every existing caller keeps
# today's behaviour byte for byte.

STREAM_NOISE = [
    {"type": "system", "subtype": "init", "cwd": "/x"},
    {"type": "assistant", "message": {"content": [{"type": "text", "text": "Reading queue.ts"}]}},
]


def stream_body(result, before=STREAM_NOISE, after=None, exit_code=0):
    """A fake claude that emits NDJSON the way --output-format
    stream-json does: many events, the result among them."""
    lines = "".join(f"echo '{json.dumps(e)}'\n" for e in before)
    lines += f"echo '{json.dumps(result)}'\n"
    for e in after or []:
        lines += f"echo '{json.dumps(e)}'\n"
    return "cat > /dev/null\n" + lines + f"exit {exit_code}"


def test_the_kept_stream_survives_the_work_dir_cleanup(runner, workspace, fake_claude, tmp_path):
    stream = tmp_path / "job.stream.jsonl"
    claude = fake_claude(stream_body(RESULT_OK))
    rc, out, _ = run(runner, workspace, claude, stream_file=str(stream))
    assert rc == 0, out
    assert stream.exists(), "the transcript must outlive the run's temporary directory"
    lines = [l for l in stream.read_text().splitlines() if l.strip()]
    assert len(lines) == 3
    assert json.loads(lines[0])["type"] == "system"
    assert json.loads(lines[-1])["type"] == "result"


def test_the_terminal_result_is_selected_by_type_not_by_position(runner, workspace, fake_claude, tmp_path):
    """A trailing event after the result would silently corrupt cost,
    session and terminal reason for every run if the parser just took
    the last line."""
    stream = tmp_path / "job.stream.jsonl"
    trailing = [{"type": "system", "subtype": "shutdown"}, {"type": "rate_limit_event"}]
    claude = fake_claude(stream_body(RESULT_OK, after=trailing))
    rc, out, _ = run(runner, workspace, claude, stream_file=str(stream))
    assert rc == 0, out
    assert out["sessionId"] == RESULT_OK["session_id"]
    assert out["costUsd"] == pytest.approx(0.5357)
    assert out["costMeasured"] is True
    assert out["terminalReason"] == "completed"


def test_a_truncated_last_line_does_not_lose_the_result(runner, workspace, fake_claude, tmp_path):
    """A killed run leaves half a line behind. Refusing the whole file
    over it would throw away a result event that arrived intact."""
    stream = tmp_path / "job.stream.jsonl"
    # The half-line goes BEFORE the exit, or it is never written at all.
    claude = fake_claude(
        stream_body(RESULT_OK, exit_code=0).replace(
            "exit 0", 'printf \'{"type":"assist\'\nexit 0'
        )
    )
    rc, out, _ = run(runner, workspace, claude, stream_file=str(stream))
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert out["costUsd"] == pytest.approx(0.5357)


def test_the_stream_is_kept_when_the_budget_stops_the_run(runner, workspace, fake_claude, tmp_path):
    stream = tmp_path / "job.stream.jsonl"
    claude = fake_claude(stream_body(RESULT_BUDGET, exit_code=1))
    rc, out, _ = run(runner, workspace, claude, stream_file=str(stream))
    assert rc == 0, out
    assert out["terminalReason"] == "budget"
    assert stream.exists()
    assert '"error_max_budget_usd"' in stream.read_text()


def test_the_stream_is_kept_when_the_deadline_kills_the_run(runner, workspace, fake_claude, tmp_path):
    """The longest runs are exactly the ones whose transcript is worth
    keeping, and they are the ones that get killed."""
    stream = tmp_path / "job.stream.jsonl"
    claude = fake_claude(
        "cat > /dev/null\n"
        f"echo '{json.dumps(STREAM_NOISE[0])}'\n"
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    rc, out, _ = run(runner, workspace, claude, stream_file=str(stream),
                     timeout_sec="2", kill_grace_sec="1")
    assert out["terminalReason"] == "timeout"
    assert stream.exists(), "a killed run's transcript must survive too"
    assert '"init"' in stream.read_text()


def test_the_stream_is_readable_while_the_run_is_still_going(
    runner, workspace, fake_claude, tmp_path
):
    """The dashboard's "what it has been doing" panel reads this file to
    show a RUNNING job. Copying it out of $work_dir at exit filled the
    panel the instant the job stopped needing it: five minutes into a
    live analyze, the panel was empty and the run looked stuck."""
    stream = tmp_path / "job.stream.jsonl"
    ready, go = tmp_path / "ready", tmp_path / "go"
    # Emit one event, announce it, and hold until the test releases us.
    claude = fake_claude(
        "cat > /dev/null\n"
        f"echo '{json.dumps(STREAM_NOISE[0])}'\n"
        f"touch {ready}\n"
        f"while [ ! -f {go} ]; do sleep 0.05; done\n"
        f"echo '{json.dumps(RESULT_OK)}'\n"
        "exit 0"
    )
    proc = subprocess.Popen(
        [
            str(runner),
            "--project-dir", str(workspace["project"]),
            "--command", "analyze",
            "--spec", workspace["folder"],
            "--budget-usd", "3",
            "--timeout-sec", "30",
            "--permission-mode", "acceptEdits",
            "--result-file", str(workspace["project"].parent / "result.json"),
            "--stream-file", str(stream),
            "--worktree-base", str(workspace["wtbase"]),
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, env={**os.environ, "AIDE_CLAUDE_BIN": str(claude)},
    )
    try:
        deadline = time.time() + 30
        while not ready.exists() and time.time() < deadline:
            if proc.poll() is not None:
                raise AssertionError(f"the run ended early: {proc.communicate()}")
            time.sleep(0.05)
        assert ready.exists(), "the fake claude never started"
        # THE POINT: mid-run, with claude still holding, the events it
        # has already emitted must be on disk where the dashboard looks.
        assert stream.exists(), "the stream file must exist while the run is going"
        assert '"init"' in stream.read_text(), "already-emitted events must be readable mid-run"
    finally:
        go.touch()
        proc.wait(timeout=30)
    # And the run still finishes normally, with the result parsed out of
    # the same file.
    out = json.loads(proc.stdout.read().strip().splitlines()[-1])
    assert out["terminalReason"] == "completed"
    assert json.loads(stream.read_text().splitlines()[-1])["type"] == "result"


def test_the_stream_is_kept_when_the_cli_produces_no_result(runner, workspace, fake_claude, tmp_path):
    stream = tmp_path / "job.stream.jsonl"
    claude = fake_claude("cat > /dev/null\necho 'not json at all'\nexit 1")
    rc, out, _ = run(runner, workspace, claude, stream_file=str(stream))
    assert out["terminalReason"] == "cli-error"
    assert stream.exists()
    assert "not json at all" in stream.read_text()


def test_without_the_flag_nothing_is_kept_and_nothing_changes(runner, workspace, fake_claude, tmp_path):
    """Opt-in means opt-in: a caller that does not ask still gets
    today's behaviour, temporary directory discarded and all."""
    stream = tmp_path / "job.stream.jsonl"
    claude = fake_claude(stream_body(RESULT_OK))
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert out["sessionId"] == RESULT_OK["session_id"]
    assert not stream.exists()
    assert not list(tmp_path.glob("**/*.stream.jsonl"))


def test_an_unwritable_stream_path_never_fails_a_finished_run(runner, workspace, fake_claude, tmp_path):
    """Keeping a transcript is a convenience. A run whose work
    succeeded must not be reported as failed because a directory was
    missing."""
    claude = fake_claude(stream_body(RESULT_OK))
    rc, out, _ = run(runner, workspace, claude, stream_file=str(tmp_path / "nope" / "x.jsonl"))
    assert rc == 0, out
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"


def test_the_session_id_we_supplied_is_the_one_the_run_reports(runner, workspace, fake_claude):
    """The queue generates the id BEFORE spawning, so it can watch the
    session while the step runs. That is worth nothing unless the id it
    passed is the id the run actually used."""
    chosen = "11111111-2222-4333-8444-555555555555"
    echoed = {**RESULT_OK, "session_id": chosen}
    claude = fake_claude(
        "cat > /dev/null\n"
        f"echo '{json.dumps(echoed)}'"
    )
    rc, out, _ = run(runner, workspace, claude, session_id=chosen)
    assert rc == 0, out
    assert f"--session-id {chosen}" in fake_claude.calls.read_text()
    assert out["sessionId"] == chosen


# --- Spec 91, slice 91a: one throwaway checkout per run ----------------------
# The queue ran one job at a time for one reason: every run switched the
# real working tree of every repo it touched, so two at once would fight
# over it — whichever switched last would decide what the other was
# compiling, testing and committing. Since spec 91 a run works in `git
# worktree` checkouts of its own, and the main ones are only ever put
# back ON their default branch.
#
# Criteria 1-19 of 3-solution.md.

BRANCH = "aide/81-queue-and-runner"


def worktrees(repo):
    """The worktree paths git knows about in `repo`, main one included."""
    out = git(repo, "worktree", "list", "--porcelain")
    return [l[len("worktree "):] for l in out.splitlines() if l.startswith("worktree ")]


def probing_claude(fake_claude, workspace, extra="", result=RESULT_OK):
    """A claude that records the main checkouts' branches DURING the run —
    the only moment at which the question can be asked."""
    log = workspace["project"].parent / "main-branches.txt"
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'git -C "{workspace["project"]}" rev-parse --abbrev-ref HEAD >> {log}\n'
        + f'git -C "{workspace["specs"]}" rev-parse --abbrev-ref HEAD >> {log}\n'
        + extra
        + f"echo '{json.dumps(result)}'"
    ), log


# --- Criterion 1: the main checkouts never leave their default branch --------

def test_the_main_checkout_never_leaves_its_default_branch(runner, workspace, fake_claude):
    """The whole point. Two runs on the same repo pair are independent
    only if neither of them moves the shared tree."""
    claude, log = probing_claude(
        fake_claude, workspace,
        extra=(
            'echo "written by the step" > "$PWD/new-code.txt"\n'
            f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        ),
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert log.read_text().split() == ["main", "main"], "during the run, both trees stay on main"
    assert git(workspace["project"], "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert git(workspace["specs"], "rev-parse", "--abbrev-ref", "HEAD") == "main"
    # And the work really did land on the branch, so this is not a test
    # that passes because nothing happened.
    assert "new-code.txt" in git(workspace["project"], "show", "--name-only", "--pretty=", BRANCH)


# --- Criterion 3: the specs root is re-pointed at the specs worktree ---------

def test_the_worktree_specs_path_points_at_the_specs_worktree(runner, workspace, fake_claude):
    """A worktree of the PROJECT isolates nothing an analyze step writes:
    AIDE_SPECS_PATH is an absolute path into another repository, and it
    resolves to the shared checkout from inside a worktree just as well as
    from outside it."""
    seen = workspace["project"].parent / "specs-seen.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "%s\\n" "$specs" > {seen}\n'
        + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    resolved = seen.read_text().strip()
    assert resolved.startswith(str(workspace["wtbase"])), resolved
    assert not resolved.startswith(str(workspace["specs"]) + "/"), "not the shared specs checkout"
    # What the step wrote there is committed on the branch in the specs
    # REPO — the worktree is a view of it, not a copy.
    assert "2-analysis.md" in git(workspace["specs"], "show", "--name-only", "--pretty=", BRANCH)
    assert "2-analysis.md" not in git(workspace["specs"], "ls-tree", "-r", "--name-only", "main")


def test_the_specs_worktree_is_added_to_claude_as_a_directory(runner, workspace, fake_claude):
    """claude's session is confined to its cwd — the PROJECT worktree — and
    the specs worktree is a sibling of it, not a child. Without --add-dir
    an archive step (which moves the spec's folder) reports "sandbox only
    allows … the project" and does nothing; seen four times on
    2026-08-18. Every root the step may write in is handed over."""
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    argv = fake_claude.calls.read_text().split()
    added = [argv[i + 1] for i, a in enumerate(argv) if a == "--add-dir"]
    assert added, "no --add-dir at all"
    assert all(a.startswith(str(workspace["wtbase"])) for a in added), added
    assert any(a.endswith("/" + workspace["specs"].name) for a in added), added


# --- Criterion 4: the re-pointed config is never dirty, never committed ------

def test_the_repointed_config_is_never_dirty_and_never_committed(runner, workspace, fake_claude):
    """.aide/config is TRACKED in this repo, so rewriting it in a worktree
    would dirty the tree — and `git add -A` would commit the rewrite onto
    the spec branch. `update-index --skip-worktree` is what stops both."""
    status = workspace["project"].parent / "wt-status.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'git status --porcelain > {status}\n'
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert ".aide/config" not in status.read_text(), "the rewrite must never read as a change"
    files = git(workspace["project"], "show", "--name-only", "--pretty=", BRANCH)
    assert ".aide/config" not in files, files
    # The main checkout's own config is untouched.
    assert f"AIDE_SPECS_PATH={workspace['specs']}" in (
        workspace["project"] / ".aide" / "config"
    ).read_text()


# --- Criteria 5 and 6: the dependencies a worktree lacks ---------------------

def test_a_linked_dependency_is_available_inside_the_worktree(runner, workspace, fake_claude):
    """`git worktree add` checks out TRACKED files only, so every
    gitignored path is absent — in this repo that is `.venv` and
    `dashboard/node_modules`, without which pytest and bun both fail for a
    reason that has nothing to do with the change."""
    seen = workspace["project"].parent / "dep-seen.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        + f'cat "$PWD/deps/marker.txt" > {seen} 2>&1\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert seen.read_text().strip() == "the dependency tree"


def test_a_linked_dependency_is_never_staged_and_leaves_the_repo_unchanged(
    runner, workspace, fake_claude, origin
):
    """A `dir/` gitignore rule matches directories only, and a symlink is
    a file to git — so the link reads as untracked and `git add -A` would
    commit it. Two absolute-path symlinks on every spec branch is the
    small half; the large half is that every repo then counts as changed,
    so an analyze step that touched nothing in the project pushes a branch
    and a compare link anyway."""
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace), push="branch")
    assert rc == 0, out
    roots = {r["root"]: r for r in out["repos"]}
    assert roots[str(workspace["project"])]["changedFiles"] == 0, "the link is not a change"
    assert git(origin["project"], "branch", "--list", BRANCH) == "", "and no branch is pushed"
    assert BRANCH in git(origin["specs"], "branch", "--list", BRANCH)


# --- Criterion 7: the reported root is the MAIN checkout ---------------------

def test_the_reported_root_is_the_main_checkout_and_head_is_the_worktrees(
    runner, workspace, fake_claude
):
    """A worktree path is deleted when the run ends. Reported as `root` it
    would make the page's labels read as job ids, `isMerged` answer false
    forever, and Merge fail in a directory that no longer exists."""
    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace))
    assert rc == 0, out
    roots = {r["root"]: r for r in out["repos"]}
    assert set(roots) == {str(workspace["project"]), str(workspace["specs"])}
    for main, repo in roots.items():
        assert pathlib.Path(main).is_dir(), "a reported root must still exist afterwards"
        assert repo["worktree"].startswith(str(workspace["wtbase"])), repo
        # headAfter is the step's commit, read in the tree the work
        # happened in — not the default branch's HEAD.
        assert repo["headAfter"] == git(main, "rev-parse", BRANCH)
        assert repo["headAfter"] != git(main, "rev-parse", "main")


# --- Criterion 8: no worktree survives the run ------------------------------

def test_no_worktree_survives_a_completed_run(runner, workspace, fake_claude):
    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace))
    assert rc == 0, out
    for repo in (workspace["project"], workspace["specs"]):
        assert worktrees(repo) == [str(repo)], "only the main worktree may remain"
    assert not list(workspace["wtbase"].glob("*/*/*")), "and nothing is left on disk"


def test_no_worktree_survives_a_budget_stop(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_BUDGET)}'; exit 1")
    rc, out, _ = run(runner, workspace, claude)
    assert out["terminalReason"] == "budget"
    assert worktrees(workspace["project"]) == [str(workspace["project"])]


def test_no_worktree_survives_a_deadline_kill(runner, workspace, fake_claude):
    claude = fake_claude("cat > /dev/null\ntrap '' TERM\nwhile true; do sleep 0.2; done")
    rc, out, _ = run(runner, workspace, claude, timeout_sec="2", kill_grace_sec="1")
    assert out["terminalReason"] == "timeout"
    assert worktrees(workspace["project"]) == [str(workspace["project"])]
    assert worktrees(workspace["specs"]) == [str(workspace["specs"])]


def test_no_worktree_survives_a_refusal_in_the_branch_block(runner, workspace, fake_claude):
    """The trap has to be installed BEFORE the first `worktree add`: a
    refusal between the two would orphan a worktree, and an orphan locks
    its branch out of every later run."""
    project = workspace["project"]
    git(project, "switch", "-q", "-c", BRANCH)
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
    assert worktrees(project) == [str(project)], "a refusal must clean up after itself"
    assert worktrees(workspace["specs"]) == [str(workspace["specs"])]


# --- Criterion 9: a leftover worktree is swept BY BRANCH ---------------------

def test_a_leftover_worktree_at_another_path_is_swept_by_branch(
    runner, workspace, fake_claude, tmp_path
):
    """SIGKILL cannot be trapped, so a killed run leaves a checkout
    behind — and after `git worktree prune` a leftover at a DIFFERENT path
    still gives `fatal: '<branch>' is already used by worktree at …`.
    Sweeping this run's own path is therefore not enough."""
    orphan = tmp_path / "orphan-worktree"
    git(workspace["project"], "worktree", "add", "-q", "-b", BRANCH, str(orphan))
    assert len(worktrees(workspace["project"])) == 2

    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace))
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert worktrees(workspace["project"]) == [str(workspace["project"])]


# --- Criterion 10: two runs, same repos, at the same time -------------------

def test_two_runs_on_the_same_repos_do_not_see_each_other(runner, workspace, fake_claude, tmp_path):
    """The measured problem. Two jobs for two specs against one pair of
    repositories used to be impossible; the only honest way to test that
    they are now independent is to run both at once."""
    specs = workspace["specs"]
    second = "82-second-spec"
    (specs / second).mkdir()
    (specs / second / "1-description.md").write_text("# Second - Description\n")
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
                "--command", "analyze",
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


# --- Criteria 11 and 12: the new refusals -----------------------------------

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


# --- Spec 138: a configured link whose source is not there -------------------

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


# --- Criterion 15: a main checkout on the spec branch is healed --------------

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
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert log.read_text().split() == ["main", "main"], "healed before the worktree was made"
    assert "new-code.txt" in git(workspace["project"], "show", "--name-only", "--pretty=", BRANCH)


# --- Criterion 16: the pull is a courtesy, and it advances the DEFAULT branch -

def test_a_failed_pull_is_recorded_not_fatal(runner, workspace, fake_claude, tmp_path):
    """The worktree is cut from origin/<base>, so a pull that loses a race
    with a concurrent run costs a staler spec list and nothing else. It
    used to refuse the whole run."""
    bare = tmp_path / "gone.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", str(bare))
    git(workspace["project"], "push", "-q", "-u", "origin", "main")
    # The remote is then made unreachable, which is what a fetch failure
    # looks like from here.
    git(workspace["project"], "remote", "set-url", "origin", str(tmp_path / "not-there.git"))

    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace), pull=True)
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["pullError"], "a pull that did not happen must not be silent"
    assert "new-code.txt" in git(workspace["project"], "show", "--name-only", "--pretty=", BRANCH)


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


# --- Criterion 17: a passenger repo is named in the prompt ------------------

def test_a_passenger_repo_is_worktreed_and_named_in_the_prompt(
    runner, workspace, fake_claude, passenger
):
    """A passenger is addressed only by absolute path, and that path still
    points at the main checkout. Nothing told the step its worktree
    existed, so the step wrote into the main tree, the commit loop
    committed nothing, and the run reported success — spec 83's failure
    recreated."""
    seen = workspace["project"].parent / "passenger-wt.txt"
    claude = fake_claude(
        PASSENGER_FROM_PROMPT
        + f'printf "%s\\n" "$pwt" > {seen}\n'
        + 'echo "written by the step" > "$pwt/new-code.txt"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, extra_project_dir=str(passenger))
    assert rc == 0, out
    named = seen.read_text().strip()
    assert named.startswith(str(workspace["wtbase"])), named
    assert named != str(passenger)
    assert "new-code.txt" in git(passenger, "show", "--name-only", "--pretty=", BRANCH)
    assert git(passenger, "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert git(passenger, "status", "--porcelain") == "", "the main passenger tree stays clean"


# --- Criterion 18: the re-point happens AFTER the branch is brought up to date

def test_a_reused_branch_whose_base_changed_the_config_does_not_false_conflict(
    runner, workspace, fake_claude
):
    """With .aide/config marked skip-worktree and rewritten, and its
    committed content changed on the base branch, `git merge` fails with
    "local changes would be overwritten" while `git status` calls the tree
    clean and `merge --abort` has nothing to abort. Reachable the day
    AIDE_WORKTREE_LINKS lands on main."""
    project = workspace["project"]
    git(project, "switch", "-q", "-c", BRANCH)
    git(project, "switch", "-q", "main")
    (project / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={workspace['specs']}\nAIDE_WORKTREE_LINKS=deps\n# a later comment\n"
    )
    git(project, "add", "-f", ".aide/config")
    git(project, "commit", "-q", "-m", "change the config on main")

    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace))
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert is_ancestor(project, "main", BRANCH)


# --- Criterion 19: an untracked .aide/config --------------------------------

def test_an_untracked_aide_config_is_copied_into_the_worktree(runner, workspace, fake_claude):
    """.aide/config is tracked in aide's own repo only, because its
    .gitignore negates the global ignore for it. Everywhere else a
    worktree has no config at all — so AIDE_SPECS_PATH and AIDE_TEST_CMD
    would simply vanish for the step."""
    project = workspace["project"]
    git(project, "rm", "-q", "--cached", ".aide/config")
    (project / ".gitignore").write_text("/deps/\n/.aide/\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "stop tracking the config")
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


# --- Criterion 14: the other two specs-root layouts -------------------------

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


# --- Criterion 18: a spec whose dependency is still unmerged ----------------
# Every run cuts its branch from origin/<base> in a fresh worktree, so a
# spec queued while a spec it builds on is still unmerged is analyzed and
# implemented against a main that does not contain it (spec 92). The
# refusal has to land BEFORE claude is launched, because that is where
# the money is.
#
# Since spec 122 the guard runs only for the steps that BUILD on merged
# code — implement, resolve, archive. Every test below therefore names
# its command explicitly: the default `analyze` no longer reaches the
# guard at all, and a test left on the default would pass for the wrong
# reason. The steps that write only the spec's own folder in the specs
# repo (analyze, review-plan, create) have their own tests further down.


@pytest.fixture
def local_origins(workspace, tmp_path):
    """A REAL local bare origin for both roots.

    The shared `origin` fixture points the fetch URL at a github.com
    address on purpose (that is where the compare link comes from), which
    no dependency check can talk to. These tests need an origin that
    actually answers.
    """
    bares = {}
    for key in ("project", "specs"):
        bare = tmp_path / f"{key}-local.git"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
        git(workspace[key], "remote", "add", "origin", str(bare))
        git(workspace[key], "push", "-q", "-u", "origin", "main")
        bares[key] = bare
    return bares


def add_spec(workspace, folder, archived=False):
    """A second spec in the specs repo, active or already archived."""
    parent = workspace["specs"] / "archive" if archived else workspace["specs"]
    parent.mkdir(exist_ok=True)
    (parent / folder).mkdir()
    (parent / folder / "1-description.md").write_text(f"# {folder} - Description\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", f"add {folder}")
    return parent / folder


def set_depends_on(workspace, value, folder=None):
    folder = folder or workspace["folder"]
    (workspace["specs"] / folder / "1-description.md").write_text(
        "# Queue - Description\n\n## Tracking info\n\n"
        f"- **Task:** `{folder}/`\n- **Depends on:** {value}\n"
    )
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "name a dependency")


def leave_branch_on_origin(workspace, branch, key="specs"):
    """What a previous aide-run-spec leaves behind: the branch on origin,
    with no local branch in this checkout. It points at HEAD, so it is
    fully merged — see leave_unmerged_branch_on_origin for the other case."""
    git(workspace[key], "push", "-q", "origin", f"HEAD:refs/heads/{branch}")


def leave_unmerged_branch_on_origin(workspace, branch, key="specs"):
    """A branch on origin with a commit main does not have: work that is
    still waiting to be merged."""
    repo = workspace[key]
    git(repo, "checkout", "-q", "-b", "tmp-unmerged")
    (repo / "unmerged.txt").write_text("not on main\n")
    git(repo, "add", "unmerged.txt")
    git(repo, "commit", "-qm", "work still to merge")
    git(repo, "push", "-q", "origin", f"HEAD:refs/heads/{branch}")
    git(repo, "checkout", "-q", "main")
    git(repo, "branch", "-q", "-D", "tmp-unmerged")


def run_traced(runner, workspace, claude, tmp_path, **kwargs):
    """Run with GIT_TRACE on, so a test can prove which git commands the
    script did NOT run."""
    trace = tmp_path / "git-trace.log"
    old = os.environ.get("GIT_TRACE")
    os.environ["GIT_TRACE"] = str(trace)
    try:
        rc, out, stdout = run(runner, workspace, claude, **kwargs)
    finally:
        if old is None:
            os.environ.pop("GIT_TRACE", None)
        else:
            os.environ["GIT_TRACE"] = old
    return rc, out, trace.read_text() if trace.exists() else ""


def test_a_spec_without_the_field_asks_origin_nothing(
    runner, workspace, fake_claude, local_origins, tmp_path
):
    """The feature is opt-in: a spec with no `Depends on:` line behaves
    exactly as it did before it existed — no talking to origin at all,
    even with an unmerged spec branch sitting there."""
    add_spec(workspace, "80-dependency")
    leave_branch_on_origin(workspace, "aide/80-dependency")

    rc, out, trace = run_traced(
        runner, workspace, writing_claude(fake_claude, workspace), tmp_path,
        command="implement",
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert "ls-remote" not in trace and "fetch" not in trace, trace


def test_refuses_while_a_named_dependency_is_still_unmerged(
    runner, workspace, fake_claude, local_origins
):
    add_spec(workspace, "80-dependency")
    leave_unmerged_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 2
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    # The message names the spec, the dependency and its branch — nobody
    # should have to guess which of the two specs is the problem.
    assert workspace["folder"] in out["error"]
    assert "80-dependency" in out["error"]
    assert "aide/80-dependency" in out["error"]
    assert not fake_claude.calls.exists(), "the refusal must precede the money"
    assert not workspace["wtbase"].exists(), "and leave no worktree behind"


def test_a_dependency_whose_branch_is_merged_but_not_yet_deleted_lets_the_run_proceed(
    runner, workspace, fake_claude, local_origins
):
    """Merged is what the guard is FOR; deleted is a tidy-up. The Merge
    button deletes the branch after merging (spec 99), but an archive
    step re-creates it and merges it again minutes later — 97 and 102
    were each refused against a dependency whose branch was fully on
    main. A branch with no commits beyond origin/main is satisfied."""
    add_spec(workspace, "80-dependency")
    # The dependency's branch points AT origin's main: everything on it
    # is merged, only the name is left.
    git(workspace["specs"], "push", "-q", "origin", "main")
    leave_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command="implement"
    )
    assert rc == 0, out.get("error")
    assert out["terminalReason"] == "completed"


def test_a_dependency_whose_branch_is_gone_lets_the_run_proceed(
    runner, workspace, fake_claude, local_origins
):
    """Merged and deleted — which is what the guard is waiting for."""
    add_spec(workspace, "80-dependency")
    set_depends_on(workspace, "80")

    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command="implement"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"


def test_the_full_folder_name_resolves_as_well_as_the_number(
    runner, workspace, fake_claude, local_origins
):
    add_spec(workspace, "80-dependency")
    leave_unmerged_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "`80-dependency`")

    rc, out, _ = run(runner, workspace, fake_claude("exit 1"), command="implement")
    assert rc == 2
    assert "80-dependency" in out["error"]


def test_refuses_an_unknown_dependency(runner, workspace, fake_claude, local_origins):
    """A typo must stop the run rather than pass as 'nothing to wait
    for' — a silently ignored dependency is worse than none."""
    set_depends_on(workspace, "77")

    rc, out, _ = run(runner, workspace, fake_claude("exit 1"), command="implement")
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "77" in out["error"]
    assert "unknown" in out["error"]
    assert not fake_claude.calls.exists()


def test_refuses_a_spec_that_depends_on_itself(
    runner, workspace, fake_claude, local_origins
):
    set_depends_on(workspace, "81")

    rc, out, _ = run(runner, workspace, fake_claude("exit 1"), command="implement")
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "itself" in out["error"]
    assert not fake_claude.calls.exists()


def test_an_archived_dependency_is_satisfied_without_asking_origin(
    runner, workspace, fake_claude, local_origins, tmp_path
):
    """Archiving only happens to finished work, so an archived dependency
    is merged by definition — the branch left on origin is a leftover, not
    a reason to refuse."""
    add_spec(workspace, "80-dependency", archived=True)
    leave_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    rc, out, trace = run_traced(
        runner, workspace, writing_claude(fake_claude, workspace), tmp_path,
        command="implement",
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert "ls-remote" not in trace, "an archived dependency needs no network"


def test_a_stale_remote_tracking_ref_does_not_refuse_forever(
    runner, workspace, fake_claude, local_origins
):
    """The check ASKS origin; it does not believe this checkout.

    A merged branch is deleted on origin, but `refs/remotes/origin/aide/A`
    survives in every checkout that ever fetched it until somebody prunes.
    Reading that ref instead of asking would refuse every later run of a
    spec whose dependency landed weeks ago — the guard jamming shut is
    worse than the bug it prevents.
    """
    add_spec(workspace, "80-dependency")
    leave_branch_on_origin(workspace, "aide/80-dependency")
    git(workspace["specs"], "fetch", "-q", "origin")
    assert git(
        workspace["specs"], "rev-parse", "--verify", "refs/remotes/origin/aide/80-dependency"
    ), "the stale ref this test is about must actually be there"
    # ...and then the dependency is merged and its branch deleted SOMEWHERE
    # ELSE (a pull request on github, another machine). Deleting it from
    # this checkout would prune the very ref the test is about.
    subprocess.run(
        ["git", "-C", str(local_origins["specs"]), "update-ref", "-d",
         "refs/heads/aide/80-dependency"],
        check=True,
    )
    set_depends_on(workspace, "80")

    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command="implement"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"


# --- Spec 122: the guard holds back only the steps that build on code -------
# analyze, review-plan and create write only the spec's own folder in the
# specs repo — nothing they touch conflicts with an unmerged dependency,
# so refusing them cost a chain of dependent specs its whole parallelism
# for nothing (2026-08-19). The honest trade-off, stated rather than
# hidden: a plan analysed before its dependency merged describes the code
# WITHOUT it.


def test_analyze_proceeds_despite_an_unmerged_dependency(
    runner, workspace, fake_claude, local_origins
):
    add_spec(workspace, "80-dependency")
    leave_unmerged_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command="analyze"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"


@pytest.mark.parametrize("command", ["review-plan", "create"])
def test_review_plan_and_create_proceed_despite_an_unmerged_dependency(
    runner, workspace, fake_claude, local_origins, command
):
    """Criterion 2: what holds for analyze holds for the other two steps
    that only write the spec's own folder."""
    add_spec(workspace, "80-dependency")
    leave_unmerged_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command=command
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"


@pytest.mark.parametrize("command", ["review-plan", "create"])
def test_review_plan_and_create_proceed_despite_an_unknown_or_self_dependency(
    runner, workspace, fake_claude, local_origins, command
):
    """The unknown and self cases are refusals for the gated steps only.
    A non-gated step never reaches the loop, so a typo is not its
    problem either — the step that acts on the dependency is where the
    refusal belongs."""
    set_depends_on(workspace, "77")  # nothing resolves to it
    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command=command
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"

    set_depends_on(workspace, "81")  # the spec's own number
    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command=command
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"


@pytest.mark.parametrize("command", ["resolve", "archive"])
def test_the_other_gated_steps_still_refuse_an_unmerged_dependency(
    runner, workspace, fake_claude, local_origins, command
):
    """Criterion 3: implement is not the only gated step. resolve merges
    the default branch in, and archive moves the folder — both build on
    what has landed."""
    add_spec(workspace, "80-dependency")
    leave_unmerged_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    rc, out, _ = run(runner, workspace, fake_claude("exit 1"), command=command)
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "80-dependency" in out["error"]
    assert not fake_claude.calls.exists(), "the refusal must precede the money"


# --- the gated-step list lives in two files, like the step vocabulary -------
# Same shape of duplication as WORKFLOW_STEPS, and the same treatment: a
# bash string here, a TypeScript array there, no shared source and no
# compiler between them. Gating one and not the other gives a dashboard
# that parks a job the script would have run, or starts one it refuses.


def test_the_two_copies_of_the_dependency_gate_agree(workspace_root):
    import re

    bash = (workspace_root / "core" / "scripts" / "aide-run-spec").read_text()
    m = re.search(r'^DEPENDENCY_GATED_STEPS="([^"]*)"', bash, re.M)
    assert m, "aide-run-spec no longer declares DEPENDENCY_GATED_STEPS as a plain string"
    from_bash = set(m.group(1).split())

    ts = (workspace_root / "dashboard" / "src" / "serve.ts").read_text()
    m = re.search(r"export const DEPENDENCY_GATED_STEPS = \[(.*?)\] as const;", ts, re.S)
    assert m, "serve.ts no longer declares DEPENDENCY_GATED_STEPS as a literal array"
    from_ts = set(re.findall(r'"([^"]+)"', m.group(1)))

    assert from_bash == from_ts, (
        "the script and the dashboard disagree about which steps a dependency "
        f"holds back: only in the script {sorted(from_bash - from_ts)}, "
        f"only in the dashboard {sorted(from_ts - from_bash)}"
    )


# --- Spec 93: create, for a spec that does not exist yet ---------------------

# Every other workflow step names a folder that is already on disk. A
# `create` step is the one that MAKES that folder, so the resolution
# every other step passes through is the one thing standing between the
# dashboard and a spec it can start from — spec 87 named this and left it
# alone.
#
# Nothing here computes a spec number or a folder slug. That rule lives
# in `/aide-create`'s own skill run and nowhere else (spec 82's mistake
# was the same rule written down twice), so the run carries a
# caller-supplied tracking key in, and reads the folder the skill decided
# on back off the disk.

CREATE_KEY = "new-abc123de"


def creating_claude(fake_claude, folders=("94-a-new-spec",)):
    """A stand-in `/aide-create`: it writes the spec folders it was told
    to write, into the specs root its own working directory points at."""
    body = READ_SPECS
    for folder in folders:
        body += (
            f'mkdir -p "$specs/{folder}"\n'
            f'printf "# {folder} - Description\\n" > "$specs/{folder}/1-description.md"\n'
        )
    body += f"echo '{json.dumps(RESULT_OK)}'"
    return fake_claude(f"cat > /dev/null\n{body}")


def create(runner, ws, claude, **kwargs):
    kwargs.setdefault("command", "create")
    kwargs.setdefault("spec", CREATE_KEY)
    kwargs.setdefault("title", "A new spec")
    kwargs.setdefault("description", "Do the thing that was asked for")
    return run(runner, ws, claude, **kwargs)


def test_create_runs_for_a_spec_that_does_not_exist_yet(runner, workspace, fake_claude):
    """The whole refusal spec 87 hit: the spec-folder lookup is
    unconditional, so a spec that does not exist yet can never resolve
    and every `create` is refused before a worktree is even made."""
    claude = creating_claude(fake_claude)
    rc, out, _ = create(runner, workspace, claude)
    assert rc == 0, out
    assert out["ok"] is True, out
    # The tracking key names the branch and the worktree — and nothing
    # else. It is not, and must never become, a folder name.
    assert out["branch"] == f"aide/{CREATE_KEY}"
    assert fake_claude.branch_log.read_text().strip() == f"aide/{CREATE_KEY}"
    assert fake_claude.cwd_log.read_text().strip().startswith(str(workspace["wtbase"]))


def test_create_refuses_without_a_title(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, title=None)
    assert rc == 2
    assert out["ok"] is False
    assert "title" in out["error"], out
    assert not fake_claude.calls.exists()


def test_create_refuses_without_a_description(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, description=None)
    assert rc == 2
    assert out["ok"] is False
    assert "description" in out["error"], out
    assert not fake_claude.calls.exists()


def test_every_other_step_still_refuses_an_unknown_spec(runner, workspace, fake_claude):
    """The create path is an addition, never a widening: `analyze` on a
    spec that does not exist is still refused, with the same words."""
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, command="analyze", spec="no-such-spec")
    assert rc == 2
    assert "unknown spec" in out["error"], out
    assert not fake_claude.calls.exists()


def test_create_asks_the_skill_for_a_spec_by_title_and_description(runner, workspace, fake_claude):
    """`/aide-create TODO-<name> <description>` is the skill's own
    documented argument shape (core/skills/aide-create/SKILL.md), so no
    parsing is invented on either side. The title is ALSO stated on a
    line of its own: the positional token is slugified, and a title is
    not something to recover from a slug."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(
        runner, workspace, claude,
        title="A new spec", description="Do the thing that was asked for",
        dry_run=True,
    )
    assert rc == 0, out
    prompt = out["prompt"]
    assert prompt.startswith("/aide-create TODO-a-new-spec Do the thing that was asked for"), prompt
    assert "Use exactly this title for the spec: A new spec" in prompt, prompt
    assert "headless" in prompt.lower()
    # The generic shape every other step uses would name a spec id this
    # spec does not have yet.
    assert f"/aide-create {CREATE_KEY}" not in prompt


def test_create_states_the_depends_on_value_the_form_chose(runner, workspace, fake_claude):
    """Spec 110: the `Depends on:` line has had a reader since spec 92 and
    no writer but a person at a shell. The value is STATED in the prompt,
    in the same voice as the title, for the same reason: it is a fact the
    skill is told, not a sub-format invented inside the argument string."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, depends_on="92,97-freshness", dry_run=True)
    assert rc == 0, out
    prompt = out["prompt"]
    assert "Use exactly this Depends-on value in Tracking info: 92,97-freshness" in prompt, prompt
    # Still the skill's own argument shape, and still the title beside it.
    assert prompt.startswith("/aide-create TODO-a-new-spec"), prompt
    assert "Use exactly this title for the spec: A new spec" in prompt, prompt


def test_create_without_the_flag_says_nothing_about_dependencies(runner, workspace, fake_claude):
    """Nothing chosen means no line — so the prompt must not mention the
    field at all, rather than state an empty one for the skill to write."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, dry_run=True)
    assert rc == 0, out
    assert "Depends-on" not in out["prompt"], out["prompt"]


def test_create_reports_the_folder_the_step_actually_made(runner, workspace, fake_claude):
    """Read off the disk, never computed: the run diffs the specs root
    before and after, so the number and the slug stay the skill's
    business alone."""
    claude = creating_claude(fake_claude, ["94-a-new-spec"])
    rc, out, _ = create(runner, workspace, claude)
    assert rc == 0, out
    assert out["specFolder"] == "94-a-new-spec", out
    # And the work is committed under the name the spec really has, not
    # under the throwaway key.
    branch_log = git(workspace["specs"], "log", "--oneline", f"aide/{CREATE_KEY}")
    assert "94-a-new-spec" in branch_log, branch_log


def test_create_reports_no_folder_when_two_appeared(runner, workspace, fake_claude):
    """Ambiguity is left unreported rather than guessed at: the spec
    still lands, and the job simply keeps its provisional key."""
    claude = creating_claude(fake_claude, ["94-a-new-spec", "95-another-spec"])
    rc, out, _ = create(runner, workspace, claude)
    assert rc == 0, out
    assert "specFolder" not in out, out


def test_create_reports_no_folder_when_none_appeared(runner, workspace, fake_claude):
    claude = creating_claude(fake_claude, [])
    rc, out, _ = create(runner, workspace, claude)
    assert rc == 0, out
    assert "specFolder" not in out, out


# --- Spec 106: the resolve step ---------------------------------------------
# Every other step treats a conflict between its branch and the default
# branch as a human's problem and refuses. `resolve` is the step that
# exists to BE that human: it is handed the conflicted worktree exactly
# as git left it, and the skill inside it decides. The fork is narrow on
# purpose — one command name, matched literally — because the routine it
# forks is the one every other step depends on.

RESULT_ERROR = {
    "type": "result", "subtype": "error_during_execution", "is_error": True,
    "session_id": "3f1d5b0e-9a2c-4d21-8b77-2e6a4c9d1f30",
    "total_cost_usd": 0.1042, "terminal_reason": "error",
    "errors": ["the project's tests are red after the merge"],
}


def conflicting_branch(workspace, published=False):
    """A spec branch whose one file was changed on both sides — the
    conflict `update_branch_to_base` meets, made real.

    `published` pushes the default branch afterwards: the run merges
    `origin/<default>` wherever that ref exists, so a test with an
    `origin` and an unpublished main would meet no conflict at all.
    """
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
    if published:
        git(project, "push", "-q", "origin", "main")
    return branch


def test_resolve_is_handed_the_open_conflict_and_its_result_is_pushed(
    runner, workspace, fake_claude, origin
):
    """Criterion 5. The step lands in a worktree that is mid-merge, with
    MERGE_HEAD set and the conflict markers still in the file — that is
    the whole point of the step, and refusing before it starts is what
    every other step does instead."""
    project = workspace["project"]
    branch = conflicting_branch(workspace, published=True)
    claude = fake_claude(
        "cat > /dev/null\n"
        # Recorded DURING the run: the worktree is gone by the time the
        # test reads anything, and "was the conflict still open?" is the
        # one fact this step is about.
        f'git rev-parse -q --verify MERGE_HEAD >> {workspace["project"].parent / "merge-head.txt"} 2>/dev/null\n'
        f'grep -c "<<<<<<<" contested.txt >> {workspace["project"].parent / "markers.txt"} 2>/dev/null\n'
        'printf "resolved by the step\\n" > contested.txt\n'
        "git add -A\n"
        "git commit -q --no-edit\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="resolve", push="branch")
    assert rc == 0, out
    assert out["ok"] is True, out
    merge_head = (workspace["project"].parent / "merge-head.txt")
    assert merge_head.exists() and merge_head.read_text().strip(), \
        "the step must be started with the merge still open, not after an abort"
    markers = (workspace["project"].parent / "markers.txt").read_text().strip()
    assert markers != "0", "the conflict markers are the step's input"
    # The resolution reached origin, on the BRANCH.
    assert git(origin["project"], "branch", "--list", branch) != "", "the branch must be published"
    assert "resolved by the step" in git(project, "show", f"{branch}:contested.txt")
    assert is_ancestor(project, "main", branch), "main must now be contained in the branch"


def test_after_a_resolve_the_default_branch_fast_forwards(runner, workspace, fake_claude, origin):
    """Criterion 8. The point of pushing the branch is that the next
    press of Merge finds a fast-forward — the same routine that refused
    before now succeeds, because the branch changed, not the routine."""
    project = workspace["project"]
    branch = conflicting_branch(workspace, published=True)
    claude = fake_claude(
        "cat > /dev/null\n"
        'printf "resolved by the step\\n" > contested.txt\n'
        "git add -A\n"
        "git commit -q --no-edit\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="resolve", push="branch")
    assert rc == 0, out
    ff = subprocess.run(
        ["git", "-C", str(project), "merge", "-q", "--ff-only", branch],
        capture_output=True, text=True,
    )
    assert ff.returncode == 0, ff.stderr


def test_a_resolve_that_gives_up_leaves_the_branch_exactly_where_it_was(
    runner, workspace, fake_claude, origin
):
    """Criteria 6 and 7. Tests red, or a conflict the skill will not
    decide: the merge is undone, HEAD never moves, and the HEAD-moved
    push gate therefore publishes nothing. No new rollback machinery —
    the gate that already exists is the one that holds."""
    project = workspace["project"]
    branch = conflicting_branch(workspace, published=True)
    before = git(project, "rev-parse", branch)
    claude = fake_claude(
        "cat > /dev/null\n"
        "git merge --abort\n"
        f"echo '{json.dumps(RESULT_ERROR)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="resolve", push="branch")
    assert out["ok"] is False, out
    # It gave up, which is not the same as never having started: the
    # step must have been handed the conflict before it decided.
    assert out["terminalReason"] != "refused", out
    assert fake_claude.calls.exists(), "the step must have been invoked at all"
    assert git(project, "rev-parse", branch) == before, "the branch must be left exactly as it was found"
    assert git(origin["project"], "branch", "--list", branch) == "", \
        "nothing may reach origin from a resolve that gave up"


def test_a_resolve_that_walks_away_mid_merge_publishes_no_conflict_markers(
    runner, workspace, fake_claude, origin
):
    """The step can die between opening the conflict and deciding — a
    crash, a cancellation, a budget stop. The generic commit loop would
    otherwise `git add -A` the conflict markers and commit them as the
    merge, which is the half-merged tree the whole codebase refuses to
    leave anywhere."""
    project = workspace["project"]
    branch = conflicting_branch(workspace, published=True)
    before = git(project, "rev-parse", branch)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_ERROR)}'")
    rc, out, _ = run(runner, workspace, claude, command="resolve", push="branch")
    assert out["terminalReason"] != "refused", out
    assert fake_claude.calls.exists(), "the step must have been invoked at all"
    assert git(project, "rev-parse", branch) == before, "an undecided merge must not be committed"
    assert "<<<<<<<" not in git(project, "show", f"{branch}:contested.txt")
    assert git(origin["project"], "branch", "--list", branch) == ""


@pytest.mark.parametrize("step", ["analyze", "implement", "archive"])
def test_every_other_step_still_refuses_a_conflict(runner, workspace, fake_claude, step):
    """Criterion 9. The fork is on the literal string `resolve` and
    nothing else, so every step that refused yesterday refuses today —
    a step let past a conflict would commit the markers."""
    project = workspace["project"]
    conflicting_branch(workspace)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command=step)
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "conflict" in out["error"]
    assert git(project, "status", "--porcelain") == ""


def test_resolve_behaves_like_any_other_step_when_there_is_nothing_to_resolve(
    runner, workspace, fake_claude
):
    """The fork must only bite on a real conflict. A `resolve` run on a
    branch that merges cleanly is an ordinary step."""
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    git(project, "switch", "-q", "main")
    (project / "moved-on.txt").write_text("landed on main after the branch was made\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "later work on main")
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="resolve")
    assert rc == 0, out
    assert is_ancestor(project, "main", branch)


# --- the step vocabulary lives in two files (spec 91's open flaw) ------------
# `WORKFLOW_STEPS` is a bash string here and a TypeScript array there,
# with no shared source and no compiler between them. Adding a step to
# one and forgetting the other gives a dashboard that offers a step the
# script refuses. Deduplicating the two is out of scope for spec 106;
# noticing the drift is not.

def test_the_two_copies_of_the_step_vocabulary_agree(workspace_root):
    import re

    bash = (workspace_root / "core" / "scripts" / "aide-run-spec").read_text()
    m = re.search(r'^WORKFLOW_STEPS="([^"]*)"', bash, re.M)
    assert m, "aide-run-spec no longer declares WORKFLOW_STEPS as a plain string"
    from_bash = set(m.group(1).split())

    ts = (workspace_root / "dashboard" / "src" / "queue.ts").read_text()
    m = re.search(r"export const WORKFLOW_STEPS = \[(.*?)\] as const;", ts, re.S)
    assert m, "queue.ts no longer declares WORKFLOW_STEPS as a literal array"
    from_ts = set(re.findall(r'"([^"]+)"', m.group(1)))

    assert from_bash == from_ts, (
        "the script and the dashboard disagree about which steps exist: "
        f"only in the script {sorted(from_bash - from_ts)}, "
        f"only in the dashboard {sorted(from_ts - from_bash)}"
    )


# --- spec 125: the second tool ----------------------------------------------
#
# The queue, the worktrees, the timeout and the git handling stay one
# path. What differs per tool is the command it is started with, how it
# is told what it may do, and what it reports when it is done — so these
# tests are about exactly those three things, plus the promise that a
# caller who says nothing still gets Claude and gets it unchanged.

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
                     timeout_sec="2", kill_grace_sec="1")
    elapsed = time.time() - started
    assert out["terminalReason"] == "timeout"
    assert out["ok"] is False
    assert out["tool"] == "codex"
    assert "costUsd" not in out
    assert out["costMeasured"] is False
    assert "tokens" not in out
    assert elapsed < 12, f"the kill took too long: {elapsed:.1f}s"


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
