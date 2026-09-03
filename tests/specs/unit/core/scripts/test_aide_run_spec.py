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
import re
import shlex
import shutil
import signal
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
    # `analyze` on the line: the default fixture is `implement`'s normal
    # starting point (spec 344's own gate refuses `implement` before
    # `analyze` has run), the same way it already was `implement`'s
    # normal PRECONDITION before this line existed.
    (specs / "81-queue-and-runner" / "4-status.md").write_text(
        "# Queue - Status\n\n## Tracking info\n\n"
        "- **Task:** `81-queue-and-runner/`\n"
        "- **Workflow steps completed:** analyze\n"
    )
    subprocess.run(["git", "-C", str(specs), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(specs), "commit", "-qm", "add spec"], check=True)
    # .aide/config is gitignored here, scoped to the FIXTURE itself
    # (spec 345: no project's .aide/config is tracked, aide's own
    # included) rather than relying on the machine's own global ignore,
    # so the fixture stays hermetic.
    (project / ".gitignore").write_text("/deps/\n.aide/config\n")
    (project / "deps").mkdir()
    (project / "deps" / "marker.txt").write_text("the dependency tree\n")
    (project / ".aide").mkdir()
    # AIDE_TEST_CMD=true: the archive gate (spec 329) runs the project's
    # test command when no passing record is on file, and a fixture with
    # no command at all would be refused before anything under test ran.
    (project / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={specs}\nAIDE_WORKTREE_LINKS=deps\nAIDE_TEST_CMD=true\n"
    )
    subprocess.run(["git", "-C", str(project), "add", ".gitignore"], check=True)
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


def run(runner, ws, claude=None, codex=None, return_stderr=False, **kwargs):
    """Invoke the runner; return (returncode, parsed json line, stdout).

    `codex=` is the sibling of `claude=` and exists for the same reason
    (spec 125): the helper has no generic `env=` kwarg, so a Codex test
    would otherwise have no way to point the runner at its fake binary.

    `return_stderr=True` appends `proc.stderr` and makes it a 4-tuple.
    An OPT-IN rather than a fourth element for everybody (spec 184):
    this helper is called well over a hundred times in this file, almost
    all of them unpacking exactly three values, and widening the return
    shape would break every one of them to serve the handful of tests
    that read the runner's live diagnostics.
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
    if return_stderr:
        return proc.returncode, json.loads(line), proc.stdout, proc.stderr
    return proc.returncode, json.loads(line), proc.stdout


# --- the claude binary can be named per project -------------------------------
#
# AIDE_CLAUDE_BIN in the environment points EVERY run the dashboard starts
# at one binary. A project that wants a stand-in — aide-test's scripted
# model — names it in its own .aide/config instead, and only that
# project's runs follow. The environment still wins where both are set.

def test_the_claude_binary_can_be_named_in_the_projects_own_config(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")  # dry run: must not be called
    cfg = workspace["project"] / ".aide" / "config"
    cfg.write_text(cfg.read_text() + f"AIDE_CLAUDE_BIN={claude}\n")
    env_before = os.environ.pop("AIDE_CLAUDE_BIN", None)
    try:
        rc, out, _ = run(runner, workspace, dry_run=True)
    finally:
        if env_before is not None:
            os.environ["AIDE_CLAUDE_BIN"] = env_before
    assert rc == 0, out
    assert out["argv"][0] == str(claude)
    assert not fake_claude.calls.exists()


def test_the_environment_outranks_the_projects_config_for_the_claude_binary(runner, workspace, fake_claude):
    from_env = fake_claude("exit 1")
    cfg = workspace["project"] / ".aide" / "config"
    cfg.write_text(cfg.read_text() + "AIDE_CLAUDE_BIN=/nowhere/from-config\n")
    rc, out, _ = run(runner, workspace, from_env, dry_run=True)
    assert rc == 0, out
    assert out["argv"][0] == str(from_env)


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


def test_the_prompt_says_never_to_wait_on_background_work(runner, workspace, fake_claude):
    """Four implement runs on 2026-09-02 ended their turn with "the
    tests are running in the background, I'll pick up when they
    finish" — and nothing ever picked up, because a headless run ends
    the moment the model stops. The prompt has to say so, in the text
    the model is reading, not in a rule it has to remember."""
    claude = fake_claude("cat > /dev/null\nexit 1")
    rc, out, _ = run(runner, workspace, claude, dry_run=True, command="implement")
    assert rc == 0
    lowered = out["prompt"].lower()
    assert "background" in lowered
    assert "foreground" in lowered
    assert "end your turn" in lowered


# --- Criterion 2: the refusals -----------------------------------------------

def test_a_dirty_project_tree_does_not_stop_the_run(runner, workspace, fake_claude, command="implement"):
    """Spec 144. The run works in a worktree cut from origin's default
    branch, so nothing in the main checkout reaches it — dirty or not.
    A stray file used to refuse every job touching the repo, however
    unrelated it was to the spec being run."""
    (workspace["project"] / "scratch.txt").write_text("uncommitted\n")
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert not out.get("error"), out["error"]
    # And the stray file is left exactly as it was: never staged,
    # committed, or removed.
    assert (workspace["project"] / "scratch.txt").read_text() == "uncommitted\n"
    assert git(workspace["project"], "status", "--porcelain") == "?? scratch.txt"
    branch = "aide/81-queue-and-runner"
    assert "scratch.txt" not in git(workspace["project"], "show", "--name-only", "--pretty=", branch)


def test_a_dirty_specs_root_does_not_stop_the_run(runner, workspace, fake_claude, command="implement"):
    """The specs repo is where /aide-analyze actually writes, so it was
    the root the old refusal guarded hardest. Its worktree is cut from
    origin's default branch too (spec 144)."""
    (workspace["specs"] / "stray.md").write_text("uncommitted\n")
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
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
    # Spec 153: a refusal with nothing a machine can act on says nothing
    # — the key is absent, not null and not empty. Same rule as
    # `specFolder` and `tokens`.
    assert "errorReason" not in out
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
    rc, out, err = run(runner, workspace, claude)
    assert rc == 0, err[-1500:]
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


def _standalone_runner_copy(runner, tmp_path, name="aide-run-spec-under-test"):
    """A working stand-in for `aide-run-spec`, in its own directory: the
    script itself, plus the two files it reads relative to its own
    location (`_aide-spec-lib.sh`, and — since spec 349 —
    `lib/workflow-steps.json`, without which every command refuses)."""
    copy = tmp_path / name
    copy.write_bytes(pathlib.Path(runner).read_bytes())
    copy.chmod(0o755)
    (tmp_path / "_aide-spec-lib.sh").write_bytes(
        (pathlib.Path(runner).parent / "_aide-spec-lib.sh").read_bytes()
    )
    (tmp_path / "lib").mkdir(exist_ok=True)
    (tmp_path / "lib" / "workflow-steps.json").write_bytes(
        (pathlib.Path(runner).parent / "lib" / "workflow-steps.json").read_bytes()
    )
    # status-progress.sh too: sourced by the runner whenever a
    # 4-status.md exists — which, since spec 344's fixture, is every run.
    (tmp_path / "lib" / "status-progress.sh").write_bytes(
        (pathlib.Path(runner).parent / "lib" / "status-progress.sh").read_bytes()
    )
    return copy


def test_survives_its_own_file_being_replaced_mid_run(runner, workspace, fake_claude, tmp_path):
    """An aide `implement` step reinstalls aide, which copies this very
    script over itself. Bash reads a script incrementally from disk, so
    without a private copy the runner dies mid-job — measured on the
    first end-to-end run, eight minutes in, after the work had already
    succeeded."""
    copy = _standalone_runner_copy(runner, tmp_path)
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
    copy = _standalone_runner_copy(runner, tmp_path)
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
    rc, out, _ = run(runner, workspace, claude, timeout_sec="8", kill_grace_sec="2")
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
    assert elapsed < 90, f"the kill took too long: {elapsed:.1f}s"

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
    assert "8s" in out["error"], "the limit's own number belongs in the sentence"
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
    rc, out, _ = run(runner, workspace, claude, timeout_sec="8", kill_grace_sec="5")
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
    rc, out, _ = run(runner, workspace, claude, timeout_sec="8", kill_grace_sec="30")
    elapsed = time.time() - started
    assert marker.exists(), "SIGTERM must reach the child"
    assert elapsed < 30, "the run should end when the child exits, not wait out the whole grace"
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


def project_only_claude(fake_claude, workspace):
    """A claude that writes to the project and nowhere else — the shape
    of a real `implement` step, which changes code and leaves the specs
    root with nothing of its own to commit.
    """
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "written by the step" > "$PWD/new-code.txt"\n'
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


@pytest.fixture
def local_origin(workspace, tmp_path):
    """Bare repos with a plain LOCAL path as `origin` — no github.com in
    sight, unlike the `origin` fixture above. The shape a throwaway,
    fully local round (spec 367) actually has: nothing to build a
    compare-page link from, but a push that still has to be landable."""
    project_bare = tmp_path / "local-origin.git"
    specs_bare = tmp_path / "local-specs-origin.git"
    for bare in (project_bare, specs_bare):
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", str(project_bare))
    git(workspace["project"], "push", "-q", "origin", "main")
    git(workspace["specs"], "remote", "add", "origin", str(specs_bare))
    git(workspace["specs"], "push", "-q", "origin", "main")
    return {"project": project_bare, "specs": specs_bare}


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


def workflow_steps_line(repo, branch, folder, name="4-status.md"):
    """The `Workflow steps completed:` line as a fresh read of `repo`'s
    own copy of `branch` sees it — never the working tree, which the run's
    own worktree removal already tore down by the time a test looks."""
    text = git(repo, "show", f"{branch}:{folder}/{name}")
    lines = [l for l in text.splitlines() if "Workflow steps completed" in l]
    return lines[0] if lines else None


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


def partially_committing_claude(fake_claude, workspace, then=""):
    """A step that commits PART of its own work and leaves the rest on
    disk — spec 142's actual shape, and what the global git rules
    produce headlessly: new files may be added by name, modified
    tracked files are left for a user in an IDE who is not there.

    The committed message has a body on purpose: a stop reason appended
    to it must land on its own line, not glued to the last body line.
    """
    return fake_claude(
        "cat > /dev/null\n"
        + 'echo "committed by the step" > "$PWD/self-committed.txt"\n'
        + "git add self-committed.txt\n"
        + "git commit -q -m 'The step wrote this itself' "
        + "-m 'And explained why, the way a written message does.'\n"
        + 'echo "left behind by the step" > "$PWD/left-behind.txt"\n'
        + then
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


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


# --- a reused branch must not carry stale code -------------------------------

def is_ancestor(repo, a, b):
    return subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", a, b]
    ).returncode == 0


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


# --- spec 153: origin's copy of the branch, not this machine's ---------------
# The `origin` fixture below points the FETCH url at a real GitHub
# address (that is where the compare link comes from), so no test using
# it can fetch. These need a remote that answers both ways.


@pytest.fixture
def fetchable_origin(workspace, tmp_path):
    """A bare project origin reachable for fetch as well as push."""
    bare = tmp_path / "fetchable-origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", str(bare))
    git(workspace["project"], "push", "-q", "origin", "main")
    return bare


# --- spec 343: a step's own bookkeeping only counts once origin has it -------
# The `origin`/`fetchable_origin` fixtures above answer one of two
# questions each: `origin` proves the compare-link derivation (a real
# github.com fetch url) without ever letting a confirmation succeed;
# `fetchable_origin` proves a confirmation can succeed, but only for the
# PROJECT root. REQ-4's own success case needs both roots confirmable at
# once, and REQ-2/REQ-3/REQ-6 need a push that reaches the network and is
# genuinely REFUSED there, not one that never leaves the machine at all.


@pytest.fixture
def fetchable_origin_both_roots(workspace, tmp_path):
    """A bare origin reachable for fetch and push, wired into BOTH the
    project and the specs repo — `fetchable_origin` only wires up the
    project, which is not enough for a run to end ok:true once REQ-1's
    confirmation asks about every root the step branched."""
    project_bare = tmp_path / "fetchable-origin-project.git"
    specs_bare = tmp_path / "fetchable-origin-specs.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(project_bare)], check=True)
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(specs_bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", str(project_bare))
    git(workspace["project"], "push", "-q", "origin", "main")
    git(workspace["specs"], "remote", "add", "origin", str(specs_bare))
    git(workspace["specs"], "push", "-q", "origin", "main")
    return {"project": project_bare, "specs": specs_bare}


def _reject_every_push(bare):
    """A bare repo whose `pre-receive` hook refuses everything: the push
    reaches the network and is SEEN, then refused — the shape REQ-2/
    REQ-3/REQ-6 need, unlike an origin that is simply unreachable."""
    hook = bare / "hooks" / "pre-receive"
    hook.write_text("#!/usr/bin/env bash\nexit 1\n")
    hook.chmod(0o755)


@pytest.fixture
def rejecting_origin(workspace, tmp_path):
    """Both roots wired to a bare origin that is reachable but refuses
    every push — a step's own content never reaches origin at all."""
    project_bare = tmp_path / "rejecting-origin-project.git"
    specs_bare = tmp_path / "rejecting-origin-specs.git"
    for bare in (project_bare, specs_bare):
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
        _reject_every_push(bare)
    git(workspace["project"], "remote", "add", "origin", str(project_bare))
    git(workspace["specs"], "remote", "add", "origin", str(specs_bare))
    return {"project": project_bare, "specs": specs_bare}


@pytest.fixture
def specs_origin_rejecting_the_second_push(workspace, tmp_path):
    """REQ-2: the specs root's FIRST push (the step's own content, pass
    1) succeeds; every push after that (the line-only commit, pass 2) is
    refused. Proves pass 2's confirmation is checked independently of
    pass 1's success, using a fixture nothing here already provides."""
    bare = tmp_path / "specs-origin-reject-second-push.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    counter = tmp_path / "specs-origin-push-count"
    hook = bare / "hooks" / "pre-receive"
    hook.write_text(
        "#!/usr/bin/env bash\n"
        f'n=0; [ -f "{counter}" ] && n="$(cat "{counter}")"\n'
        f'n=$((n + 1)); echo "$n" > "{counter}"\n'
        '[ "$n" -ge 2 ] && exit 1\n'
        "exit 0\n"
    )
    hook.chmod(0o755)
    git(workspace["specs"], "remote", "add", "origin", str(bare))
    return bare


# --- spec 359: a push that only needs a pull is retried, not reported --------
# `push_with_retry` (aide-run-spec) asks origin directly whether a failed
# push means the branch moved (REQ-1: `pull --rebase` settles it) or
# origin could not be reached at all (REQ-2: retry the push itself,
# waited). Both roots need a real, reachable origin here — a WORKFLOW_ARC
# command's PASS 2 (the workflow-steps line) always pushes the specs
# root too, and an unrelated "no origin remote" there would contaminate
# `pushError` — so every test below uses `fetchable_origin_both_roots`.


def race_pushing_claude(fake_claude, workspace, origin_bare, branch, race_marker, race_dir):
    """The step's own script plays TWO parts: itself, writing its own
    file exactly as any real step does, and a stand-in for a second,
    concurrent process (another run, or a landing) that reaches origin's
    copy of the SAME branch first, via an independent clone. The race is
    real git against a real bare repo — no mocking — the shape REQ-1's
    `pull --rebase` retry has to recover from."""
    return fake_claude(
        "cat > /dev/null\n"
        + f'git clone -q "{origin_bare}" "{race_dir}"\n'
        + f'git -C "{race_dir}" switch -q -c "{branch}"\n'
        + f'echo "raced" > "{race_dir}/raced.txt"\n'
        + f'git -C "{race_dir}" add -A\n'
        + f'git -C "{race_dir}" commit -q -m "a concurrent push landed here first"\n'
        + f'git -C "{race_dir}" rev-parse HEAD > {race_marker}\n'
        + f'git -C "{race_dir}" push -q origin "{branch}"\n'
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


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


def conflicting_race_claude(fake_claude, workspace, origin_bare, branch, race_marker, race_dir):
    """Like `race_pushing_claude`, but the concurrent process edits the
    SAME line of a tracked file this step's own worktree also edits —
    the shape REQ-3/REQ-7 need: a `pull --rebase` retry that hits a
    REAL, same-line conflict, which the script must abort and report,
    never resolve by force."""
    return fake_claude(
        "cat > /dev/null\n"
        + f'git clone -q "{origin_bare}" "{race_dir}"\n'
        + f'git -C "{race_dir}" switch -q -c "{branch}"\n'
        + f'echo "their line" > "{race_dir}/README.md"\n'
        + f'git -C "{race_dir}" commit -q -am "their side"\n'
        + f'git -C "{race_dir}" rev-parse HEAD > {race_marker}\n'
        + f'git -C "{race_dir}" push -q origin "{branch}"\n'
        + 'echo "our line" > "$PWD/README.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


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


# --- spec 328: a step that both commits and pushes its own work --------------
# A step that commits under its own message (spec 146) can also push that
# commit itself before the run's own tracking-stamp write leaves anything
# else to fold in. Spec 327's own analyze run did exactly that, headless,
# and the generic commit loop then amended a commit that had already
# reached origin — the amend never did, and the branch was left diverged
# from itself two steps later.


def self_pushing_claude(fake_claude, workspace, sha_marker, then=""):
    """Commits part of its own work under a written message AND pushes
    that commit to origin itself, then leaves more on disk — spec 146's
    `partially_committing_claude` shape, plus the push spec 327's run
    actually did. `sha_marker` records the step's own commit sha so a
    test can tell an amend (a new sha) from a second commit (this sha
    kept as an ancestor) after the run has torn the worktree down.
    """
    return fake_claude(
        "cat > /dev/null\n"
        + 'echo "committed by the step" > "$PWD/self-committed.txt"\n'
        + "git add self-committed.txt\n"
        + "git commit -q -m 'The step wrote this itself'\n"
        + f"git rev-parse HEAD > {sha_marker}\n"
        + 'git push -q origin "$(git rev-parse --abbrev-ref HEAD)"\n'
        + 'echo "left behind by the step" > "$PWD/left-behind.txt"\n'
        + then
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


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


# --- spec 197: a branch whose work already landed is not reused --------------
# The landing deletes the branch on origin; this checkout's copy was left
# behind, and the reuse block picks a branch up by name alone. Spec 181
# was reopened and refused to start on exactly that leftover. So the
# reuse block asks first whether the work is already in origin's default
# branch — and only that question, never "is the branch still on
# origin", which a push that never arrived would answer the same way.


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


# --- passenger projects: removed -------------------------------------------
# A run could be told about a third repository with --extra-project-dir, and
# would watch, branch, commit and push it like any other root (spec 83, after
# spec 81's implement wrote into a repo nobody had named). The dashboard's
# tick box for it was used by none of the 200 jobs the queue held, so box,
# field and flag went together. The flag is an unknown argument now, and the
# test below is what says so.


def test_extra_project_dir_is_no_longer_an_argument(runner, workspace, fake_claude):
    claude = fake_claude(f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, extra_project_dir="/tmp/whatever")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "unknown argument" in out["error"]
    assert "--extra-project-dir" in out["error"]


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


def test_a_rejected_provider_limit_overrides_a_contradictory_success(runner, workspace, fake_claude):
    limit = {
        "type": "rate_limit_event",
        "rate_limit_info": {
            "status": "rejected",
            "rateLimitType": "seven_day",
            "resetsAt": 1787587200,
        },
    }
    result = {
        **RESULT_OK,
        "is_error": True,
        "terminal_reason": "api_error",
        "api_error_status": 429,
    }
    claude = fake_claude(stream_body(result, before=[limit], exit_code=1))
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert out["ok"] is False
    assert out["terminalReason"] == "provider-limit"
    assert "seven day" in out["error"]
    assert "2026-08-24" in out["error"]


def test_credit_carrying_a_spent_window_is_not_a_stop(runner, workspace, fake_claude):
    """`status: rejected` says the subscription window is spent, not
    that the call was refused. The event below is verbatim from the
    07:26 run on 2026-08-25: purchased credit carried every call, the
    step finished its work, and the run was reported stopped anyway."""
    limit = {
        "type": "rate_limit_event",
        "rate_limit_info": {
            "status": "rejected",
            "rateLimitType": "seven_day",
            "resetsAt": 1787803200,
            "overageStatus": "allowed",
            "overageResetsAt": 1788220800,
            "isUsingOverage": True,
            "overageInUse": True,
        },
    }
    claude = fake_claude(stream_body(RESULT_OK, before=[limit]))
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"


def test_is_error_prevents_a_success_subtype_from_completing(runner, workspace, fake_claude):
    result = {**RESULT_OK, "is_error": True, "errors": ["provider request failed"]}
    claude = fake_claude(stream_body(result))
    _, out, _ = run(runner, workspace, claude)
    assert out["ok"] is False
    assert out["terminalReason"] == "cli-error"
    assert "provider request failed" in out["error"]


def test_nonzero_exit_prevents_a_success_subtype_from_completing(runner, workspace, fake_claude):
    claude = fake_claude(stream_body(RESULT_OK, exit_code=1))
    _, out, _ = run(runner, workspace, claude)
    assert out["ok"] is False
    assert out["terminalReason"] == "cli-error"
    assert "exit 1" in out["error"]


def test_exit_zero_and_a_non_error_success_still_complete(runner, workspace, fake_claude):
    claude = fake_claude(stream_body(RESULT_OK, exit_code=0))
    _, out, _ = run(runner, workspace, claude)
    assert out["ok"] is True
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
                     timeout_sec="8", kill_grace_sec="2")
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
    # REPO — the worktree is a view of it, not a copy. Across the whole
    # branch, not just its last commit: the step's own content and the
    # `Workflow steps completed` line land in separate commits (spec 343).
    assert "2-analysis.md" in git(workspace["specs"], "log", "--name-only", "--pretty=", f"main..{BRANCH}")
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
    rc, out, _ = run(runner, workspace, claude, timeout_sec="8", kill_grace_sec="2")
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

    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace), command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert worktrees(workspace["project"]) == [str(workspace["project"])]


# --- spec 215: no empty branch survives the run -----------------------------


def test_a_run_that_leaves_a_root_untouched_deletes_the_empty_branch(
    runner, workspace, fake_claude
):
    """An analyze step commits nothing in the project, so the branch it
    cut there carries nothing — and a branch carrying nothing is a
    branch a later run can only trip over. Three runs were refused on
    2026-08-23 with `cannot create aide/<spec> in a worktree of`, and
    every one of those branches had to be deleted by hand, in two
    repositories each."""
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace))
    assert rc == 0, out
    assert git(workspace["project"], "branch", "--list", BRANCH) == "", \
        "a branch with no commits on it must not outlive the run that cut it"
    assert BRANCH in git(workspace["specs"], "branch", "--list", BRANCH), \
        "and the root that DID get work keeps its branch"


def test_a_run_that_stops_early_deletes_its_empty_branches_too(runner, workspace, fake_claude):
    """The cleanup hangs off the same EXIT trap the worktree removal
    does, so it has to fire on every exit path. A run that stops before
    the step wrote anything leaves an empty branch in BOTH roots, which
    is the worst version of the leftover — two repositories to clean by
    hand for one spec."""
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_BUDGET)}'; exit 1")
    rc, out, _ = run(runner, workspace, claude)
    assert out["terminalReason"] == "budget", out
    for repo in (workspace["project"], workspace["specs"]):
        assert git(repo, "branch", "--list", BRANCH) == "", \
            f"{repo} kept an empty branch after a run that stopped early"


def test_a_second_run_for_the_same_spec_starts_from_a_clean_slate(
    runner, workspace, fake_claude
):
    """The reported symptom: run a step twice on one spec and the second
    run must get going, not refuse over its own leavings."""
    claude = specs_only_claude(fake_claude, workspace)
    rc1, out1, _ = run(runner, workspace, claude)
    assert rc1 == 0, out1
    rc2, out2, stdout2 = run(runner, workspace, claude)
    assert rc2 == 0, out2
    assert out2["terminalReason"] == "completed", out2
    assert "cannot create" not in stdout2


def test_a_branch_carrying_work_survives_a_run_that_adds_nothing_to_it(
    runner, workspace, fake_claude
):
    """The other half of the rule: only a branch that carries NOTHING is
    swept. An earlier step's commit, still unpushed, is the one thing
    this cleanup must never be able to lose — and `head did not move
    during THIS run` is not the same question as `this branch is
    empty`."""
    project = workspace["project"]
    git(project, "switch", "-q", "-c", BRANCH)
    (project / "from-the-earlier-step.txt").write_text("implement wrote this\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "an earlier step")
    earlier = git(project, "rev-parse", "HEAD")
    git(project, "switch", "-q", "main")

    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace))
    assert rc == 0, out
    assert BRANCH in git(project, "branch", "--list", BRANCH), "the branch must survive"
    assert is_ancestor(project, earlier, BRANCH), "and so must its commit"


# --- Criterion 10: two runs, same repos, at the same time -------------------

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


# --- Spec 256: the per-root worktree lock ------------------------------------
#
# The test above proves two runs stay isolated once both are already going —
# its gate lives inside the fake `claude`, which only runs after the worktree
# is already built. It cannot force the actual reported crash: two processes
# hitting `git worktree add` against the SAME root at the same instant. That
# call, and the git calls around it, run in well under the time it takes two
# `subprocess.Popen` processes to drift apart in practice, so leaving them
# unsynchronized would make the race test flaky in the direction of never
# catching the bug. A `git` shim on PATH — the same "fake external binary
# recording argv" shape as `fake_claude`, applied to `git` instead — pauses
# each process right before its own `worktree add` call, so the test can
# force them together deterministically instead of hoping for a collision.

def make_worktree_add_gate(tmp_path, name, target_root, events_file):
    """A `git` shim that pauses the ONE invocation matching
    `-C <target_root> worktree add ...`, touching `<name> ready` in
    `events_file` and blocking on a `<name>-go` file before running the
    real `git` — then records `<name> done` once it returns. Every other
    git invocation (including `worktree add` against a DIFFERENT root)
    passes straight through, unrecorded.
    """
    real_git = shutil.which("git")
    shim_dir = tmp_path / f"git-shim-{name}"
    shim_dir.mkdir()
    go = tmp_path / f"{name}-go"
    shim = shim_dir / "git"
    shim.write_text(
        "#!/usr/bin/env bash\n"
        f"real={shlex.quote(real_git)}\n"
        f'if [ "$1" = "-C" ] && [ "$2" = {shlex.quote(str(target_root))} ] '
        '&& [ "$3" = "worktree" ] && [ "$4" = "add" ]; then\n'
        f'  echo "{name} ready" >> {shlex.quote(str(events_file))}\n'
        f"  while [ ! -f {shlex.quote(str(go))} ]; do sleep 0.05; done\n"
        '  "$real" "$@"\n'
        "  rc=$?\n"
        f'  echo "{name} done" >> {shlex.quote(str(events_file))}\n'
        "  exit $rc\n"
        "fi\n"
        'exec "$real" "$@"\n'
    )
    shim.chmod(0o755)
    return shim_dir, go


def wait_until(condition, timeout, message):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if condition():
            return
        time.sleep(0.05)
    raise AssertionError(message)


def make_named_writing_claude(tmp_path, name, folder, tag):
    """A stand-in `claude`, written to its OWN file (unlike the
    `fake_claude` fixture, which always writes to the same path — fine
    for sequential use, but two of these have to exist and differ AT THE
    SAME TIME for a concurrency test). Leaves a `tag`-named marker in
    both the project and the specs root, the way `writing_claude` does."""
    path = tmp_path / f"fake-claude-{name}"
    path.write_text(
        "#!/usr/bin/env bash\n"
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "{tag}" > "$PWD/{tag}.txt"\n'
        + f'echo "{tag}" > "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'\n"
    )
    path.chmod(0o755)
    return path


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


# --- Criterion 3 (spec 256): different projects never share a lock ----------

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


# --- Criterion 4 (spec 256): a killed run's lock is reclaimed ---------------

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


# --- Criterion 5 (spec 256): SIGTERM releases the lock ----------------------

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


# --- Spec 186: a link names what is read, never what is written --------------
# The link is a symlink into the ONE main checkout every concurrent run
# shares. A dependency cache a build only reads is what makes that cheap;
# a directory the build WRITES into is two runs overwriting each other,
# or a tool locking a cache the other is using. The source is created in
# each case so the existence check above cannot be what refuses it.


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


# --- the build-output denylist lives in two files, like the two lists above --
# Third of the same shape: a bash string in the script, a TypeScript
# array in the dashboard, no shared source. Denying a name in one and not
# the other gives a dashboard that accepts a link the run refuses.


def test_the_two_copies_of_the_worktree_link_denylist_agree(workspace_root):
    import re

    bash = (workspace_root / "core" / "scripts" / "aide-run-spec").read_text()
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


# --- Spec 184: where the worktree links are READ from ------------------------
#
# `.aide/config` is gitignored, so the links a project's own commands
# need — true on every machine that checks the repo out — were lost every
# time the project met a new one. They live in the committed
# `.aide/project.yaml` now, with the old spelling still read as a
# fallback so a project migrated on one machine keeps running on the
# others. The two files and the four ways they can be filled in are one
# table, shared with the dashboard's own test of the same rule:
# tests/fixtures/worktree-links-precedence.json.

PRECEDENCE = json.loads(
    (pathlib.Path(__file__).resolve().parents[4] / "fixtures" / "worktree-links-precedence.json")
    .read_text()
)["cases"]


def configure_links(workspace, manifest, config):
    """Write a precedence case's two files, and make sure every path
    either of them names is actually there — a link with no source is a
    refusal of its own (spec 138), and it is not what these tests are
    about."""
    project = workspace["project"]
    for value in (manifest, config):
        for entry in (value or "").split():
            (project / entry).mkdir(parents=True, exist_ok=True)
            (project / entry / "marker.txt").write_text("a dependency tree\n")
    (project / ".gitignore").write_text("/deps/\n/other-deps/\n")
    (project / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={workspace['specs']}\n"
        + (f"AIDE_WORKTREE_LINKS={config}\n" if config else "")
    )
    (project / ".aide" / "project.yaml").write_text(
        "name: proj\n" + (f"worktreeLinks: {manifest}\n" if manifest else "")
    )
    git(project, "add", "-f", ".aide/config", ".aide/project.yaml", ".gitignore")
    git(project, "commit", "-q", "-m", "configure the links")


def linking_claude(fake_claude, workspace, candidates):
    """A claude that records which of `candidates` was symlinked into the
    worktree it is standing in — the only moment the question can be
    asked, since the worktree goes with the run."""
    log = workspace["project"].parent / "links-seen.txt"
    body = "cat > /dev/null\n" + READ_SPECS
    for entry in candidates:
        body += f'if [ -L "$PWD/{entry}" ]; then echo "{entry}" >> {log}; fi\n'
    body += f"echo '{json.dumps(RESULT_OK)}'"
    return fake_claude(body), log


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


# --- Spec 316: the readiness fixture's blocking prerequisites really refuse --
#
# Five hand-paired bash/TypeScript lists already exist in this repo, and
# four of them are pinned by a test that reads both sides and asserts they
# agree. Project readiness — the prerequisites below, mirrored in
# TypeScript by assessProjectReadiness() — was the fifth, and had nothing.
# This is that pin's bash half: for each BLOCKING entry the shared fixture
# names, a workspace built to match its failsWhen condition really makes
# aide-run-spec refuse.

READINESS_FIXTURE = json.loads(
    (pathlib.Path(__file__).resolve().parents[4] / "fixtures" / "project-readiness-prerequisites.json")
    .read_text()
)["prerequisites"]

# 2-analysis.md, Findings item 4: default_branch()'s own fallback chain
# ends in `git rev-parse --abbrev-ref HEAD`, which prints the literal
# string "HEAD" — never empty — in every git state tried that still
# passes the gitRoot check (an unborn/orphan branch, a rewritten
# .git/HEAD with an empty branch name). A .git/HEAD corrupted enough to
# make that command produce true empty output also fails
# `rev-parse --show-toplevel`, tripping gitRoot's refusal instead. There
# is no known way to trigger this ONE refusal in isolation through
# on-disk git state, so it is named in the fixture (for REQ-1, and
# because readiness.ts:76-85 genuinely mirrors it) and its bash-side
# scenario is skipped, by identity, rather than faked.
BASH_UNTESTABLE = {
    ("defaultBranch", "the default branch cannot be resolved in a root the run touches"),
}


def _break_git_root(workspace):
    # Not in any git repository at all.
    shutil.rmtree(workspace["project"] / ".git")


def _break_specs_root(workspace):
    shutil.rmtree(workspace["specs"])


def _break_default_branch_held_elsewhere(workspace):
    # A second worktree already holds `main`.
    git(workspace["project"], "checkout", "-q", "-b", "aide/other")
    subprocess.run(
        ["git", "worktree", "add", "-q", str(workspace["project"].parent / "elsewhere"), "main"],
        cwd=workspace["project"], check=True,
    )


def _break_worktree_links(workspace):
    (workspace["project"] / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={workspace['specs']}\nAIDE_WORKTREE_LINKS=nowhere\n"
    )
    git(workspace["project"], "add", "-f", ".aide/config")
    git(workspace["project"], "commit", "-q", "-m", "a link with no source")


# Each scenario is paired with a substring of the refusal it is meant to
# trigger — not just any `rc == 2`. Without this, breaking the project's
# .git (the gitRoot scenario) still refuses when the gitRoot check itself
# is disabled: `default_branch()` fails too, on an empty root, with a
# DIFFERENT message ("cannot work out the default branch in "). A bare
# `rc == 2` assertion would pass for that wrong reason — caught by doing
# the disable-and-confirm proof this comment describes, below.
READINESS_SCENARIOS = {
    ("gitRoot", "the project directory is not a git repository"): (_break_git_root, "not a git repository"),
    ("specsRoot", "the specs root does not exist as a directory"): (_break_specs_root, "no specs root at"),
    ("defaultBranch", "another worktree already has the default branch checked out"): (_break_default_branch_held_elsewhere, "cannot switch to"),
    ("worktreeLinks", "a configured worktree-link entry names a path that is not on disk"): (_break_worktree_links, "nowhere"),
}


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
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert log.read_text().split() == ["main", "main"], "healed before the worktree was made"
    assert "new-code.txt" in git(workspace["project"], "show", "--name-only", "--pretty=", BRANCH)


# --- Criterion 16: the pull is a courtesy, and it advances the DEFAULT branch -

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


# --- Criterion 19: an untracked .aide/config --------------------------------

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
# code — implement and archive. Every test below therefore names its
# command explicitly: the default `analyze` no longer reaches the
# guard at all, and a test left on the default would pass for the wrong
# reason. The steps that write only the spec's own folder in the specs
# repo (analyze, create) have their own tests further down.


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
    # The message names the spec, the dependency, and that it is not
    # archived yet (spec 351) — nobody should have to guess which of the
    # two specs is the problem.
    assert workspace["folder"] in out["error"]
    assert "80-dependency" in out["error"]
    assert "not archived yet" in out["error"]
    assert not fake_claude.calls.exists(), "the refusal must precede the money"
    assert not workspace["wtbase"].exists(), "and leave no worktree behind"


def test_a_dependency_merged_but_not_archived_still_refuses(
    runner, workspace, fake_claude, local_origins
):
    """Merged is not the same question as archived (spec 351). The Merge
    button deletes the branch after merging (spec 99), but an archive
    step re-creates it and merges it again minutes later — 97 and 102
    were each refused against a dependency whose branch was fully on
    main. Landing the code is not the same as archiving the spec: the
    folder is still under the active list, not archive/, so a dependent
    must still wait."""
    add_spec(workspace, "80-dependency")
    # The dependency's branch points AT origin's main: everything on it
    # is merged, only the name is left — but its folder is still active,
    # not archived.
    git(workspace["specs"], "push", "-q", "origin", "main")
    leave_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "80-dependency" in out["error"]
    assert "not archived yet" in out["error"]
    assert not fake_claude.calls.exists(), "the refusal must precede the money"


def test_a_dependency_with_no_branch_and_not_archived_still_refuses(
    runner, workspace, fake_claude, local_origins
):
    """The 340/341 shape (spec 351): a dependency whose last landed step
    deleted its branch and whose next step has not pushed a new one has
    no branch on origin at all — and used to read as 'merged'. Its
    folder never reached origin either way, so it is not archived and
    the dependent must still wait."""
    add_spec(workspace, "80-dependency")
    set_depends_on(workspace, "80")

    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "80-dependency" in out["error"]
    assert "not archived yet" in out["error"]
    assert not fake_claude.calls.exists(), "the refusal must precede the money"


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


def test_an_archived_dependency_confirmed_on_origin_lets_the_run_proceed(
    runner, workspace, fake_claude, local_origins, tmp_path
):
    """Archived is confirmed via a real read of origin (spec 351, REQ-2),
    never skipped because the local checkout already shows the folder
    under archive/ — the same staleness spec 343 already refused to
    trust for a landed commit."""
    add_spec(workspace, "80-dependency", archived=True)
    git(workspace["specs"], "push", "-q", "origin", "main")
    leave_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    rc, out, trace = run_traced(
        runner, workspace, writing_claude(fake_claude, workspace), tmp_path,
        command="implement",
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert "cat-file" in trace, "confirmed via a real read of origin, not skipped"


def test_a_dependency_archived_on_origin_is_confirmed_even_if_this_checkout_has_not_pulled(
    runner, workspace, fake_claude, local_origins, tmp_path
):
    """The check ASKS origin; it does not believe this checkout's own
    directory listing (spec 351, REQ-2).

    A dependency archived somewhere else — a later run, another
    machine — must be seen even before this checkout has ever pulled
    that commit. Believing the local listing instead would refuse every
    dependent run until someone happens to `git pull` first.
    """
    add_spec(workspace, "80-dependency")
    git(workspace["specs"], "push", "-q", "origin", "main")
    set_depends_on(workspace, "80")

    # Archived from a SEPARATE clone of the same bare origin, without
    # workspace["specs"] (this checkout) ever fetching that commit.
    clone = tmp_path / "elsewhere-specs"
    subprocess.run(["git", "clone", "-q", str(local_origins["specs"]), str(clone)], check=True)
    subprocess.run(["git", "-C", str(clone), "config", "user.name", "Elsewhere"], check=True)
    subprocess.run(["git", "-C", str(clone), "config", "user.email", "elsewhere@example.com"], check=True)
    (clone / "archive").mkdir(exist_ok=True)
    subprocess.run(["git", "-C", str(clone), "mv", "80-dependency", "archive/80-dependency"], check=True)
    subprocess.run(["git", "-C", str(clone), "commit", "-qm", "archive 80-dependency"], check=True)
    subprocess.run(["git", "-C", str(clone), "push", "-q", "origin", "main"], check=True)

    assert (workspace["specs"] / "80-dependency").exists(), \
        "this checkout must still show it active — the premise of the test"

    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command="implement"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert (workspace["specs"] / "80-dependency").exists(), \
        "the answer came from origin, not from moving anything locally"


# --- Spec 344: implement refuses to start before analyze has run ------------
#
# archive's own not-implemented-yet gate (core/scripts/aide-archive-spec)
# already refuses one workflow step early, reading the same `Workflow
# steps completed` line. This is the same gate, one step earlier: implement
# needs analyze the way archive needs implement.

def test_refuses_implement_before_analyze_has_run(runner, workspace, fake_claude):
    with_status(workspace, claims=["create"])
    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 2
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    assert out["errorReason"] == "not-analyzed-yet"
    assert workspace["folder"] in out["error"]
    assert "/aide-analyze" in out["error"]
    assert not fake_claude.calls.exists(), "the refusal must precede the money"
    assert not workspace["wtbase"].exists(), "and leave no worktree behind"


def test_implement_proceeds_once_analyze_is_on_the_line(runner, workspace, fake_claude):
    """Relies on the fixture's own default: `analyze` is already on the
    line, `implement`'s normal starting point since this spec."""
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "completed"


def test_analyze_is_unaffected_by_the_new_gate(runner, workspace, fake_claude):
    with_status(workspace, claims=[])
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["terminalReason"] == "completed"


def test_archive_keeps_its_own_gate(runner, workspace, fake_claude):
    """`analyze` on the line satisfies THIS gate, but archive's own
    not-implemented-yet check (spec 268) still asks about `implement`,
    which is not there — proving the new gate does not short-circuit or
    replace it."""
    with_status(workspace, claims=["analyze"])
    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "not-implemented-yet", out
    assert not fake_claude.calls.exists()


# --- Spec 122: the guard holds back only the steps that build on code -------
# analyze and create write only the spec's own folder in the
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
        runner, workspace, specs_only_claude(fake_claude, workspace), command="analyze"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"


def test_create_proceeds_despite_an_unmerged_dependency(
    runner, workspace, fake_claude, local_origins
):
    """Criterion 2: what holds for analyze holds for create, the other
    step that only writes the spec's own folder."""
    add_spec(workspace, "80-dependency")
    leave_unmerged_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command="create"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"


def test_create_proceeds_despite_an_unknown_or_self_dependency(
    runner, workspace, fake_claude, local_origins
):
    """The unknown and self cases are refusals for the gated steps only.
    A non-gated step never reaches the loop, so a typo is not its
    problem either — the step that acts on the dependency is where the
    refusal belongs."""
    set_depends_on(workspace, "77")  # nothing resolves to it
    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command="create"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"

    set_depends_on(workspace, "81")  # the spec's own number
    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command="create"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"


@pytest.mark.parametrize("command", ["archive"])
def test_the_other_gated_steps_still_refuse_an_unmerged_dependency(
    runner, workspace, fake_claude, local_origins, command
):
    """Criterion 3: implement is not the only gated step. archive moves
    the folder and lands the code — it builds on what has landed."""
    add_spec(workspace, "80-dependency")
    leave_unmerged_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    rc, out, _ = run(runner, workspace, fake_claude("exit 1"), command=command)
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "80-dependency" in out["error"]
    assert not fake_claude.calls.exists(), "the refusal must precede the money"


# --- Spec 202: the way out of an unlanded spec ------------------------------
# A landing that never finished leaves the folder under archive/ with its
# branch still on origin, and the dashboard offers Archive again for
# exactly that row. The runner refused it: --spec was resolved against
# the ACTIVE specs only, and the folder had already moved. The fallback
# below is the fourth "check archive/ too" in this codebase, and the
# narrowest: `archive` alone, and only while origin still holds the
# branch.


def test_archive_recovers_an_already_archived_spec_whose_branch_is_still_open(
    runner, workspace, fake_claude, local_origins
):
    """Criterion 1. Pressing Archive again on an unlanded row must reach
    the skill, not refuse "unknown spec"."""
    add_spec(workspace, "77-recovered", archived=True)
    leave_branch_on_origin(workspace, "aide/77-recovered")
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")

    rc, out, _ = run(runner, workspace, claude, command="archive", spec="77-recovered")

    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert fake_claude.calls.exists(), "the step must have been invoked at all"


def test_archive_recovers_an_already_archived_spec_by_its_number(
    runner, workspace, fake_claude, local_origins
):
    """The fallback mirrors the resolver above it: a bare id resolves to
    <id>-* under archive/ exactly as it does among the active specs."""
    add_spec(workspace, "77-recovered", archived=True)
    leave_branch_on_origin(workspace, "aide/77-recovered")
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")

    rc, out, _ = run(runner, workspace, claude, command="archive", spec="77")

    assert rc == 0, out
    assert out["terminalReason"] == "completed"


# --- Spec 211: a spec that is done says so ---------------------------------
# The half spec 202 left behind. A folder under archive/ whose branch is
# gone from every origin fell past the fallback above and landed on the
# same "unknown spec" refusal a typo gets — the spec exists, its work is
# on main, and the runner called it missing. Told apart here: found and
# finished is success with nothing to do; found nowhere is still a typo.


def test_archive_reports_an_already_landed_spec_as_done_not_refused(
    runner, workspace, fake_claude, local_origins
):
    """Criterion 1. An archived spec with nothing left on origin is
    finished work, not a name that does not exist. It is reported as
    success, and it names the folder so a reader can act on it."""
    add_spec(workspace, "77-recovered", archived=True)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")

    rc, out, _ = run(runner, workspace, claude, command="archive", spec="77-recovered")

    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "already-landed", out
    assert "77-recovered" in out["note"], out
    assert not fake_claude.calls.exists(), "nothing to archive costs nothing"


def test_an_already_landed_spec_resolves_by_its_number_too(
    runner, workspace, fake_claude, local_origins
):
    """The graceful outcome follows the same resolver the refusal did: a
    bare id finds <id>-* under archive/, so pressing Archive on a
    finished row says so whichever address the caller used."""
    add_spec(workspace, "77-recovered", archived=True)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")

    rc, out, _ = run(runner, workspace, claude, command="archive", spec="77")

    assert rc == 0, out
    assert out["terminalReason"] == "already-landed", out
    assert "77-recovered" in out["note"], out


def test_an_already_landed_spec_reports_the_same_outcome_to_the_result_file(
    runner, workspace, fake_claude, local_origins
):
    """The result file is what the dashboard reads, and it carries the
    same one JSON line stdout got — a caller never has to parse two
    shapes, refusal or not."""
    add_spec(workspace, "77-recovered", archived=True)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")

    rc, out, _ = run(runner, workspace, claude, command="archive", spec="77-recovered")
    result_file = workspace["project"].parent / "result.json"

    assert rc == 0, out
    assert json.loads(result_file.read_text()) == out


@pytest.mark.parametrize("step", ["analyze", "implement"])
def test_every_other_step_still_refuses_an_archived_spec_with_an_open_branch(
    runner, workspace, fake_claude, local_origins, step
):
    """Criterion 3. The fork is on the literal string `archive`: an
    archived spec is finished work for every other step, whatever its
    branch looks like."""
    add_spec(workspace, "77-recovered", archived=True)
    leave_branch_on_origin(workspace, "aide/77-recovered")
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")

    rc, out, _ = run(runner, workspace, claude, command=step, spec="77-recovered")

    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "unknown spec" in out["error"], out
    assert not fake_claude.calls.exists(), "the refusal must precede the money"


def test_create_does_not_resolve_an_archived_spec_with_an_open_branch(
    runner, workspace, fake_claude, local_origins
):
    """Criterion 3, for the one step that has no "unknown spec" refusal
    to give: `create` MAKES the folder, so a name it cannot resolve is
    its normal case. What it must not do is resolve the archived folder
    and archive-step its way past its own required arguments — so the
    proof is the missing-title refusal, which only happens when the
    folder stayed unresolved."""
    add_spec(workspace, "77-recovered", archived=True)
    leave_branch_on_origin(workspace, "aide/77-recovered")
    claude = fake_claude("exit 1")

    rc, out, _ = run(
        runner, workspace, claude, command="create", spec="77-recovered",
        description="Do the thing that was asked for",
    )

    assert rc == 2, out
    assert "title" in out["error"], out
    assert not fake_claude.calls.exists()


# --- spec 349: the workflow's step lists have one source, not a hand- ------
# paired copy on each side. `core/scripts/lib/workflow-steps.json` is now
# the one place `workflowSteps`, `dependencyGatedSteps`, `workflowArc` and
# `workflowArcRetired` are written; aide-run-spec reads it with jq and the
# dashboard imports it. These tests replace the three `test_the_*_copies_
# of_*_agree` pins that used to catch the two sides drifting apart.


def test_workflow_steps_json_holds_the_known_lists(workspace_root):
    """REQ-1: one data file holds the workflow steps, the dependency-gated
    steps and the workflow arc — each matching today's known-good
    values."""
    path = workspace_root / "core" / "scripts" / "lib" / "workflow-steps.json"
    assert path.is_file(), f"the shared workflow-step file is missing: {path}"
    data = json.loads(path.read_text())
    assert data["workflowSteps"] == [
        "explore", "create", "analyze", "implement", "archive", "manifest", "reopen", "reset", "schedule",
    ]
    assert data["dependencyGatedSteps"] == ["implement", "archive"]
    assert data["workflowArc"] == ["create", "analyze", "implement", "archive"]
    assert data["workflowArcRetired"] == ["review-plan"]


def test_bash_no_longer_declares_the_step_lists_as_literals(workspace_root):
    """REQ-2: the runner reads all four lists from workflow-steps.json now.
    WORKFLOW_STEPS keeps its old NAME (assigned from `$(jq ...)`, still a
    `NAME="..."` shape once computed), so this checks for the absence of
    the OLD LITERAL VALUE rather than the variable's name."""
    bash = (workspace_root / "core" / "scripts" / "aide-run-spec").read_text()
    for literal in (
        'WORKFLOW_STEPS="explore create analyze implement archive manifest reopen reset schedule"',
        'DEPENDENCY_GATED_STEPS="implement archive"',
        'WORKFLOW_ARC="create analyze implement archive"',
        'WORKFLOW_ARC_RETIRED="review-plan"',
    ):
        assert literal not in bash, f"aide-run-spec still declares {literal!r} as a literal"


def test_dashboard_no_longer_declares_the_step_lists_as_literals(workspace_root):
    """REQ-2: none of the three plain-import TypeScript files may keep a
    hand-written array literal once they import workflow-steps.json
    instead. `dashboard/src/queue/steps.ts` is excluded here — its
    `WorkflowStep` type is checked separately (REQ-4b), since a JSON
    import cannot give TypeScript a literal union."""
    config_ts = (workspace_root / "dashboard" / "src" / "serve" / "serve-helpers" / "config.ts").read_text()
    assert not re.search(r"export const DEPENDENCY_GATED_STEPS = \[.*?\] as const;", config_ts, re.S), (
        "config.ts still declares DEPENDENCY_GATED_STEPS as a literal array"
    )

    history_ts = (workspace_root / "dashboard" / "src" / "git" / "workflow-history.ts").read_text()
    assert not re.search(r"export const HISTORY_STEPS = \[.*?\];", history_ts, re.S), (
        "workflow-history.ts still declares HISTORY_STEPS as a literal array"
    )
    assert not re.search(r"export const HISTORY_STEPS_RETIRED = \[.*?\];", history_ts, re.S), (
        "workflow-history.ts still declares HISTORY_STEPS_RETIRED as a literal array"
    )

    parse_status_ts = (workspace_root / "dashboard" / "src" / "project" / "parse-status.ts").read_text()
    assert not re.search(r"const WORKFLOW_STEPS = \[.*?\];", parse_status_ts, re.S), (
        "parse-status.ts still declares WORKFLOW_STEPS as a literal array"
    )


def test_runner_refuses_when_the_workflow_steps_file_is_missing(runner, workspace, fake_claude, tmp_path):
    """REQ-3: a runner that cannot find the shared file refuses loudly,
    naming the file, rather than running with the four lists silently
    unset under `set -u`."""
    lone_copy = tmp_path / "aide-run-spec-under-test"
    lone_copy.write_bytes(pathlib.Path(runner).read_bytes())
    lone_copy.chmod(0o755)
    # The shared spec-resolution library lives beside the script too, and
    # its absence would fail the run for an unrelated reason first — give
    # the stand-in one, exactly as the self-copy tests above do, so the
    # only thing missing beside it is `lib/workflow-steps.json`.
    (tmp_path / "_aide-spec-lib.sh").write_bytes(
        (pathlib.Path(runner).parent / "_aide-spec-lib.sh").read_bytes()
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, runner_path=lone_copy)
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "workflow-steps.json" in out["error"], out
    assert not fake_claude.calls.exists(), "the refusal must precede the money"


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


# --- Spec 259: schedule, a job with no spec at all ----------------------------
#
# A schedule entry names no aide skill and no spec folder — its whole
# "job" is the contents of a file in the project's own repo, sent as the
# prompt verbatim. The tracking key names only a branch and a worktree,
# the same SHAPE `create`'s provisional key already has, though the
# exemption is new code rather than a copy of `create`'s own branch (see
# the script's own comment on the `schedule` arm).

SCHEDULE_KEY = "schedule-nightly-report"


def schedule(runner, ws, claude, **kwargs):
    kwargs.setdefault("command", "schedule")
    kwargs.setdefault("spec", SCHEDULE_KEY)
    kwargs.setdefault("prompt_file", "docs/nightly-report.md")
    return run(runner, ws, claude, **kwargs)


def test_schedule_runs_with_no_spec_folder_and_sends_the_file_verbatim(
    runner, workspace, fake_claude
):
    """AC4: `--command schedule --prompt-file <path>` with no folder for
    the tracking key under the specs root must not refuse with `unknown
    spec: ...`, and the prompt is the named file's own contents, not an
    aide slash command."""
    (workspace["project"] / "docs").mkdir()
    (workspace["project"] / "docs" / "nightly-report.md").write_text(
        "Summarize last night's traffic.\n"
    )
    claude = fake_claude("cat > /dev/null\nexit 1")
    rc, out, _ = schedule(runner, workspace, claude, dry_run=True)
    assert rc == 0, out
    assert "unknown spec" not in out.get("error", ""), out
    prompt = out["prompt"]
    assert prompt.startswith("Summarize last night's traffic."), prompt
    assert "headless" in prompt.lower()
    assert "/aide-" not in prompt, prompt


def test_schedule_requires_a_prompt_file(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = schedule(runner, workspace, claude, prompt_file=None)
    assert rc == 2
    assert out["ok"] is False
    assert "prompt-file" in out["error"], out
    assert not fake_claude.calls.exists()


def test_schedule_refuses_a_missing_prompt_file(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = schedule(runner, workspace, claude, prompt_file="docs/does-not-exist.md")
    assert rc == 2
    assert out["ok"] is False
    assert "prompt-file" in out["error"], out
    assert not fake_claude.calls.exists()


def test_every_other_step_still_refuses_the_schedule_tracking_key(runner, workspace, fake_claude):
    """The exemption is additive: `analyze` on a schedule-shaped key that
    names no real spec folder is refused exactly as any other unknown
    spec would be."""
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, command="analyze", spec=SCHEDULE_KEY)
    assert rc == 2
    assert "unknown spec" in out["error"], out
    assert not fake_claude.calls.exists()


# --- Spec 171: archive meets the conflict ------------------------------------
# Every other step treats a conflict between its branch and the default
# branch as a human's problem and refuses. `archive` is the step that
# exists to BE that human (spec 171 folded the standalone `resolve` step
# into it): it is handed the conflicted worktree exactly as git left it,
# and the skill inside it decides. The fork is narrow on purpose — one
# command name, matched literally — because the routine it forks is the
# one every other step depends on.

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


def test_archive_is_handed_the_open_conflict_and_its_result_is_pushed(
    runner, workspace, fake_claude, origin
):
    """Criterion 1 (spec 171). Archive lands in a worktree that is
    mid-merge, with MERGE_HEAD set and the conflict markers still in the
    file — the resolution is archive's own first piece of work, and
    refusing before it starts is what every other step does instead."""
    project = workspace["project"]
    with_status(workspace, ["create", "analyze", "implement"])
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
        # And archive's own work, or the no-progress check (spec 268)
        # rightly says the folder was never moved.
        + READ_SPECS
        + 'mkdir -p "$specs/archive" && git -C "$specs" mv 81-queue-and-runner archive/81-queue-and-runner '
        + '&& git -C "$specs" commit -q -m "archive"\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive", push="branch")
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


def test_after_an_archive_resolution_the_default_branch_fast_forwards(
    runner, workspace, fake_claude, origin
):
    """Criterion 3 (spec 171). The point of pushing the branch is that
    the landing that follows finds a fast-forward — the same routine that
    refused before now succeeds, because the branch changed, not the
    routine."""
    project = workspace["project"]
    branch = conflicting_branch(workspace, published=True)
    claude = fake_claude(
        "cat > /dev/null\n"
        'printf "resolved by the step\\n" > contested.txt\n'
        "git add -A\n"
        "git commit -q --no-edit\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive", push="branch")
    assert rc == 0, out
    ff = subprocess.run(
        ["git", "-C", str(project), "merge", "-q", "--ff-only", branch],
        capture_output=True, text=True,
    )
    assert ff.returncode == 0, ff.stderr


def test_an_archive_that_gives_up_leaves_the_branch_exactly_where_it_was(
    runner, workspace, fake_claude, origin
):
    """Criterion 4 (spec 171). Tests red, or a conflict the skill will
    not decide: the merge is undone, HEAD never moves, and the HEAD-moved
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
    rc, out, _ = run(runner, workspace, claude, command="archive", push="branch")
    assert out["ok"] is False, out
    # It gave up, which is not the same as never having started: the
    # step must have been handed the conflict before it decided.
    assert out["terminalReason"] != "refused", out
    assert fake_claude.calls.exists(), "the step must have been invoked at all"
    assert git(project, "rev-parse", branch) == before, "the branch must be left exactly as it was found"
    assert git(origin["project"], "branch", "--list", branch) == "", \
        "nothing may reach origin from a resolution that gave up"


def test_an_archive_that_walks_away_mid_merge_publishes_no_conflict_markers(
    runner, workspace, fake_claude, origin
):
    """Criterion 5 (spec 171). Archive can die between opening the
    conflict and deciding — a crash, a cancellation, a budget stop. The
    generic commit loop would otherwise `git add -A` the conflict markers
    and commit them as the merge, which is the half-merged tree the whole
    codebase refuses to leave anywhere."""
    project = workspace["project"]
    branch = conflicting_branch(workspace, published=True)
    before = git(project, "rev-parse", branch)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_ERROR)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive", push="branch")
    assert out["terminalReason"] != "refused", out
    assert fake_claude.calls.exists(), "the step must have been invoked at all"
    assert git(project, "rev-parse", branch) == before, "an undecided merge must not be committed"
    assert "<<<<<<<" not in git(project, "show", f"{branch}:contested.txt")
    assert git(origin["project"], "branch", "--list", branch) == ""


@pytest.mark.parametrize("step", ["create", "analyze", "implement"])
def test_every_other_step_still_refuses_a_conflict(runner, workspace, fake_claude, step):
    """Criterion 2 (spec 171). The fork is on the literal string
    `archive` and nothing else, so every step that refused yesterday
    refuses today — a step let past a conflict would commit the markers.
    All three are named, not the two that happened to be here before."""
    project = workspace["project"]
    conflicting_branch(workspace)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command=step)
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "conflict" in out["error"]
    assert git(project, "status", "--porcelain") == ""


# --- spec 280: a conflict confined to the spec's OWN 4-status.md resolves ---
# mechanically ------------------------------------------------------------
#
# The routine above (spec 171) is for a genuine conflict — two intents
# colliding. A conflict where the ONLY divergence is this spec's own
# `4-status.md` — main's copy corrected directly (the dashboard's
# tick-to-fix, or a person editing main by hand) while the branch's own
# copy is simply stale — is not that: there is one canonical state
# (main's) and one stale snapshot (the branch's), so main's copy wins
# without ever reaching the AI-judgment routine. `workspace`'s own specs
# fixture is FLAT (folders directly at the specs repo's root); this
# project's real layout is NESTED (folders one level below, under a
# project-name subdirectory), which a naive path comparison misses — so
# these tests build that shape directly rather than reusing `workspace`.


def nested_workspace(tmp_path, project_name="aide"):
    """A project repo plus a SEPARATE specs repo whose spec folders live
    one level below its own root, under a project-name subdirectory —
    this project's own real `AIDE_SPECS_PATH` shape, unlike `workspace`
    above (flat: folders directly at the specs repo's root)."""
    project = init_repo(tmp_path / "proj")
    specs_repo = init_repo(tmp_path / "specs")
    specs_root = specs_repo / project_name
    specs_root.mkdir()
    (specs_root / "81-queue-and-runner").mkdir()
    (specs_root / "81-queue-and-runner" / "1-description.md").write_text("# Queue - Description\n")
    subprocess.run(["git", "-C", str(specs_repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(specs_repo), "commit", "-qm", "add spec"], check=True)
    (project / ".gitignore").write_text("/deps/\n")
    (project / "deps").mkdir()
    (project / "deps" / "marker.txt").write_text("the dependency tree\n")
    (project / ".aide").mkdir()
    (project / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={specs_root}\nAIDE_WORKTREE_LINKS=deps\n"
    )
    subprocess.run(["git", "-C", str(project), "add", "-f", ".aide/config", ".gitignore"], check=True)
    subprocess.run(["git", "-C", str(project), "commit", "-qm", "add config"], check=True)
    return {
        "project": project,
        "specs": specs_repo,
        "folder": "81-queue-and-runner",
        "wtbase": tmp_path / "worktrees",
    }


def status_only_conflict(ws, project_name="aide", second_file=None):
    """Diverges the spec's own `4-status.md` between its branch and the
    specs repo's main — the branch's stale copy vs. main's corrected one
    — pre-creating the branch in the SPECS repo only (the project repo
    gets a fresh branch off base, which meets no conflict at all).
    `second_file` additionally conflicts an unrelated path alongside it,
    for the negative case (AC2)."""
    specs = ws["specs"]
    branch = f"aide/{ws['folder']}"
    status_path = specs / project_name / ws["folder"] / "4-status.md"
    status_rel = f"{project_name}/{ws['folder']}/4-status.md"
    git(specs, "switch", "-q", "-c", branch)
    status_path.write_text("branch's stale copy\n")
    if second_file:
        (specs / project_name / ws["folder"] / second_file).write_text("branch's other change\n")
    git(specs, "add", "-A")
    git(specs, "commit", "-q", "-m", "branch side")
    git(specs, "switch", "-q", "main")
    status_path.write_text("main's corrected copy\n")
    if second_file:
        (specs / project_name / ws["folder"] / second_file).write_text("main's other change\n")
    git(specs, "add", "-A")
    git(specs, "commit", "-q", "-m", "main side")
    return branch, status_rel


def test_a_4status_only_conflict_in_a_nested_specs_repo_resolves_to_mains_copy(
    runner, tmp_path, fake_claude
):
    """AC1. A conflict confined to the spec's own `4-status.md`, in a
    NESTED specs-repo layout, resolves mechanically before the AI-
    judgment routine ever sees it — main's corrected copy wins, no
    markers remain."""
    ws = nested_workspace(tmp_path)
    branch, status_rel = status_only_conflict(ws)
    claude = fake_claude("exit 1")  # would fail loudly if the merge ever reached it
    rc, out, _ = run(runner, ws, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert not fake_claude.calls.exists(), \
        "a mechanically-resolvable conflict must never reach the AI session"
    text = git(ws["specs"], "show", f"{branch}:{status_rel}")
    assert text == "main's corrected copy", text
    assert "<<<<<<<" not in text


def test_a_4status_conflict_with_another_file_also_conflicting_stays_open(
    runner, tmp_path, fake_claude
):
    """AC2. Something OTHER than the spec's own `4-status.md` also
    conflicts — today's open-conflict behavior is unchanged, and the
    step is still handed the live conflict to resolve itself."""
    ws = nested_workspace(tmp_path)
    branch, status_rel = status_only_conflict(ws, second_file="notes.txt")
    merge_head_file = ws["project"].parent / "merge-head.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'git -C "$specs" rev-parse -q --verify MERGE_HEAD >> {merge_head_file} 2>/dev/null\n'
        'printf "resolved by the step\\n" > "$specs/'
        f'{ws["folder"]}/4-status.md"\n'
        'git -C "$specs" add -A\n'
        'git -C "$specs" commit -q --no-edit\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude, command="archive")
    assert rc == 0, out
    assert merge_head_file.exists() and merge_head_file.read_text().strip(), \
        "a conflict touching more than just 4-status.md must still be left open for the step"


def test_archive_behaves_like_any_other_step_when_there_is_nothing_to_resolve(
    runner, workspace, fake_claude
):
    """The fork must only bite on a real conflict. An `archive` run on a
    branch that merges cleanly is an ordinary step."""
    with_status(workspace, done=True)
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    git(project, "switch", "-q", "main")
    (project / "moved-on.txt").write_text("landed on main after the branch was made\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "later work on main")
    # In the project, because that is the branch the merge is asked
    # about: since spec 215 a branch this run never advanced past its
    # base is deleted at the end of it.
    claude = project_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert is_ancestor(project, "main", branch)


# --- spec 251: the mechanical pre-check skips the model entirely --------
# core/scripts/aide-archive-spec answers "is this spec's work done, and is
# anything conflicted" without a model. When the answer is "not done yet"
# aide-run-spec never spawns claude/codex at all — the same "a script
# decides success and reports it, no session ever runs" shape
# already_landed() already has (test_archive_reports_an_already_landed_
# spec_as_done_not_refused, above), extended to two new outcomes.


def test_archive_skips_the_model_when_the_spec_has_not_reached_implement(
    runner, workspace, fake_claude
):
    """Criterion 1. The fixture's default status file names `analyze` but
    not `implement` — "nothing started yet" from archive's own point of
    view — ordinary progression, never a warning, and costs nothing."""
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["exitCode"] == 0, out
    assert out["terminalReason"] == "not-implemented-yet", out
    assert not fake_claude.calls.exists(), "nothing to decide costs nothing"
    assert "costUsd" not in out or out.get("costUsd") == 0, out


def test_archive_skips_the_model_when_acceptance_criteria_are_unticked(
    runner, workspace, fake_claude
):
    """REQ-1: an unticked `## Acceptance criteria` row is a refusal a
    script already answers — costs nothing and never reaches claude."""
    with_status(workspace, done=True)
    status_path = workspace["specs"] / workspace["folder"] / "4-status.md"
    status_path.write_text(
        status_path.read_text()
        + "\n## Acceptance criteria\n\n"
        + "| Task | Status | Notes |\n|------|--------|-------|\n"
        + "| REQ-1: does the thing | ⬜ | |\n"
    )
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "add acceptance criteria")
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["terminalReason"] == "acceptance-criteria-unticked", out
    assert not fake_claude.calls.exists(), "an unticked row costs nothing"


def test_archive_proceeds_past_an_in_progress_ordinary_row(
    runner, workspace, fake_claude
):
    """Spec 268 stopped gating archive on ordinary Phase/Checklist rows —
    only the `Workflow steps completed` line (has implement run at all)
    and, when present, the `## Acceptance criteria` section are read. A
    `🔄` row elsewhere is the implementer's own bookkeeping and no
    longer holds anything back: archive proceeds and spawns the model
    exactly as it would for a fully-ticked file."""
    body = (
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Workflow steps completed:** create, analyze, implement\n\n"
        "---\n\n## Phase 2: GREEN\n\n### Tasks\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| the Slack webhook | 🔄 | still wiring it up |\n"
    )
    (workspace["specs"] / workspace["folder"] / "4-status.md").write_text(body)
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "add status"], check=True)

    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert fake_claude.calls.exists(), "an ordinary in-progress row must not skip the model"


def test_the_declined_result_carries_the_full_shape_a_completed_run_has(
    runner, workspace, fake_claude
):
    """Both skip-the-model outcomes must be indistinguishable, shape-
    wise, from any other step's successful JSON — a caller that only
    ever branches on `ok`/`ok`+`terminalReason` must not be surprised by
    a missing field."""
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, result_stdout = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    for field in ("ok", "exitCode", "terminalReason", "durationSec", "branch", "repos"):
        assert field in out, out
    assert out["durationSec"] == 0, out


def test_other_commands_still_spawn_the_model_with_no_status_file_at_all(
    runner, workspace, fake_claude
):
    """The new fast path is gated on the literal string `archive`, like
    every other archive-only fork in this script — a spec with no
    4-status.md is `analyze`'s normal starting point, not a reason to
    skip it (spec 344 gives `implement` a status-file precondition of its
    own; `analyze` keeps none)."""
    status_path = workspace["specs"] / workspace["folder"] / "4-status.md"
    status_path.unlink()
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "remove status"], check=True)
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert fake_claude.calls.exists()


def test_resolve_is_no_longer_a_command_this_script_will_run(runner, workspace, fake_claude):
    """Criterion 8 (spec 171). The step is gone, not hidden: a caller
    that still asks for it — an old dashboard, a shell history entry, a
    queue-config left over from before — is refused by the same
    --command check every other unknown word meets, before any money is
    spent."""
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="resolve")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "invalid --command" in out["error"], out
    assert not fake_claude.calls.exists(), "the refusal must precede the money"


def test_review_plan_is_refused_as_a_command(runner, workspace, fake_claude):
    """Criterion 1 (spec 181). `review-plan` folded into `analyze` and is
    no longer a step of its own: a caller that still asks for it — an
    old dashboard, a shell history entry, a queue-config left over from
    before — is refused by the same --command check every other unknown
    word meets, before any money is spent."""
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="review-plan")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "invalid --command" in out["error"], out
    assert not fake_claude.calls.exists(), "the refusal must precede the money"


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


# --- spec 154: the runner owns the record of what has run ---------------------
#
# The dashboard reads a spec's own commits to decide which steps it has
# had. Everything that is not the dashboard reads `4-status.md`, so the
# runner writes that file's one line from the same commits — and the two
# agree by construction rather than because a model remembered to.
#
# The five histories below are the same five `dashboard/test/workflow-history.test.ts`
# drives through the TypeScript derivation. That is the whole point of
# having them here: two implementations of one rule, in two languages,
# tested against the same scenarios, the way `WORKFLOW_STEPS` and
# `DEPENDENCY_GATED_STEPS` are pinned to each other.


def subject(step, folder="81-queue-and-runner", headless=True, stopped=None, model=None):
    """The commit-subject grammar, spelled out rather than derived from
    the script — a fixture that built it the same way the reader parses
    it would prove only that the two agreed with each other.

    `model=` is spec 217's suffix, and it sits BEFORE the stop reason:
    `(stopped: <reason>)` ends the subject and its reason is read
    greedily, so a suffix after it would be swallowed into the reason.
    """
    return (
        f"Run /aide-{step} for {folder}"
        + (" (headless)" if headless else "")
        + (f" (model: {model})" if model else "")
        + (f" (stopped: {stopped})" if stopped else "")
    )


def with_status(workspace, claims=None, reopened=None, models=None, done=False):
    """Give the spec a 4-status.md, committed, optionally CLAIMING steps
    on the line this change takes over.

    `reopened=<sha>` adds spec 198's boundary mark, which says history
    before that commit does not count.

    `models={step: value}` adds spec 217's per-step Model lines, in the
    place the runner writes them: directly under the steps line.

    `done=True` (spec 251) gives the file one already-✅ Phase section AND
    (unless `claims` already says otherwise) a `Workflow steps completed`
    line naming `implement` — the mechanical pre-check
    (core/scripts/aide-archive-spec) has read ONLY that line, never the
    Phase tables, since spec 268; a `done=True` file that named no steps
    would still be declined as `not-implemented-yet` before the Phase
    content it sets up ever mattered. Every test in this file that runs
    `command="archive"` against a bare `with_status()` file (no Phase
    section at all) needs this, since a status file with nothing to read
    as "started" is exactly the shape the mechanical check now declines
    on its own.
    """
    if done and claims is None:
        claims = ["create", "analyze", "implement"]
    line = f"- **Workflow steps completed:** {', '.join(claims)}\n" if claims else ""
    for step, value in (models or {}).items():
        line += f"- **Model ({step}):** {value}\n"
    mark = reopen_line(reopened) if reopened else ""
    phase_block = (
        "\n---\n\n## Phase 1: RED\n\n**Status:** ✅ Completed\n\n### Tasks\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| already done | ✅ | |\n"
        if done else ""
    )
    (workspace["specs"] / workspace["folder"] / "4-status.md").write_text(
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        f"{line}{mark}"
        "- **Total progress:** 0% (0 of 4 completed)\n"
        f"{phase_block}"
    )
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "add status"], check=True)


def already_ran(workspace, steps, write_line=False, **kw):
    """Runner commits for steps that have already happened, on the specs
    repo's default branch — where a landed step's commit lives.

    `write_line=True` also rewrites `4-status.md`'s own `Workflow steps
    completed:` line to name every step so far, the same way a real
    run's own post-processing does — needed only by callers whose
    scenario has `aide-archive-spec` (spec 268) read that line, since it
    never reads git history. Off by default: most callers here rely on
    the plain, content-free commits this always made, and several
    scenarios (a stopped step, `review-plan`, spec-286-era rows) are
    about exactly what the LINE does or does not say — writing it here
    too would preempt the thing some of those tests exist to check.
    """
    status_path = workspace["specs"] / workspace["folder"] / "4-status.md"
    done_so_far = []
    for step in steps:
        done_so_far.append(step)
        if write_line and status_path.exists():
            text = status_path.read_text()
            line = f"- **Workflow steps completed:** {', '.join(done_so_far)}"
            if re.search(r"^- \*\*Workflow steps completed:\*\*.*$", text, re.M):
                text = re.sub(r"^- \*\*Workflow steps completed:\*\*.*$", line, text, count=1, flags=re.M)
            else:
                text = text.replace(
                    f"- **Task:** `{workspace['folder']}/`\n",
                    f"- **Task:** `{workspace['folder']}/`\n{line}\n",
                    1,
                )
            status_path.write_text(text)
            subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
        subprocess.run(
            ["git", "-C", str(workspace["specs"]), "commit", "-q", "--allow-empty",
             "-m", subject(step, workspace["folder"], **kw)],
            check=True,
        )


def recorded_line(workspace, branch="aide/81-queue-and-runner", path=None):
    """The Tracking info line as the branch's own commit has it — read
    out of git, not off the disk, because what this change promises is
    that the edit is IN the step's commit."""
    path = path or f"{workspace['folder']}/4-status.md"
    text = git(workspace["specs"], "show", f"{branch}:{path}")
    for line in text.split("\n"):
        if line.startswith("- **Workflow steps completed:**"):
            return line.split(":**", 1)[1].strip()
    return None


def recorded_model(workspace, step, branch="aide/81-queue-and-runner", path=None):
    """Spec 217's per-step Model line, read out of the branch's own
    commit for the same reason `recorded_line` is: the promise is that
    the edit rides IN the step's commit, not that it reached the disk."""
    path = path or f"{workspace['folder']}/4-status.md"
    text = git(workspace["specs"], "show", f"{branch}:{path}")
    prefix = f"- **Model ({step}):**"
    for line in text.split("\n"):
        if line.startswith(prefix):
            return line[len(prefix):].strip()
    return None


def test_a_copied_status_line_is_no_longer_corrected_by_the_step_that_runs(
    runner, workspace, fake_claude
):
    """Spec 153: four files copied from a sibling whose analyze had
    landed, so a folder minutes old claimed three steps. Nothing was
    committed for any of them, and the first real step used to write the
    claim back down to what history could prove.

    Spec 214 reverses that, deliberately: the two cases are the same
    case seen from opposite sides — a line naming a step no commit can
    corroborate is either a copied lie (153) or the only surviving
    record of a step that committed under its own subject (214). The
    scan cannot tell them apart, and 214's description settles which
    way to be wrong: "A step already named in the line is never removed,
    whatever the computation finds", with `aide-reopen` named as the one
    place a step comes off the line. A copied line therefore stands
    until someone edits the file or reopens the spec — the price of
    never erasing a step that really ran.
    """
    with_status(workspace, ["create", "analyze", "implement"])
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"


def test_the_line_names_every_step_the_history_has(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    # Workflow order, not log order, and this run's own step included.
    assert recorded_line(workspace) == "create, analyze, implement"


def test_a_step_that_touches_only_the_project_still_gets_a_specs_commit(
    runner, workspace, fake_claude
):
    """Spec 206: `implement` changes code and nothing under the specs
    root, so the commit loop there has nothing of the step's own to
    commit. The line rewrite is what gives it something — without it
    the step leaves no trace in either the file or the history, which
    is how a finished implement came to be missing from the line.

    The stopped-step half of this is
    `test_a_step_that_was_stopped_is_not_written_as_completed`; this is
    the same proof for a step that COMPLETES.
    """
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"])
    claude = project_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"
    branch_log = git(
        workspace["specs"], "log", "--format=%s", "aide/81-queue-and-runner"
    ).split("\n")
    assert subject("implement", model="claude") in branch_log, branch_log


def test_a_step_that_was_stopped_is_not_written_as_completed(runner, workspace, fake_claude):
    """Spec 147, from the other side: the step ran and did not finish.
    The commit says so — the line, which is about what COMPLETED, does
    not gain it."""
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"])
    import subprocess as sp

    claude = fake_claude(
        "cat > /dev/null\n"
        # Half-written in both roots: the specs change is what the
        # runner commits under "(stopped: timeout)" — since spec 344's
        # fixture already carries the steps line, nothing else in the
        # specs repo would change on a stopped implement.
        + READ_SPECS
        + f'echo "half-written" > "$specs/{workspace["folder"]}/3-solution.md"\n'
        + 'echo "half-written" > "$PWD/half.txt"\n'
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement",
                     timeout_sec="8", kill_grace_sec="2")
    assert out["terminalReason"] == "timeout"
    assert recorded_line(workspace) == "create, analyze"
    # And the stop is on the record that DOES carry it.
    assert "stopped: timeout" in git(
        workspace["specs"], "log", "-1", "--pretty=%s", "aide/81-queue-and-runner"
    )


def test_a_completed_run_supersedes_the_stop_before_it(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"])
    already_ran(workspace, ["implement"], stopped="timeout")
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"


def test_an_interactive_commit_without_the_headless_marker_counts(
    runner, workspace, fake_claude
):
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"], headless=False)
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"


def test_a_historical_review_plan_commit_still_counts_as_completed(
    runner, workspace, fake_claude
):
    """Criterion 2, bash side, and description requirement 2 ("every
    archived spec whose history contains a review-plan run still
    displays that history"). `review-plan` folded into `analyze` (spec
    181) and is no longer a step a NEW run may claim (WORKFLOW_STEPS
    refuses it) or write as its own arc stage (WORKFLOW_ARC no longer
    names it) — but an commit made before this change is still on disk,
    and it must still be recognized: `WORKFLOW_ARC_RETIRED` is what
    keeps `completed_steps_for` counting it.

    Plan review labelled this a characterization test on the theory
    that Phase 2 "never touches the commit-subject regex" — that framing
    missed that WORKFLOW_ARC is also a FILTER on old commits, not just
    a list of what a new run may write, and dropping review-plan from it
    with nothing else changed made this go genuinely red (confirmed
    empirically before WORKFLOW_ARC_RETIRED was added). It is a real RED
    test, not a characterization one."""
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze", "review-plan"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    # Current arc order first, then retired steps: WORKFLOW_ARC_RETIRED
    # is not woven back into its old position, only kept from vanishing.
    assert recorded_line(workspace) == "create, analyze, implement, review-plan"


def test_a_commit_for_another_spec_is_not_this_spec_history(runner, workspace, fake_claude):
    with_status(workspace)
    for step in ["create", "analyze", "implement"]:
        subprocess.run(
            ["git", "-C", str(workspace["specs"]), "commit", "-q", "--allow-empty",
             "-m", subject(step, "99-somebody-else")],
            check=True,
        )
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert recorded_line(workspace) == "analyze"


def test_the_line_is_written_into_the_steps_own_commit(runner, workspace, fake_claude):
    """Not an amend: the line lands in a SECOND commit of its own (spec
    343), made only once the step's own content is confirmed on origin —
    never folded into the step's own commit, and never rewriting it."""
    with_status(workspace)
    before = git(workspace["specs"], "rev-parse", "main")
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    commits = git(workspace["specs"], "log", "--format=%s", f"{before}..{branch}").split("\n")
    # The model suffix (spec 217) is part of the subject a headless run
    # writes: the tool is always known, so it is always there. Two
    # commits sharing the same subject: pass 1 (the step's own content)
    # and pass 2 (the line, once pass 1 is confirmed on origin).
    assert commits == [subject("analyze", model="claude")] * 2, commits
    assert recorded_line(workspace) == "analyze"


def test_an_archive_run_finds_the_status_file_it_just_moved(runner, workspace, fake_claude):
    """The mechanical pre-check (spec 251, core/scripts/aide-archive-spec)
    does the `git mv` of the whole folder into `archive/` before the
    runner's commit loop, or the model, ever runs — so the path the line
    has to be written at is not the one the run started with."""
    with_status(workspace, done=True)
    already_ran(workspace, ["create", "analyze", "implement"], write_line=True)
    folder = workspace["folder"]
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert (
        recorded_line(workspace, path=f"archive/{folder}/4-status.md")
        == "create, analyze, implement, archive"
    )


def test_a_spec_with_no_status_file_is_not_a_failure(runner, workspace, fake_claude):
    """Deletes the fixture's default status file to get back to the
    no-status-file scenario every other test in this file used to run
    with, before spec 344 gave the fixture a default. Nothing to write
    is nothing to do."""
    status_path = workspace["specs"] / workspace["folder"] / "4-status.md"
    status_path.unlink()
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "remove status"], check=True)
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert not out.get("error"), out["error"]


def test_a_create_run_writes_the_line_into_the_folder_it_just_made(
    runner, workspace, fake_claude
):
    """`create` is the one step whose spec folder is not the one the run
    was started with — the commit names what it made, and so does the
    file it writes into."""
    made = "99-a-brand-new-spec"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'mkdir -p "$specs/{made}"\n'
        + f'printf "%s\\n" "# New - Status" "" "## Tracking info" "" "- **Task:** \\`{made}/\\`" '
        + f'> "$specs/{made}/4-status.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="create", spec="81")
    assert rc == 0, out
    assert out["specFolder"] == made
    assert recorded_line(workspace, path=f"{made}/4-status.md") == "create"


def test_a_step_outside_the_workflow_arc_leaves_the_line_alone(
    runner, workspace, fake_claude
):
    """`explore` is not a stage a spec passes through, and it writes
    nothing today. It must not start leaving a commit — and with it a
    branch no step lands — for a line it has no news about."""
    with_status(workspace, ["create", "analyze", "implement"])
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="explore")
    assert rc == 0, out
    assert git(workspace["specs"], "log", "-1", "--pretty=%s", "main") == "add status"
    roots = {r["root"]: r for r in out["repos"]}
    assert roots[str(workspace["specs"])]["changedFiles"] == 0


def test_a_line_that_is_already_right_is_not_rewritten(runner, workspace, fake_claude):
    """The commit loop commits whatever it finds changed. A file
    rewritten to exactly what it already said would put a step's name on
    a commit carrying nothing."""
    # Spec 217: the Model line is part of "already right" now — a file
    # missing it has news to gain, and gaining it is a real change.
    with_status(workspace, ["create", "analyze"], models={"analyze": "claude"})
    already_ran(workspace, ["create", "analyze"])
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    roots = {r["root"]: r for r in out["repos"]}
    # spec 355: this fixture has never had a 4-status.json before, so
    # this run's own state-file derivation writes one for the first
    # time — the ONE genuinely new file. The prose itself carries no
    # news, exactly as this test's own name says.
    assert roots[str(workspace["specs"])]["changedFiles"] == 1


def test_the_state_file_names_the_step_the_run_just_added(runner, workspace, fake_claude):
    """A completed step lands in the prose line AND in 4-status.json. The
    state file keeps its own list of completed phases rather than
    re-deriving it from prose, so the runner has to hand it the list it
    just wrote — otherwise a file that already existed before the run
    (from create, from a backfill) goes on saying what it said, and the
    next implement is held back as not analyzed (2026-09-02, spec 361)."""
    with_status(workspace, ["create"])
    already_ran(workspace, ["create"])
    state = workspace["specs"] / workspace["folder"] / "4-status.json"
    state.write_text(json.dumps({"completedPhases": ["create"], "archived": None,
                                 "reopened": None, "acceptanceCriteria": [], "phaseCounts": {}}))
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "state file"], check=True)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    prose = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert bullet(prose, "Workflow steps completed") == "create, analyze"
    written = json.loads(phase_file_text(workspace, f"{workspace['folder']}/4-status.json"))
    assert written["completedPhases"] == ["create", "analyze"]


# --- spec 217: which model ran each step (superseded by spec 245) ------------
#
# "Did it run" and "who ran it" are two different facts, and conflating
# them on one line is what caused the Woodstack 22 incident for the
# first of them. Spec 217 gave the second its own line, centralized in
# 4-status.md and derived by scanning EVERY step's commit history on
# EVERY run. Spec 245 replaces that scan with a per-phase record written
# only into the phase's OWN file, by the run that phase ran — the tests
# below pin what is left of the old mechanism: nothing writes its shape
# anymore, and what already exists in an old archive is untouched.


def test_a_run_no_longer_writes_the_old_per_step_model_line(runner, workspace, fake_claude):
    """The centralized, scanned `Model (<step>):` line is gone: a fresh
    run writes this phase's own record into its own file (spec 245's
    tests above), never a `Model (<step>):` line into 4-status.md."""
    with_status(workspace)
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    assert recorded_model(workspace, "analyze") is None


def test_a_historical_model_line_survives_untouched(runner, workspace, fake_claude):
    """Risk analysis (3-solution.md, spec 245): specs archived before
    this change still carry the old, centralized `Model (<step>):` lines
    — left exactly as they are, not migrated, when a later step's own
    write touches the rest of the file."""
    with_status(workspace, ["create"], models={"create": "claude claude-opus-5"})
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert recorded_model(workspace, "create") == "claude claude-opus-5"


def test_the_two_copies_of_the_commit_subject_grammar_agree(workspace_root):
    """Risk 1, and AC7's structural half. The grammar exists once in
    bash (`completed_steps_for`) and once in TypeScript
    (`subjectPattern`), with no shared source, and BOTH anchor on `$`.
    Adding a trailing group to one and not the other would stop every
    future subject matching in the language that was missed — breaking
    the pre-existing "Workflow steps completed" derivation, not just the
    model line. The fifth hand-paired pair in this repo, pinned the way
    the other four already are.
    """
    import re

    bash = (workspace_root / "core" / "scripts" / "aide-run-spec").read_text()
    m = re.search(r'^\s*re="(\^Run /aide-[^"]*)"', bash, re.M)
    assert m, "aide-run-spec no longer builds the subject regex as a plain string"
    from_bash = m.group(1).replace("${folder}", "FOLDER")

    ts = (workspace_root / "dashboard" / "src" / "git" / "workflow-history.ts").read_text()
    m = re.search(r"const subjectPattern[^;]*?new RegExp\(\s*(.*?),?\s*\);", ts, re.S)
    assert m, "workflow-history.ts no longer builds the subject regex from template literals"
    from_ts = "".join(re.findall(r"`([^`]*)`", m.group(1)))
    from_ts = (
        from_ts.replace("${escapeRegExp(specFolder)}", "FOLDER")
        # A JS string literal doubles every backslash the regex needs;
        # bash's `[[ =~ ]]` operand does not. And the only structural
        # difference the two are allowed is capture-vs-not.
        .replace("\\\\", "\\")
        .replace("(?:", "(")
    )

    assert from_bash == from_ts, (
        "the script and the dashboard disagree about the commit-subject grammar:\n"
        f"  bash: {from_bash}\n"
        f"  ts:   {from_ts}"
    )


# --- spec 214: a step that has run cannot un-run ------------------------------
#
# The commit scan sees a step only through the `Run /aide-<step> for
# <folder>` subject grammar. A step that committed its own work under a
# descriptive subject is invisible to it — and the recompute that runs
# at the NEXT step then wrote the scan's answer over the line, erasing
# the only record that the step had run. Woodstack 22: the line read
# `analyze, implement`, `archive` recomputed it, and it came back
# `analyze, archive` with the row offering "ready for implement" for a
# spec whose code was already on `main`.
#
# So the line is added to and never subtracted from: whatever the scan
# finds joins whatever the line already says.


def test_a_step_only_the_line_knows_about_survives_a_later_recompute(
    runner, workspace, fake_claude
):
    """Acceptance criterion 1, and the Woodstack 22 shape exactly: a
    MULTI-step line, one of whose steps has no commit matching the
    subject grammar anywhere in history, recomputed by a later step."""
    with_status(workspace, ["analyze", "implement"], done=True)
    already_ran(workspace, ["analyze"])  # implement committed under its own subject
    subprocess.run(
        ["git", "-C", str(workspace["specs"]), "commit", "-q", "--allow-empty",
         "-m", f"Record the implementation of {workspace['folder']}"],
        check=True,
    )
    folder = workspace["folder"]
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    # Workflow order, not the order the two sources found them in.
    assert recorded_line(workspace, path=f"archive/{folder}/4-status.md") == "analyze, implement, archive"


def test_a_step_both_sources_find_is_named_once(runner, workspace, fake_claude):
    """Acceptance criterion 2. The line and the commit scan overlap for
    every step that ran headlessly — the union must not double them."""
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"


def test_a_line_naming_something_that_is_not_a_step_drops_it(
    runner, workspace, fake_claude
):
    """The union filters through `WORKFLOW_ARC`/`WORKFLOW_ARC_RETIRED`
    exactly as the commit scan does, so a placeholder or a typo left on
    the line by hand does not become permanent."""
    with_status(workspace, ["analyze", "not-a-step"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "analyze, implement"


# --- spec 245: every phase writes its own Tracking info -----------------------
#
# `Workflow steps completed`/`Model (<step>)` (above) answer "did it run"
# and "who ran it" for the SPEC as a whole, centralized in 4-status.md.
# This is the fourth fact, and it belongs to the PHASE, not the spec: a
# `Repo`/`Model`/`Result`/`Time spent`/`Cost` block, written into that
# phase's own artifact file, plus a time of day on the date field the
# file already carries.

TIME_OF_DAY_RE = re.compile(r"^`\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC`$")
TIME_SPENT_RE = re.compile(r"^\d+m\d{2}s$")


def tracking_block(text, heading="## Tracking info"):
    """The bullet lines directly under `## Tracking info`, up to the next
    `## ` heading — the same region the phase-outcome writer is scoped
    to."""
    lines = text.split("\n")
    start = next(i for i, ln in enumerate(lines) if ln.strip() == heading)
    end = next(
        (i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")),
        len(lines),
    )
    return "\n".join(lines[start:end])


def bullet(text, field, heading="## Tracking info"):
    """The value of one `- **Field:**` bullet inside Tracking info, or
    None when it is not there at all."""
    prefix = f"- **{field}:**"
    for line in tracking_block(text, heading).split("\n"):
        if line.startswith(prefix):
            return line[len(prefix):].strip()
    return None


def with_solution(workspace, last_updated="2026-08-01"):
    """A committed `3-solution.md` carrying a Tracking info section with
    the `Last updated:` date field the phase-outcome writer enriches."""
    (workspace["specs"] / workspace["folder"] / "3-solution.md").write_text(
        "# Queue - Solution\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        f"- **Last updated:** `{last_updated}`\n\n---\n\n## Scope\n"
    )
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "add solution"], check=True)


def with_analysis(workspace, last_analyzed="2026-08-01"):
    """The sibling of `with_solution` above, for `2-analysis.md` — a
    file for `phase_file_for` to find without needing a fake CLI that
    writes one, which a Codex phase-outcome test has no other use for
    (its `emits()` body is a fixed stdout stream, not a script that can
    also touch a file)."""
    (workspace["specs"] / workspace["folder"] / "2-analysis.md").write_text(
        "# Queue - Analysis\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        f"- **Last analyzed:** `{last_analyzed}`\n\n---\n\n## Findings\n"
    )
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "add analysis"], check=True)


def analyzing_claude(fake_claude, workspace, last_analyzed="2026-08-01"):
    """A stand-in `/aide-analyze` that leaves `2-analysis.md` behind with
    a Tracking info section carrying the `Last analyzed:` date field —
    unlike `writing_claude`, which writes the file with no Tracking info
    at all."""
    folder = workspace["folder"]
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "%s\\n" "# Queue - Analysis" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{folder}/\\`" "- **Last analyzed:** \\`{last_analyzed}\\`" '
        + f'> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def phase_file_text(workspace, path, branch="aide/81-queue-and-runner"):
    return git(workspace["specs"], "show", f"{branch}:{path}")


def test_a_create_run_records_its_own_outcome_and_no_repo_line(
    runner, workspace, fake_claude
):
    """AC1: `create` gains a time of day on `Created:`, and `Model` (when
    a model was named), `Result: completed` and `Time spent` — but no
    `Repo` line, since nothing was yet analyzed against."""
    made = "99-a-brand-new-spec"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'mkdir -p "$specs/{made}"\n'
        + f'printf "%s\\n" "# New - Description" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{made}/\\`" "- **Created:** \\`2026-08-01\\`" '
        + f'> "$specs/{made}/1-description.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="create", spec="81",
                     model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{made}/1-description.md")
    created = bullet(text, "Created")
    assert created and TIME_OF_DAY_RE.match(created), created
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Result") == "completed"
    time_spent = bullet(text, "Time spent")
    assert time_spent and TIME_SPENT_RE.match(time_spent), time_spent
    assert bullet(text, "Repo") is None


def test_an_analyze_run_writes_one_repo_line_per_root(runner, workspace, fake_claude):
    """AC2: `Last analyzed:` gains a time of day, and the Tracking info
    gains one `Repo` line per repo root, each matching that root's own
    `head_before`."""
    with_status(workspace)
    claude = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    last_analyzed = bullet(text, "Last analyzed")
    assert last_analyzed and TIME_OF_DAY_RE.match(last_analyzed), last_analyzed
    repo_lines = [
        ln for ln in tracking_block(text).split("\n") if ln.startswith("- **Repo:**")
    ]
    assert len(repo_lines) == 2, repo_lines
    assert any(ln.startswith("- **Repo:** `proj/aide/81-queue-and-runner @ ") for ln in repo_lines), repo_lines
    assert any(ln.startswith("- **Repo:** `specs/aide/81-queue-and-runner @ ") for ln in repo_lines), repo_lines
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Result") == "completed"


def test_an_implement_run_stopped_by_timeout_records_the_stop(
    runner, workspace, fake_claude
):
    """AC3: a run stopped by its own time limit records that in
    `3-solution.md`'s `Result` line rather than `completed`."""
    with_status(workspace, ["analyze"])
    with_solution(workspace)
    claude = fake_claude(
        "cat > /dev/null\n"
        'echo "half-written" > "$PWD/half.txt"\n'
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement",
                     timeout_sec="8", kill_grace_sec="2")
    assert out["terminalReason"] == "timeout"
    text = phase_file_text(workspace, f"{workspace['folder']}/3-solution.md")
    result_line = bullet(text, "Result")
    assert result_line.startswith("stopped (timeout)"), result_line


def test_a_failed_cli_run_records_a_sanitized_error_summary(
    runner, workspace, fake_claude
):
    """AC4: a CLI failure's `Result` line carries `stopped (cli-error)`
    followed by a one-line, backtick-free summary, truncated to at most
    200 characters — never the raw multi-line error verbatim."""
    with_status(workspace, ["analyze"])
    with_solution(workspace)
    long_error = ("line one with a `backtick`\n" + "x" * 300)
    result = {**RESULT_OK, "is_error": True, "errors": [long_error]}
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(result)}'")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "cli-error"
    text = phase_file_text(workspace, f"{workspace['folder']}/3-solution.md")
    result_line = bullet(text, "Result")
    assert result_line.startswith("stopped (cli-error)"), result_line
    assert "`" not in result_line, result_line
    assert "\n" not in result_line, result_line
    assert len(result_line) <= 200 + len("stopped (cli-error) — "), result_line


def test_an_archive_run_keeps_the_steps_line_and_adds_its_own_block(
    runner, workspace, fake_claude
):
    """AC5: `4-status.md` keeps the unchanged `Workflow steps completed:`
    line AND gains the new outcome block for `archive` itself — with no
    `Model (create|analyze|implement):` lines written by this run."""
    with_status(workspace, done=True)
    already_ran(workspace, ["create", "analyze", "implement"], write_line=True)
    folder = workspace["folder"]
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive",
                     model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"archive/{folder}/4-status.md")
    assert recorded_line(workspace, path=f"archive/{folder}/4-status.md") == "create, analyze, implement, archive"
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Result") == "completed"
    assert bullet(text, "Time spent") is not None
    for step in ("create", "analyze", "implement"):
        assert f"Model ({step})" not in text, text


def test_a_re_run_of_the_same_step_replaces_the_block_not_duplicates_it(
    runner, workspace, fake_claude
):
    """AC6: running the same step twice leaves the phase file's block
    reflecting only the newest run — no duplicate lines, and the date
    field's time is overwritten rather than duplicated."""
    with_status(workspace)
    claude1 = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude1, model="claude-haiku-4-5")
    assert rc == 0, out
    # The second run leaves 2-analysis.md untouched — a re-run whose
    # file already carries the first run's block by the time THIS run's
    # own writer processes it, which is exactly the shape a real re-run
    # has (the file is not rewritten from scratch every time).
    claude2 = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude2, model="claude-opus-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert text.count("- **Model:**") == 1, text
    assert text.count("- **Result:**") == 1, text
    assert text.count("- **Time spent:**") == 1, text
    assert text.count("- **Last analyzed:**") == 1, text
    assert bullet(text, "Model") == "claude claude-opus-5"


def test_a_result_bullet_outside_tracking_info_survives_the_write(
    runner, workspace, fake_claude
):
    """AC7: a `Result:`-shaped bullet the model wrote elsewhere in the
    same file (e.g. in prose about a past attempt) is not Tracking info,
    and the phase-outcome writer must not touch it."""
    with_status(workspace)
    folder = workspace["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "%s\\n" "# Queue - Analysis" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{folder}/\\`" "- **Last analyzed:** \\`2026-08-01\\`" "" '
        + '"## Findings" "" "- **Result:** the earlier fix worked" '
        + f'> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    text = phase_file_text(workspace, f"{folder}/2-analysis.md")
    assert "- **Result:** the earlier fix worked" in text, text
    # And Tracking info still gained its OWN Result line, alongside it.
    assert bullet(text, "Result") == "completed"


# --- spec 260: the phase-outcome writer also records a phase's tokens --------
#
# `tokens_json` (spec 118/125) is already computed for both tools by the
# time the block above is written, but nothing put it in the file. A
# Codex phase never gets a `Cost:` line (`cost_known` stays `false`), so
# Tokens is its own field, written independently of Cost — never
# "alongside" it the way Model/Result/Time spent are for every phase.

def test_a_codex_run_writes_a_tokens_line_with_no_cost_line(runner, workspace, fake_codex):
    """AC3: a Codex phase's own file gains a `Tokens:` bullet off the
    same `tokens_json` the result JSON already carries, with no `Cost:`
    line at all."""
    with_status(workspace)
    with_analysis(workspace)
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    u = CODEX_USAGE
    total = u["input_tokens"] + u["output_tokens"] + u["reasoning_output_tokens"] + u["cached_input_tokens"]
    assert bullet(text, "Tokens") == str(total)
    assert bullet(text, "Cost") is None


def test_a_run_with_no_usage_block_writes_no_tokens_line(runner, workspace, fake_codex):
    """AC4: a CLI that reported no usage block at all (a failed turn,
    here) leaves no `Tokens:` line — absence, not a `0`, mirroring how
    `Cost:` already behaves for an unmeasured figure."""
    with_status(workspace)
    with_analysis(workspace)
    codex = fake_codex(emits(CODEX_STREAM_FAILED))
    run(runner, workspace, tool="codex", codex=codex)
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert bullet(text, "Tokens") is None, text


def test_a_re_run_of_the_same_step_replaces_the_tokens_line_too(runner, workspace, fake_claude):
    """AC5: the same replace-not-duplicate guarantee AC6 above already
    gives Model/Result/Time spent/Cost extends to Tokens — the awk
    allowlist has to name it too, or a re-run would leave the first
    run's stale Tokens line in place alongside nothing new (`.match()`
    on the dashboard's read side returns the FIRST match, so a stale
    line would win over the fresh figure silently)."""
    with_status(workspace)
    result = {**RESULT_OK, "usage": FLAT_USAGE}
    folder = workspace["folder"]
    claude1 = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "%s\\n" "# Queue - Analysis" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{folder}/\\`" "- **Last analyzed:** \\`2026-08-01\\`" '
        + f'> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(result)}'"
    )
    rc, out, _ = run(runner, workspace, claude1, model="claude-haiku-4-5")
    assert rc == 0, out
    claude2 = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(result)}'")
    rc, out, _ = run(runner, workspace, claude2, model="claude-opus-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{folder}/2-analysis.md")
    assert text.count("- **Tokens:**") == 1, text
    total = (
        FLAT_USAGE["input_tokens"] + FLAT_USAGE["output_tokens"]
        + FLAT_USAGE["cache_read_input_tokens"] + FLAT_USAGE["cache_creation_input_tokens"]
    )
    assert bullet(text, "Tokens") == str(total)


# --- spec 341: a phase's own file remembers how many times it ran -----------
#
# The queue's own job memory is bounded and drops the earliest attempts
# first (2-analysis.md, "Findings"); this stamp is the only place the
# true count survives past that. Unlike every other field in this block,
# it is not a fresh overwrite each run — it reads its own PRIOR value out
# of the file before that value is replaced, and increments it.

def with_analysis_attempts(workspace, attempts, last_analyzed="2026-08-01"):
    """The sibling of `with_analysis` above, seeded with a pre-existing
    `Attempts:` bullet — the REQ-1 case where the writer has to continue
    from a value it did not itself just write."""
    (workspace["specs"] / workspace["folder"] / "2-analysis.md").write_text(
        "# Queue - Analysis\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        f"- **Last analyzed:** `{last_analyzed}`\n"
        f"- **Attempts:** {attempts}\n\n---\n\n## Findings\n"
    )
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "add analysis"], check=True)


def test_a_fresh_phase_stamps_its_first_attempt(runner, workspace, fake_claude):
    """REQ-1: a phase with no prior `Attempts:` bullet at all gets `1` on
    its first run."""
    with_status(workspace)
    claude = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert bullet(text, "Attempts") == "1"


def test_a_re_run_increments_the_stamped_attempts_count(runner, workspace, fake_claude):
    """REQ-1, and the same replace-not-duplicate guarantee AC6 already
    gives Model/Result/Time spent: running the same step twice takes the
    bullet from 1 to 2, never duplicating the line."""
    with_status(workspace)
    claude1 = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude1, model="claude-haiku-4-5")
    assert rc == 0, out
    claude2 = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude2, model="claude-opus-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert text.count("- **Attempts:**") == 1, text
    assert bullet(text, "Attempts") == "2"


def test_a_run_continues_from_a_pre_existing_attempts_value(runner, workspace, fake_claude):
    """REQ-1: the write reads the file's CURRENT value rather than
    assuming the writer's own internal counter starts at 0 — a phase
    file seeded with `Attempts: 5` (e.g. from before this feature
    shipped) becomes `6` after one more run."""
    with_status(workspace)
    with_analysis_attempts(workspace, 5)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert bullet(text, "Attempts") == "6"


# --- spec 198: reopening a spec is one action --------------------------------
#
# An archived spec whose work has to be done again was reopened by hand:
# move the folder out of `archive/`, overwrite three files, delete the
# branch in two repositories and in two places each. Done twice on
# 2026-08-22/23, and both times something was missed — the first left a
# local branch behind and the next run refused on a conflict nobody
# could see; the second came back with every phase showing done before
# anything had run.
#
# Two of the three halves live in THIS script, and they live here rather
# than in the skill for a structural reason: the run stands on
# `aide/<folder>` in a worktree of its own, and git refuses to delete a
# branch that is checked out. The skill could not delete it if it tried.

REOPEN_BOUNDARY_DATE = "2026-08-22"


def reopen_line(sha, date=REOPEN_BOUNDARY_DATE):
    """The boundary's own grammar, spelled out rather than derived from
    the script — a fixture that built it the way the reader parses it
    would prove only that the two agreed with each other."""
    return f"- **Reopened:** {date} (history before `{sha}` does not count)\n"


def reset_line(sha, date=REOPEN_BOUNDARY_DATE):
    return f"- **Reset:** {date} (history before `{sha}` does not count)\n"


def archive_the_spec(workspace):
    """Leave the spec where a finished archive step leaves it: under
    `archive/`, with the folder's own name unchanged."""
    specs = workspace["specs"]
    (specs / "archive").mkdir(exist_ok=True)
    subprocess.run(
        ["git", "-C", str(specs), "mv", workspace["folder"], f"archive/{workspace['folder']}"],
        check=True,
    )
    subprocess.run(["git", "-C", str(specs), "commit", "-qm", "archive the spec"], check=True)


def make_branch(root, branch, note="leftover"):
    """A branch left over from an earlier round, with a commit of its
    own, without moving the checkout off its default branch."""
    head = git(root, "rev-parse", "HEAD")
    git(root, "branch", branch, head)
    return head


def has_branch(root, branch):
    return subprocess.run(
        ["git", "-C", str(root), "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"]
    ).returncode == 0


BRANCH = "aide/81-queue-and-runner"


def test_reopen_finds_a_spec_that_is_already_in_the_archive(runner, workspace, fake_claude):
    """The --spec gate checks `$specs_root/$spec_arg` and `$specs_root/*/`
    and nothing else, so an archived folder is "unknown spec" — which
    would refuse the one step that exists to un-archive it, before the
    skill ever ran."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    assert out["ok"] is True, out


def test_the_archive_is_opened_for_reopen_and_for_no_other_step(
    runner, workspace, fake_claude
):
    """An archived spec is not runnable. `reopen` is the exemption, the
    way `create` is the exemption from "the folder must already exist" —
    a named step, never a general relaxation of the gate."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 2, out
    assert "unknown spec" in out["error"], out


def test_reopen_names_the_folder_not_its_archive_path(runner, workspace, fake_claude):
    """The branch, the worktree and the commit are named after the spec,
    and an archived folder resolving to `archive/<slug>` would name a
    branch `aide/archive/<slug>` — a different spec as far as every
    reader of the commit grammar is concerned."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen", dry_run=True)
    assert rc == 0, out
    assert out["prompt"].startswith("/aide-reopen 81"), out["prompt"]


def test_reopen_takes_the_leftover_branch_out_of_both_roots(
    runner, workspace, fake_claude
):
    """Incident 1: a local ref left behind in the main checkout, and the
    next run refused to start on a conflict nobody could see. Both roots
    — an analyze step writes only in the specs repo, and its branch is
    just as much in the way."""
    archive_the_spec(workspace)
    old_project = make_branch(workspace["project"], BRANCH)
    old_specs = make_branch(workspace["specs"], BRANCH)
    # The step leaves work in both roots — in the ARCHIVED folder, which
    # is where a reopen finds the spec. Since spec 215 a branch carrying
    # nothing is deleted at the end of the run that cut it, so a step
    # committing nothing would leave no branch of the run's own to look
    # for here.
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "reopened" > "$PWD/new-code.txt"\n'
        + f'echo "reopened" > "$specs/archive/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    # The run cuts its own branch of the same name from the default
    # branch, so what has to be gone is the earlier round's TIP — not the
    # name.
    for root, old in ((workspace["project"], old_project), (workspace["specs"], old_specs)):
        assert has_branch(root, BRANCH), "the run's own branch"
        reachable = git(root, "rev-list", BRANCH)
        base = git(root, "rev-parse", f"{old}")
        assert base in reachable, "the default branch's history is still there"


def test_reopen_takes_the_branch_off_origin_in_both_roots(
    runner, workspace, fake_claude, origin
):
    """The other two of the four places a branch hides. `push` is `none`
    here, so nothing puts it back — what the bare repos hold at the end
    is what the deletion left."""
    archive_the_spec(workspace)
    for root in (workspace["project"], workspace["specs"]):
        make_branch(root, BRANCH)
        git(root, "push", "-q", "origin", BRANCH)
    for bare in (origin["project"], origin["specs"]):
        assert has_branch(bare, BRANCH), "staged: the branch is on origin"
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    for bare in (origin["project"], origin["specs"]):
        assert not has_branch(bare, BRANCH), f"{bare} still holds {BRANCH}"


def test_reopen_succeeds_when_the_branches_are_already_gone(
    runner, workspace, fake_claude, origin
):
    """Every one of the four deletions tolerates "already gone": a spec
    whose branch was cleaned up by the landing that archived it is the
    normal case, not a failure."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    assert out["ok"] is True, out


# --- spec 270: reopen refuses a spec that is not archived --------------------
#
# The board can go on drawing a Reopen button for a spec whose folder has
# already moved back out of `archive/` — nothing tells it the folder
# moved until its next read. `aide-reopen/SKILL.md` says to stop when the
# spec is not archived, but that is prose read by the invoked model, and
# on 2026-08-27 it did not stop: it reset the files of a spec whose round
# was still running and deleted its branch. The resolver above finds the
# ACTIVE folder first and never records where it found it, so this is the
# gap that let that happen.


def test_reopen_refuses_when_the_spec_is_already_active(runner, workspace, fake_claude):
    """The spec is left exactly where the resolver found it — active,
    not archived — so the run must refuse before it does anything else."""
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 2, out
    assert "already active" in out["error"], out


def test_reopen_refusal_leaves_an_active_specs_branch_alone(
    runner, workspace, fake_claude, origin
):
    """The same four places incident 1 lost a branch in
    (test_reopen_takes_the_leftover_branch_out_of_both_roots and
    test_reopen_takes_the_branch_off_origin_in_both_roots) must survive a
    refused run untouched — proving the guard runs ahead of the
    branch-deletion block, not merely that the run exits nonzero."""
    for root in (workspace["project"], workspace["specs"]):
        make_branch(root, BRANCH)
        git(root, "push", "-q", "origin", BRANCH)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 2, out
    for root in (workspace["project"], workspace["specs"]):
        assert has_branch(root, BRANCH), f"{root} lost its local branch"
    for bare in (origin["project"], origin["specs"]):
        assert has_branch(bare, BRANCH), f"{bare} lost its branch"


def test_reset_accepts_an_active_spec_and_removes_remote_branches(
    runner, workspace, fake_claude, origin
):
    for root in (workspace["project"], workspace["specs"]):
        make_branch(root, BRANCH)
        git(root, "push", "-q", "origin", BRANCH)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reset")
    assert rc == 0, out
    for bare in (origin["project"], origin["specs"]):
        assert not has_branch(bare, BRANCH)


def test_reset_is_refused_for_an_archived_spec(runner, workspace, fake_claude):
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reset")
    assert rc == 2, out
    assert "unknown spec" in out["error"]


def test_reopen_leaves_the_earlier_rounds_commits_in_the_repository(
    runner, workspace, fake_claude
):
    """The commits happened, and the archive is a record. What changes is
    what COUNTS them, never what is in the repository."""
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    archive_the_spec(workspace)
    before = git(workspace["specs"], "log", "--format=%s", "main")
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    after = git(workspace["specs"], "log", "--format=%s", "main")
    assert before == after, "the default branch's history must not be rewritten"
    for step in ("create", "analyze", "implement", "archive"):
        assert subject(step, workspace["folder"]) in after


# --- the boundary: what has run reads as nothing -----------------------------


def test_the_reopen_boundary_takes_the_earlier_rounds_steps_off_the_line(
    runner, workspace, fake_claude
):
    """Incident 2: a reopened spec came back with the status file
    claiming four completed steps before anything had run."""
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    boundary = git(workspace["specs"], "rev-parse", "HEAD")
    with_status(workspace, reopened=boundary)
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "analyze"


def test_a_step_run_after_the_reopen_boundary_still_counts(
    runner, workspace, fake_claude
):
    """`--not <sha>` excludes what is REACHABLE from the mark, and a
    commit made after it is a descendant, never an ancestor. A boundary
    that hid the new round too would be the same bug pointing the other
    way."""
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    boundary = git(workspace["specs"], "rev-parse", "HEAD")
    with_status(workspace, reopened=boundary)
    already_ran(workspace, ["create"])
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze"


def test_the_reset_boundary_excludes_the_earlier_round(runner, workspace, fake_claude):
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    boundary = git(workspace["specs"], "rev-parse", "HEAD")
    with_status(workspace, reopened=boundary)
    status = workspace["specs"] / workspace["folder"] / "4-status.md"
    status.write_text(status.read_text().replace(reopen_line(boundary), reset_line(boundary)))
    git(workspace["specs"], "add", str(status))
    git(workspace["specs"], "commit", "-qm", "use reset boundary")
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "analyze"


def test_a_spec_that_has_never_been_reopened_counts_everything(
    runner, workspace, fake_claude
):
    """The boundary is OPTIONAL everywhere it is added: a spec with no
    mark — the overwhelming majority — takes the path it took before."""
    already_ran(workspace, ["create", "implement"])
    with_status(workspace)
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"


# --- spec 220: merge the code, or open a pull request ------------------------
#
# The dashboard's global `push` setting applies to every project on the
# host at once, so a team that reviews its code and a solo project that
# does not could not both be served. The choice is the PROJECT's now, in
# the committed manifest, and it forces `--push pr` — a landing left open
# for review with no pull request describing it is worse than either
# behaviour on its own. `tests/fixtures/code-landing-precedence.json` is
# the table the dashboard's own test reads too.

CODE_LANDING = json.loads(
    (pathlib.Path(__file__).resolve().parents[4] / "fixtures" / "code-landing-precedence.json")
    .read_text()
)["cases"]


def configure_code_landing(workspace, manifest, config):
    """Write a case's two files. The `.aide/config` spelling is written
    only so the run can be shown IGNORING it — unlike the worktree links,
    this setting has no fallback there."""
    project = workspace["project"]
    (project / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={workspace['specs']}\n"
        + (f"AIDE_CODE_LANDING={config}\n" if config else "")
    )
    (project / ".aide" / "project.yaml").write_text(
        "name: proj\n" + (f"codeLanding: {manifest}\n" if manifest else "")
    )
    git(project, "add", "-f", ".aide/config", ".aide/project.yaml")
    git(project, "commit", "-q", "-m", "configure the code landing")


@pytest.mark.parametrize("case", CODE_LANDING, ids=[c["name"] for c in CODE_LANDING])
def test_the_code_landing_decides_the_default_push_mode(
    runner, workspace, fake_claude, fake_gh, origin, case
):
    """The `push` column of the shared table: what a run with no `--push`
    on its command line ends up using. `pr` in the manifest is the only
    value that changes anything — every other spelling, and the absence
    of the key, leaves the hand-run default of `none` exactly as it was.
    """
    configure_code_landing(workspace, case["manifest"], case["config"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _, err = run_with_gh(
        runner, workspace, claude, fake_gh(), push=None, return_stderr=True
    )
    assert rc == 0, out
    assert out["push"] == case["push"], f"{case['name']}: {err}"
    if case["push"] == "pr":
        # Said out loud, the way the worktree links report their source:
        # a value that changes how a run publishes must not do it in
        # silence.
        assert "codeLanding" in err, err


def test_a_typed_push_mode_beats_the_manifest(
    runner, workspace, fake_claude, fake_gh, origin
):
    """The manifest supplies a DEFAULT, not an override. A person typing
    `--push branch` at a terminal has said what they want, and a file
    quietly overruling it is the shape of a run nobody can steer."""
    configure_code_landing(workspace, "pr", None)
    claude = writing_claude(fake_claude, workspace)
    gh = fake_gh()
    rc, out, _ = run_with_gh(runner, workspace, claude, gh, push="branch")
    assert rc == 0, out
    assert out["push"] == "branch", out
    assert not fake_gh.calls.exists(), "gh is only for `pr`"


def test_a_pr_landing_opens_the_pull_request(runner, workspace, fake_claude, fake_gh, origin):
    """The whole reason the default is forced rather than merely allowed:
    without a pull request there is nothing for the dashboard to leave
    open, so the two halves must travel together."""
    configure_code_landing(workspace, "pr", None)
    claude = writing_claude(fake_claude, workspace)
    gh = fake_gh()
    rc, out, _ = run_with_gh(runner, workspace, claude, gh, push=None)
    assert rc == 0, out
    assert fake_gh.calls.exists(), "a pr landing must open one"
    assert out["prUrl"], out


# --- spec 246: the Total progress header is recomputed, not narrated ---------
#
# `Workflow steps completed` (above) says whether the SPEC ran a step;
# `Total progress` is a different question — how far the file's OWN
# Phase tables have got — and until now it was written once by
# `/aide-analyze` and never touched again. This block is the row-
# counting recompute, run at the end of every `WORKFLOW_ARC` step,
# using the identical done/open rule `parseStatusChecks`/`isDoneMark`
# (dashboard/src/parse-status.ts) already use.


def write_raw_status(workspace, content):
    """A committed `4-status.md` with EXACTLY the text given — no
    `with_status()` shape assumed, since these tests exercise the header
    format and Phase-table row shapes the recompute has to agree with
    directly, in each test's own words."""
    (workspace["specs"] / workspace["folder"] / "4-status.md").write_text(content)
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "add status"], check=True)


def test_open_rows_recompute_the_header_percentage(runner, workspace, fake_claude):
    """AC1: a header reading `0% (0 of 4 completed)` next to 4 real rows
    (2 done, 2 open) is rewritten to the real split."""
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Total progress:** 0% (0 of 4 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| one | ✅ | |\n"
        "| two | ✅ | |\n"
        "| three | ⬜ | |\n"
        "| four | ⬜ | |\n",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert bullet(text, "Total progress") == "50% (2 of 4 completed)"


def test_a_header_that_already_matches_is_not_rewritten(runner, workspace, fake_claude):
    """AC2: a header already agreeing with the real row count produces no
    change and no commit — the same `cmp -s` guard `Workflow steps
    completed` already uses."""
    rows = "\n".join(f"| task {i} | ✅ | |" for i in range(1, 13))
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Workflow steps completed:** analyze\n"
        "- **Total progress:** 100% (12 of 12 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        f"{rows}\n",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    roots = {r["root"]: r for r in out["repos"]}
    # spec 355: see the matching comment on
    # test_a_line_that_is_already_right_is_not_rewritten above — the
    # ONE genuinely new file is this fixture's first-ever 4-status.json.
    assert roots[str(workspace["specs"])]["changedFiles"] == 1


def test_both_numerator_and_denominator_are_corrected(runner, workspace, fake_claude):
    """AC3: spec 245's own real, archived staleness — a header of `73%
    (11 of 15 completed)` next to 19 real, all-✅ rows becomes `100% (19
    of 19 completed)`. Both numbers were wrong, not the denominator
    alone."""
    rows = "\n".join(f"| task {i} | ✅ | |" for i in range(1, 20))
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Total progress:** 73% (11 of 15 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        f"{rows}\n",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert bullet(text, "Total progress") == "100% (19 of 19 completed)"


def test_a_fresh_status_file_with_no_rows_yet_is_left_untouched(runner, workspace, fake_claude):
    """AC4: a status file straight from the template — Phase tables with
    no rows yet, header still the literal `X` placeholder `/aide-create`
    writes — has nothing to derive from, so `create` leaves the line
    exactly as found."""
    made = "99-a-brand-new-spec"
    body = (
        "# New - Status\n\n"
        "Total progress: 0% (0 of X completed)\n\n"
        "## Tracking info\n\n"
        f"- **Task:** `{made}/`\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
    )
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'mkdir -p "$specs/{made}"\n'
        + f'cat > "$specs/{made}/4-status.md" <<\'STATUSEOF\'\n'
        + body
        + "STATUSEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="create", spec="81")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{made}/4-status.md")
    assert "Total progress: 0% (0 of X completed)" in text


def test_the_bare_unbolded_format_survives_the_rewrite(runner, workspace, fake_claude):
    """AC5: real specs write `Total progress: X% (Y of Z completed)`
    directly under the title, unbolded, no bullet — not the documented
    bold/bulleted form. Only the digits change; the rest of the line and
    its position survive."""
    rows = "\n".join(f"| task {i} | ✅ | |" for i in range(1, 20))
    write_raw_status(
        workspace,
        "# Queue - Status\n\n"
        "Total progress: 73% (11 of 15 completed)\n"
        "Estimate: 4-6 hours (AI-assisted)\n\n"
        "## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        f"{rows}\n",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert "Total progress: 100% (19 of 19 completed)" in text
    assert "Estimate: 4-6 hours (AI-assisted)" in text


def test_the_bold_bulleted_format_survives_the_rewrite(runner, workspace, fake_claude):
    """AC6: the documented bold/bulleted form — `- **Total progress:**`
    inside `## Tracking info`, the exact shape `with_status()`'s own
    fixture writes — keeps its markup; only the digits change."""
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Total progress:** 0% (0 of 4 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n**Status:** ✅ Completed\n\n### Tasks\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| one | ✅ | |\n"
        "| two | ✅ | |\n"
        "| three | ⬜ | |\n"
        "| four | ⬜ | |\n",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert bullet(text, "Total progress") == "50% (2 of 4 completed)"


def test_a_non_checkbox_status_row_counts_as_one_task(runner, workspace, fake_claude):
    """AC7: a three-column row with a bare status word instead of a
    checkbox mark (spec 245's own real `Plan review` row) counts the
    same as any ordinary row."""
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Total progress:** 0% (0 of 2 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| Plan review (feasibility, scope guardian, coherence) | ✅ | Three blind subagents; 2 must-fix |\n"
        "| ordinary task | ⬜ | |\n",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert bullet(text, "Total progress") == "50% (1 of 2 completed)"


STATUS_ROW_COUNTING = json.loads(
    (pathlib.Path(__file__).resolve().parents[4] / "fixtures" / "status-row-counting.json")
    .read_text()
)["cases"]


@pytest.mark.parametrize(
    "case", STATUS_ROW_COUNTING, ids=[c["name"] for c in STATUS_ROW_COUNTING]
)
def test_the_shared_row_counting_fixture_matches_the_bash_side(
    runner, workspace, fake_claude, case
):
    """AC8, bash half: `tests/fixtures/status-row-counting.json` is the
    same table `dashboard/test/parse-status.test.ts` reads for the
    TypeScript half — both must report the identical done/total split
    for every case."""
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Total progress:** 0% (0 of 999 completed)\n\n---\n\n"
        f"{case['body']}",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    if case["total"] == 0:
        assert bullet(text, "Total progress") == "0% (0 of 999 completed)"
    else:
        pct = (case["done"] * 100 + case["total"] // 2) // case["total"]
        assert bullet(text, "Total progress") == f"{pct}% ({case['done']} of {case['total']} completed)"


# --- spec 268: a "completed" implement claim is cross-checked ----------------
#
# The CLI's own turn-subtype signal is not enough on its own: a step that
# reports success while leaving no real trace must not count as
# `implement` for "Workflow steps completed", or archive's own gate
# (which now asks only whether implement ran, not what the checklist
# says) would let a vacuous run through. Two ways a run can be hollow —
# nothing changed in the project repo at all, or the project changed but
# no task row moved off unstarted (AC5). A genuine run, where the
# project changed AND at least one row is ticked, is unaffected (AC6).


def status_with_phase(workspace, claims, rows, heading="## Phase 1: RED"):
    """A committed `4-status.md` naming `claims` on the steps line and
    carrying ONE phase section with the given rows — full control over
    the row-ticking state the no-progress check reads."""
    row_lines = "\n".join(rows)
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        f"- **Workflow steps completed:** {claims}\n"
        "- **Total progress:** 0% (0 of 99 completed)\n\n---\n\n"
        f"{heading}\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        f"{row_lines}\n",
    )


def test_a_completed_claim_with_no_project_change_at_all_is_downgraded(
    runner, workspace, fake_claude
):
    """AC5: the CLI reports success, but the child touched neither the
    project nor the specs repo at all."""
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "no-progress", out
    assert recorded_line(workspace) == "create, analyze"


def test_a_completed_claim_that_ticks_no_row_still_counts(
    runner, workspace, fake_claude
):
    """The project genuinely changed, but not one task row moved off
    unstarted — and that is NOT a failure.

    A Phase table is the run's own record of its work, and nothing gates
    on it: archive's only gate is the `## Acceptance criteria` section.
    Failing a step that changed real code because its bookkeeping lagged
    turned a record-keeping slip into a red run someone had to
    re-drive."""
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |", "| b | ⬜ | |"])
    claude = project_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert recorded_line(workspace) == "create, analyze, implement"


def test_a_genuine_implement_run_is_unaffected(runner, workspace, fake_claude):
    """AC6: the project changed AND a row is ticked — exactly today's
    behavior for a real run, unaffected by the new check."""
    status_with_phase(workspace, "create, analyze", ["| a | ✅ | |", "| b | ⬜ | |"])
    claude = project_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert recorded_line(workspace) == "create, analyze, implement"


def test_no_progress_is_scoped_to_implement_only(runner, workspace, fake_claude):
    """The check is `implement`-specific: an `analyze` run that changes
    nothing in the project repo is exactly today's ordinary case (analyze
    never touches the project), not a new failure mode this spec
    introduces."""
    with_status(workspace)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out


# --- spec 280: a "completed" archive claim is cross-checked ------------------
#
# The same shape as the spec-268 guard above, mirrored for `archive`:
# `status_file_for`'s own two-candidate resolution (active folder, then
# `archive/`) already proves whether the mechanical stamp-and-move
# (core/scripts/aide-archive-spec) actually ran in THIS worktree — a
# `completed` claim not backed by that move must not land in
# `4-status.md`.


def test_archive_no_progress_guard_downgrades_when_the_folder_never_moved(
    runner, workspace, fake_claude
):
    """AC3. The archive precheck meets an OPEN conflict (so the model is
    spawned at all — `conflict-open` is not a skip-the-model outcome),
    the step resolves it and reports `completed`, but the spec folder
    itself was never actually moved under `archive/` — the exact shape
    spec 278 produced."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    conflicting_branch(workspace)
    claude = fake_claude(
        "cat > /dev/null\n"
        'printf "resolved by the step\\n" > contested.txt\n'
        "git add -A\n"
        "git commit -q --no-edit\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "no-progress", out
    assert "never moved to archive" in out["error"], out
    assert recorded_line(workspace) == "create, analyze, implement"


def test_a_genuine_archive_run_is_unaffected(runner, workspace, fake_claude):
    """AC4. The spec folder genuinely moves under `archive/` (the
    mechanical pre-check's own `archived` outcome, since `implement` is
    on the line and nothing conflicts) — `terminalReason` stays
    `completed` and `archive` is added to the line, unaffected by the
    new check."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    folder = workspace["folder"]
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert (
        recorded_line(workspace, path=f"archive/{folder}/4-status.md")
        == "create, analyze, implement, archive"
    )


@pytest.mark.parametrize("step", ["create", "analyze", "implement"])
def test_archive_no_progress_guard_never_fires_for_other_steps(
    runner, workspace, fake_claude, step
):
    """AC5. The new check is `archive`-specific — mirrors
    `test_no_progress_is_scoped_to_implement_only` above, extended to
    the sibling check `archive` gained. None of these three steps moves
    the spec folder, so if the check were not scoped to
    `command_name = archive` it would wrongly downgrade every one of
    them."""
    if step == "create":
        claude = fake_claude(
            "cat > /dev/null\n"
            + READ_SPECS
            + 'mkdir -p "$specs/99-a-brand-new-spec"\n'
            + 'printf "%s\\n" "# New - Status" "" "## Tracking info" "" "- **Task:** `99-a-brand-new-spec/`" '
            + '> "$specs/99-a-brand-new-spec/4-status.md"\n'
            + f"echo '{json.dumps(RESULT_OK)}'"
        )
        rc, out, _ = run(runner, workspace, claude, command="create", spec="81")
    elif step == "analyze":
        with_status(workspace)
        claude = specs_only_claude(fake_claude, workspace)
        rc, out, _ = run(runner, workspace, claude, command="analyze")
    else:
        status_with_phase(workspace, "create, analyze", ["| a | ✅ | |"])
        claude = project_only_claude(fake_claude, workspace)
        rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out


# --- spec 288: a "completed" analyze claim is cross-checked ------------------
#
# Spec 284's own incident: an `/aide-analyze` session did `implement`'s
# GREEN-phase code edits itself, left them uncommitted in the shared
# worktree, and then wrote `4-status.md` as an honest account of work it
# had, itself, gone ahead and done. `analyze` is scoped to `2-analysis.md`
# and `3-solution.md` only (core/rules/spec-structure.md) — it must never
# change the project repo, advance a Phase-table row past "not started",
# or claim a step beyond itself on the `Workflow steps completed` line.
# All three are checked against what the run actually produced, the same
# way spec 268/280 check implement/archive.


def analyze_claude_advancing_row(fake_claude, workspace, mark):
    """A stand-in analyze step that rewrites 4-status.md's own Phase 1
    row to a mark other than not-started — implement's and archive's job,
    never analyze's own (REQ-1, REQ-2)."""
    folder = workspace["folder"]
    body = (
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{folder}/`\n"
        "- **Workflow steps completed:** create\n"
        "- **Total progress:** 0% (0 of 1 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        f"| a | {mark} | |\n"
    )
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'cat > "$specs/{folder}/4-status.md" <<\'STATUSEOF\'\n'
        + body
        + "STATUSEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def analyze_claude_naming_implement(fake_claude, workspace):
    """A stand-in analyze step that writes `implement` onto the Workflow
    steps line itself, with no project change and no row advanced — the
    shape spec 284's own `1b3748a` produced (REQ-2)."""
    folder = workspace["folder"]
    body = (
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{folder}/`\n"
        "- **Workflow steps completed:** create, analyze, implement\n"
        "- **Total progress:** 0% (0 of 1 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| a | ⬜ | |\n"
    )
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'cat > "$specs/{folder}/4-status.md" <<\'STATUSEOF\'\n'
        + body
        + "STATUSEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def test_an_analyze_claim_that_changed_the_project_repo_is_downgraded(
    runner, workspace, fake_claude
):
    """AC1/REQ-1: spec 284's own incident — the CLI reports success, but
    the child left a real change in the project repo, which analyze must
    never do."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = project_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert recorded_line(workspace) == "create"


@pytest.mark.parametrize("mark", ["✅", "🔄", "❌", "⚠️"])
def test_an_analyze_claim_that_advances_a_phase_row_is_downgraded(
    runner, workspace, fake_claude, mark
):
    """AC2/REQ-1, REQ-2: a Phase-table row moved off "not started" during
    an analyze run — that is implement's and archive's job — parametrized
    over every non-not-started mark a row could end up carrying."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = analyze_claude_advancing_row(fake_claude, workspace, mark)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out


def test_an_analyze_claim_that_names_implement_on_the_line_is_downgraded(
    runner, workspace, fake_claude
):
    """AC3/REQ-2: the project did not change and no row advanced, but the
    raw `Workflow steps completed` line itself names a step beyond
    analyze that the pre-session line did not already carry."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = analyze_claude_naming_implement(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out


def analyze_claude_writing_the_line_from_nothing(fake_claude, workspace):
    """A stand-in analyze step on a spec whose 4-status.md carries NO
    steps line — which is every spec at creation — that writes the line
    itself as `create, analyze`, and advances nothing."""
    folder = workspace["folder"]
    body = (
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{folder}/`\n"
        "- **Workflow steps completed:** create, analyze\n"
        "- **Total progress:** 0% (0 of 1 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| a | ⬜ | |\n"
    )
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'cat > "$specs/{folder}/4-status.md" <<\'STATUSEOF\'\n'
        + body
        + "STATUSEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def test_an_analyze_that_names_create_on_a_line_that_did_not_exist_is_fine(
    runner, workspace, fake_claude
):
    """Spec 348's refusal: the file had no steps line before the run, so
    the allowed set was `analyze` alone and the model's own `create` read
    as a step beyond scope. A spec that exists has been through create."""
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Last updated:** `[not started]`\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| a | ⬜ | |\n",
    )
    claude = analyze_claude_writing_the_line_from_nothing(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out


def analyze_claude_renaming_the_header(fake_claude, workspace):
    """Spec 299: a stand-in analyze step that rewrites the Phase table's
    header to non-standard column names, leaving its one row exactly
    where it was (⬜) — nothing genuinely advanced, so the header itself
    must never be counted as the row that did."""
    folder = workspace["folder"]
    body = (
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{folder}/`\n"
        "- **Workflow steps completed:** create\n"
        "- **Total progress:** 0% (0 of 1 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| REQ | Criterion | Done |\n|------|--------|-------|\n"
        "| a | ⬜ | |\n"
    )
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'cat > "$specs/{folder}/4-status.md" <<\'STATUSEOF\'\n'
        + body
        + "STATUSEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def test_an_analyze_run_that_renames_the_header_columns_is_unaffected(
    runner, workspace, fake_claude
):
    """REQ-1 regression (the description's own bug): renaming a Phase
    table's header away from `Task | Status | Notes` must never itself
    count as an advanced row, or a genuine no-op analyze run is wrongly
    downgraded to scope-violation."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = analyze_claude_renaming_the_header(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out


def test_completed_steps_for_ignores_a_step_the_current_sessions_own_edit_added(
    runner, workspace, fake_claude
):
    """AC4/REQ-3: the actual trust hole — a step's own session writes a
    LATER step's name onto the Workflow-steps-completed line, unsupported
    by the commit history or by what the line said before this session
    ran. The timing fix (`existing_line` read from BEFORE this session,
    not after) means that unsupported name is dropped rather than granted
    permanent credit for a step that never actually happened."""
    status_with_phase(workspace, "create, analyze", ["| a | ✅ | |", "| b | ⬜ | |"])
    folder = workspace["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f'sed "s/create, analyze/create, analyze, implement, archive/" '
        + f'"$specs/{folder}/4-status.md" > "$specs/{folder}/4-status.md.new"\n'
        + f'mv "$specs/{folder}/4-status.md.new" "$specs/{folder}/4-status.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"


def test_a_genuine_analyze_run_is_unaffected(runner, workspace, fake_claude):
    """AC5/REQ-1, REQ-2 (regression): a real analyze run — writes only
    2-analysis.md/3-solution.md, touches nothing in the project, and
    leaves the Phase-table row exactly as it found it — is unaffected by
    the new checks, mirroring spec 268's own AC6."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    folder = workspace["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "analysis" > "$specs/{folder}/2-analysis.md"\n'
        + f'echo "solution" > "$specs/{folder}/3-solution.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert recorded_line(workspace) == "create, analyze"


# --- spec 352, REQ-7: the bash side of the sentence registry ---------------
#
# `aide-run-spec`'s own error strings reach the board unrewritten
# (`runner.ts`'s `outcome.error ?? outcome.terminalReason` passthrough), so
# this file's registry checks the SAME rule the TypeScript one does
# (`dashboard/test/render/ui/error-sentence-registry.test.ts`) against the
# script's own source text, the same "read both sides as text" pattern the
# other hand-paired bash/TypeScript decisions already use
# (`dashboard/CLAUDE.md`, "The hand-paired bash/TypeScript pairs").
#
# Grows one phase at a time, same as the TypeScript registry: empty here at
# Step 0, since none of `aide-run-spec`'s sentences are migrated yet — Phase
# 4 (`3-solution.md`) is what adds entries for `refuse()`'s callers, the
# diverged/fast-forward/conflict/no-progress sentences and the
# provider-failure strings. `refuse()` itself is not registered separately,
# the same way the TypeScript `refuse()` in `branch-merge.ts` is not: it is
# a generic helper that relays whatever sentence its caller composed, and
# every caller that reaches the board is registered below instead.
BASH_ERROR_REGISTRY: list[dict] = [
    {
        "name": "a local branch has diverged from origin's copy (sync_branch_with_origin)",
        "pattern": r"\$br has diverged from origin's copy.*",
        "resolve": "in the checkout on the serving host",
    },
    {
        "name": "a local branch cannot fast-forward to origin's copy (sync_branch_with_origin)",
        "pattern": r"cannot fast-forward \$br to origin's copy.*",
        "resolve": "in the checkout on the serving host",
    },
    {
        "name": "bringing a branch up to date conflicts (update_branch_to_base)",
        "pattern": r"cannot bring \$branch up to date with \$ref.*",
        "resolve": "in the checkout on the serving host",
    },
    {
        "name": "a completed implement left no real progress",
        "pattern": r"the step reported success but left no real progress — nothing changed in the project.*",
        "resolve": "Press Run again",
    },
    {
        "name": "a completed archive left no real progress",
        "pattern": r"the step reported success but left no real progress — the spec folder was never moved to archive/.*",
        "resolve": "Press Run again",
    },
    {
        "name": "a completed analyze changed things outside its scope",
        "pattern": r"the step reported success but changed things outside analyze's scope.*",
        "resolve": "Press Run again",
    },
    {
        "name": "a step stopped at its own time limit",
        "pattern": r"stopped at its own \$\{timeout_sec\}s time limit for this step.*",
        "exempt": "a time-limited step resumes on its own next run — nothing to resolve by hand",
    },
    {
        "name": "a provider rate/usage limit was reached",
        "pattern": r"\$limit_type provider limit reached.*",
        "resolve": "press Run again",
    },
    {
        "name": "the step's own budget was reached",
        "pattern": r"the step's budget was reached.*",
        "resolve": "press Run again",
    },
    {
        "name": "the provider reported an error with no message of its own (is_error)",
        "pattern": r'error_msg="provider reported an error"\n\s*error_msg="\$error_msg — press Run again"',
        "resolve": "press Run again",
    },
    {
        "name": "the tool exited non-zero with no result JSON error",
        "pattern": r'error_msg="\$tool exit \$exit_code — press Run again"',
        "resolve": "press Run again",
    },
    {
        "name": "the tool produced no result JSON at all",
        "pattern": r'no result JSON \(exit \$exit_code\)"\n\s*error_msg="\$error_msg — press Run again"',
        "resolve": "press Run again",
    },
]


def test_every_bash_error_sentence_has_a_resolution_or_a_named_exemption(runner):
    """REQ-7: "A test SHALL fail for an error sentence that carries no
    resolution, over the set of sentences the board can show" — this is
    that check for the bash-authored half of the set. Each registry entry
    names a literal or regex fragment expected in the script's own source
    and either a `resolve` substring the matched text must contain, or an
    `exempt` reason there is genuinely nothing to resolve."""
    source = runner.read_text()
    for entry in BASH_ERROR_REGISTRY:
        match = re.search(entry["pattern"], source)
        assert match, f"{entry['name']}: pattern not found in {runner}"
        resolve, exempt = entry.get("resolve"), entry.get("exempt")
        assert resolve or exempt, f"{entry['name']}: has neither resolve nor exempt"
        if resolve:
            assert resolve in match.group(0), f"{entry['name']}: {resolve!r} not in {match.group(0)!r}"




# --- a stale local branch is never the base of a run ------------------------


def test_a_local_branch_origin_no_longer_has_is_not_reused(runner, workspace, fake_claude, origin):
    """A branch that landed and was deleted on origin can linger locally
    with commits of its own (a stopped archive's note, a killed run).
    Cutting the next run from it carried a status file that said
    "create, analyze" about specs whose implement had long landed, and
    every archive was refused on it (351, 356 — 2026-09-03)."""
    branch = "aide/81-queue-and-runner"
    project = workspace["project"]
    subprocess.run(["git", "-C", str(project), "checkout", "-q", "-b", branch], check=True)
    (project / "stale.txt").write_text("left behind\n")
    subprocess.run(["git", "-C", str(project), "add", "stale.txt"], check=True)
    subprocess.run(["git", "-C", str(project), "commit", "-qm", "stale local commit"], check=True)
    # It once tracked origin — that is what tells a leftover from a
    # branch nobody ever pushed.
    subprocess.run(["git", "-C", str(project), "config", f"branch.{branch}.remote", "origin"], check=True)
    subprocess.run(["git", "-C", str(project), "config", f"branch.{branch}.merge", f"refs/heads/{branch}"], check=True)
    subprocess.run(["git", "-C", str(project), "checkout", "-q", "main"], check=True)
    assert git(origin["project"], "branch", "--list", branch) == ""
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, push="branch", command="implement")
    assert rc == 0, out
    log = git(origin["project"], "log", "--pretty=%s", branch)
    assert "stale local commit" not in log, "the run was cut from the stale local branch"


# --- a step writes only its own spec folder in the specs repo ---------------
#
# 366's implement created two specs beside its own and deleted them again
# on its branch; the creations landed, other runs built on them, and the
# deletion landed on top of that work (2026-09-03). Under the specs root,
# nothing but the spec's own folder (and its archive/ twin) may change;
# foreign changes are discarded before the commit and the step is a
# scope violation naming them.
def specs_foreign_folder_claude(fake_claude, workspace):
    """A stand-in analyze step that also makes a spec folder of its own
    beside the one it was given."""
    folder = workspace["folder"]
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'mkdir -p "$specs/999-made-by-the-run" && echo "# 999" > "$specs/999-made-by-the-run/1-description.md"\n'
        + f'echo "analysis" >> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def test_a_run_that_creates_another_spec_folder_is_downgraded_and_the_folder_discarded(
    runner, workspace, fake_claude
):
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = specs_foreign_folder_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "999-made-by-the-run" in out["error"], out
    assert "press Run again" in out["error"], out
    tree = git(workspace["specs"], "ls-tree", "-r", "--name-only", "aide/81-queue-and-runner")
    assert "999-made-by-the-run" not in tree, tree
    assert f"{workspace['folder']}/2-analysis.md" in tree, tree


def test_a_run_that_deletes_another_spec_folder_is_downgraded_and_the_folder_restored(
    runner, workspace, fake_claude
):
    other = workspace["specs"] / "80-neighbour"
    other.mkdir()
    (other / "1-description.md").write_text("# 80\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "add a neighbour")
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + 'rm -rf "$specs/80-neighbour"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "scope-violation", out
    assert "80-neighbour" in out["error"], out
    tree = git(workspace["specs"], "ls-tree", "-r", "--name-only", "aide/81-queue-and-runner")
    assert "80-neighbour/1-description.md" in tree, tree


def test_a_run_that_writes_only_its_own_folder_is_not_a_scope_violation(runner, workspace, fake_claude):
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    folder = workspace["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "analysis" >> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
