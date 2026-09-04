"""The state a project has to be in before a run may start — the links a
worktree borrows, how the project lands its code, and the four ways a
project can be too broken to run — and the registry of every sentence
the bash runner may print.

Split out of conftest.py 2026-09-04; unchanged, and each keeps its name.
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
# The spec files the tests build, kept beside this one.
from .run_spec_status_files import (  # noqa: E402,F401
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
from .run_spec_fakes import (  # noqa: E402,F401
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
from ..conftest import git, run
PRECEDENCE = json.loads(
    (pathlib.Path(__file__).resolve().parents[5] / "fixtures" / "worktree-links-precedence.json")
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


READINESS_FIXTURE = json.loads(
    (pathlib.Path(__file__).resolve().parents[5] / "fixtures" / "project-readiness-prerequisites.json")
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


CODE_LANDING = json.loads(
    (pathlib.Path(__file__).resolve().parents[5] / "fixtures" / "code-landing-precedence.json")
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
