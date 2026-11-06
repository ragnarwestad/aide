"""The state a project has to be in before a run may start — the links a
worktree borrows, how the project lands its code, and the four ways a
project can be too broken to run — and the registry of every sentence
the bash runner may print.

Split out of conftest.py 2026-09-04; unchanged, and each keeps its name.
"""

import json
import pathlib
import shutil
import subprocess
import time
# The spec files the tests build, kept beside this one.
# The stand-in AIs, kept beside this file — imported here so every part of
# the suite keeps one import surface.
from ..conftest import git
PRECEDENCE = json.loads(
    (pathlib.Path(__file__).resolve().parents[5] / "fixtures" / "worktree-links-precedence.json")
    .read_text()
)["cases"]


def configure_links(workspace, manifest):
    """Write a precedence case's two files, and make sure every path
    the manifest names is actually there — a link with no source is a
    refusal of its own, and it is not what these tests are
    about."""
    project = workspace["project"]
    for entry in (manifest or "").split():
        (project / entry).mkdir(parents=True, exist_ok=True)
        (project / entry / "marker.txt").write_text("a dependency tree\n")
    (project / ".gitignore").write_text("/deps/\n")
    (project / ".aide" / "config").write_text(f"AIDE_SPECS_PATH={workspace['specs']}\n")
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
# on-disk git state, so it is named in the fixture (and
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
    # worktreeLinks is read from the manifest alone — a value
    # hand-written into `.aide/config` would never be read at all.
    (workspace["project"] / ".aide" / "project.yaml").write_text(
        "AIDE_TEST_CMD: true\nworktreeLinks: nowhere\n"
    )
    git(workspace["project"], "add", "-f", ".aide/project.yaml")
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


CRITERIA_CHECKS = json.loads(
    (pathlib.Path(__file__).resolve().parents[5] / "fixtures" / "criteria-checks-level.json")
    .read_text()
)["cases"]


def configure_criteria_checks(workspace, level):
    """Write a case's level into the spec's own `1-description.md`, as the
    `Acceptance criteria checks` line in its Tracking info, and commit it;
    `None` writes no line at all."""
    path = workspace["specs"] / workspace["folder"] / "1-description.md"
    kept = [l for l in path.read_text().splitlines() if not l.startswith("- **Acceptance criteria checks:**")]
    if level is not None:
        kept.append(f"- **Acceptance criteria checks:** {level}")
    path.write_text("\n".join(kept) + "\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "record the acceptance criteria checks level", "--allow-empty")


ANALYSIS_LINE = json.loads(
    (pathlib.Path(__file__).resolve().parents[5] / "fixtures" / "analysis-line.json")
    .read_text()
)["cases"]


CHOOSE_APPROACH = json.loads(
    (pathlib.Path(__file__).resolve().parents[5] / "fixtures" / "choose-approach-line.json")
    .read_text()
)["cases"]


def configure_choose_approach(workspace, value):
    """Write a case's value into the spec's own `1-description.md`, as the
    `Let me choose the approach` line in its Tracking info, and commit it;
    `None` writes no line at all."""
    path = workspace["specs"] / workspace["folder"] / "1-description.md"
    kept = [l for l in path.read_text().splitlines() if not l.startswith("- **Let me choose the approach:**")]
    if value is not None:
        kept.append(f"- **Let me choose the approach:** {value}")
    path.write_text("\n".join(kept) + "\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "record whether to choose the approach", "--allow-empty")


SENT_BACK = json.loads(
    (pathlib.Path(__file__).resolve().parents[5] / "fixtures" / "sent-back-line.json")
    .read_text()
)["cases"]


def description_with(sent_back_line, where="tracking-info"):
    """The text of a `1-description.md` whose Tracking info (or, for
    `where="description"`, whose body) carries `sent_back_line`; `None`
    writes no such line."""
    in_tracking = sent_back_line if sent_back_line and where == "tracking-info" else None
    in_body = sent_back_line if sent_back_line and where == "description" else None
    lines = ["# Queue - Description", "", "## Tracking info", "", "- **Task:** `81-queue-and-runner/`"]
    lines += [in_tracking] if in_tracking else []
    lines += ["", "## Description", ""] + ([in_body] if in_body else [])
    return "\n".join(lines) + "\n"


def configure_sent_back(workspace, case):
    """Write a case of sent-back-line.json into the spec's own
    `1-description.md` and commit it."""
    path = workspace["specs"] / workspace["folder"] / "1-description.md"
    path.write_text(description_with(case["line"], case["where"]))
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "record whether the spec was sent back", "--allow-empty")
