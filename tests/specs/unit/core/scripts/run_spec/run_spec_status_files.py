"""The spec files these tests build to run against: a status file with
the lines a phase writes, an analysis, a solution, and the shapes a
reopened or reset spec leaves behind.

Split out of conftest.py 2026-09-04. Every builder is unchanged and
keeps its name.
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
# The stand-in AIs, kept beside this file — imported here so every part
# of the suite keeps one import surface.
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
from ..conftest import git, init_repo, run
from .run_spec_invoking import create, worktrees
from .run_spec_results import emits
def workflow_steps_line(repo, branch, folder, name="4-status.md"):
    """The `Workflow steps completed:` line as a fresh read of `repo`'s
    own copy of `branch` sees it — never the working tree, which the run's
    own worktree removal already tore down by the time a test looks."""
    text = git(repo, "show", f"{branch}:{folder}/{name}")
    lines = [l for l in text.splitlines() if "Workflow steps completed" in l]
    return lines[0] if lines else None


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


def write_raw_status(workspace, content):
    """A committed `4-status.md` with EXACTLY the text given — no
    `with_status()` shape assumed, since these tests exercise the header
    format and Phase-table row shapes the recompute has to agree with
    directly, in each test's own words."""
    (workspace["specs"] / workspace["folder"] / "4-status.md").write_text(content)
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "add status"], check=True)


STATUS_ROW_COUNTING = json.loads(
    (pathlib.Path(__file__).resolve().parents[5] / "fixtures" / "status-row-counting.json")
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
