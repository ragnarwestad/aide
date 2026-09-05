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




















































































# The spec files the tests build, kept beside this one.
from .run_spec.run_spec_status_files import (  # noqa: E402,F401
    REOPEN_BOUNDARY_DATE,
    STATUS_ROW_COUNTING,
    TIME_OF_DAY_RE,
    TIME_SPENT_RE,
    add_spec,
    already_ran,
    bullet,
    conflicting_branch,
    nested_workspace,
    phase_file_text,
    recorded_line,
    recorded_model,
    reopen_line,
    reset_line,
    set_depends_on,
    status_only_conflict,
    status_with_phase,
    subject,
    tracked_specs_inside_project_workspace,
    tracking_block,
    with_analysis,
    with_analysis_attempts,
    with_solution,
    with_status,
    workflow_steps_line,
    write_raw_status,
)


# The stand-in AIs, kept beside this file — imported here so every part of
# the suite keeps one import surface.
from .run_spec.run_spec_fakes import (  # noqa: E402,F401
    analyze_claude_advancing_row,
    analyze_claude_naming_implement,
    analyze_claude_renaming_the_header,
    analyze_claude_writing_the_line_from_nothing,
    analyzing_claude,
    conflicting_race_claude,
    creating_claude,
    linking_claude,
    make_named_writing_claude,
    make_worktree_add_gate,
    partially_committing_claude,
    probing_claude,
    project_only_claude,
    race_pushing_claude,
    self_committing_claude,
    self_pushing_claude,
    specs_foreign_folder_claude,
    specs_only_claude,
    writing_claude,
)

# The project state a run is checked against, and the sentence
# registry — kept beside this file, imported here so every part of
# the suite keeps one import surface.
from .run_spec.run_spec_project_state import (  # noqa: E402,F401
    BASH_ERROR_REGISTRY,
    BASH_UNTESTABLE,
    CODE_LANDING,
    PRECEDENCE,
    READINESS_FIXTURE,
    READINESS_SCENARIOS,
    STATUS_ROW_COUNTING,
    _break_default_branch_held_elsewhere,
    _break_git_root,
    _break_specs_root,
    _break_worktree_links,
    configure_code_landing,
    configure_links,
)

# The origins a run pushes to, kept beside this file. Imported here so
# the fixtures among them reach every part, and so the suite keeps one
# import surface.
from .run_spec.run_spec_origins import (  # noqa: E402,F401
    archive_the_spec,
    fake_gh,
    fetchable_origin,
    fetchable_origin_both_roots,
    has_branch,
    is_ancestor,
    leave_branch_on_origin,
    leave_unmerged_branch_on_origin,
    local_origin,
    local_origins,
    make_branch,
    origin,
    rejecting_origin,
    run_with_gh,
    specs_origin_rejecting_the_second_push,
)

# What a run reports back, kept beside this file.
from .run_spec.run_spec_results import (  # noqa: E402,F401
    CODEX_STREAM_FAILED,
    CODEX_STREAM_OK,
    CODEX_THREAD_ID,
    CODEX_USAGE,
    FLAT_USAGE,
    MODEL_USAGE,
    RESULT_BUDGET,
    RESULT_ERROR,
    RESULT_OK,
    STREAM_NOISE,
    emits,
    stream_body,
)

# The other ways of invoking the runner, kept beside this file.
from .run_spec.run_spec_invoking import (  # noqa: E402,F401
    BRANCH,
    CREATE_KEY,
    SCHEDULE_KEY,
    create,
    run_traced,
    schedule,
    wait_until,
    worktrees,
)
