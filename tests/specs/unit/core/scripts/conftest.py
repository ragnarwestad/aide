"""What every part of the aide-run-spec suite shares: the fixtures that
build a project, a specs root and a stand-in AI, the helper that invokes
the runner, and the small builders the tests reach for by name.

Split out 2026-09-04, when test_aide_run_spec.py had reached 7348 lines —
seven times the next largest test file and fourteen times the script it
tests. A conftest, so the fixtures reach every part without an import;
the plain helpers sit here too, and a part asks for them by name.
"""

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

def _standalone_runner_copy(runner, tmp_path, name="aide-run-spec-under-test"):
    """A working stand-in for `aide-run-spec`, in its own directory: the
    script itself, plus the files it reads relative to its own location
    (`_aide-spec-lib.sh`, and — since spec 349 — `lib/workflow-steps.json`,
    and since spec 364 `lib/effort-levels.json` too, without which every
    command refuses)."""
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
    # effort-levels.json too (spec 364): read the same way, without which
    # every command refuses just as it would with workflow-steps.json missing.
    (tmp_path / "lib" / "effort-levels.json").write_bytes(
        (pathlib.Path(runner).parent / "lib" / "effort-levels.json").read_bytes()
    )
    # status-progress.sh too: sourced by the runner whenever a
    # 4-status.md exists — which, since spec 344's fixture, is every run.
    (tmp_path / "lib" / "status-progress.sh").write_bytes(
        (pathlib.Path(runner).parent / "lib" / "status-progress.sh").read_bytes()
    )
    # And the runner's own phases (`lib/run-spec-*.sh`, 2026-09-04): the
    # script sources them by name, so a copy without them refuses before
    # it starts. Copied by pattern rather than one by one, so a phase
    # that moves between files does not have to be named here as well.
    for part in sorted((pathlib.Path(runner).parent / "lib").glob("run-spec-*.sh")):
        (tmp_path / "lib" / part.name).write_bytes(part.read_bytes())
    return copy

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

def specs_only_claude(fake_claude, workspace):
    """An `analyze` step: it changes the specs repo and nothing else.
    This is the shape of most of what the queue actually runs."""
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )

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

def workflow_steps_line(repo, branch, folder, name="4-status.md"):
    """The `Workflow steps completed:` line as a fresh read of `repo`'s
    own copy of `branch` sees it — never the working tree, which the run's
    own worktree removal already tore down by the time a test looks."""
    text = git(repo, "show", f"{branch}:{folder}/{name}")
    lines = [l for l in text.splitlines() if "Workflow steps completed" in l]
    return lines[0] if lines else None

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

def is_ancestor(repo, a, b):
    return subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", a, b]
    ).returncode == 0

@pytest.fixture
def fetchable_origin(workspace, tmp_path):
    """A bare project origin reachable for fetch as well as push."""
    bare = tmp_path / "fetchable-origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", str(bare))
    git(workspace["project"], "push", "-q", "origin", "main")
    return bare

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

SCHEDULE_KEY = "schedule-nightly-report"

def schedule(runner, ws, claude, **kwargs):
    kwargs.setdefault("command", "schedule")
    kwargs.setdefault("spec", SCHEDULE_KEY)
    kwargs.setdefault("prompt_file", "docs/nightly-report.md")
    return run(runner, ws, claude, **kwargs)

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

def write_raw_status(workspace, content):
    """A committed `4-status.md` with EXACTLY the text given — no
    `with_status()` shape assumed, since these tests exercise the header
    format and Phase-table row shapes the recompute has to agree with
    directly, in each test's own words."""
    (workspace["specs"] / workspace["folder"] / "4-status.md").write_text(content)
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "add status"], check=True)

STATUS_ROW_COUNTING = json.loads(
    (pathlib.Path(__file__).resolve().parents[4] / "fixtures" / "status-row-counting.json")
    .read_text()
)["cases"]

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
