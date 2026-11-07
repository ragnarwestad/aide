"""Tests for core/scripts/aide-record-step — what an interactive
/aide-analyze or /aide-implement runs when it has completed, to record the
step the way aide-run-spec records a headless one.

The command runs for real against a temp git specs repo. AIDE_NOW_EPOCH
hands it the clock, so a Time spent is exact.
"""
import json
import os
import subprocess

import pytest

FOLDER = "42-example"
CREATE_SUBJECT = f"Run /aide-create for {FOLDER} (model: claude claude-opus-5)"
NOW = 1_800_000_000

DESCRIPTION = (
    "# Example - Description\n\n## Tracking info\n\n"
    f"- **Task:** `{FOLDER}/`\n- **Created:** `2026-11-07`\n{{acceptance}}\n---\n\n"
    "## Description\n\n- **AC-1:** WHEN x, y.\n- **AC-2:** WHEN z, w.\n"
)
ANALYSIS = f"# Example - Analysis\n\n## Tracking info\n\n- **Task:** `{FOLDER}/`\n- **Last analyzed:** `2026-11-07`\n"
SOLUTION = f"# Example - Solution\n\n## Tracking info\n\n- **Task:** `{FOLDER}/`\n- **Grade:** LOW\n"
STATUS = (
    "# Example - Status\n\n## Tracking info\n\n"
    f"- **Task:** `{FOLDER}/`\n{{steps}}- **Last updated:** `2026-11-07`\n\n"
    "## Phase 1: RED\n\n| Task | Status | Notes |\n|------|--------|-------|\n| a | ⬜ | |\n\n"
    "## Acceptance criteria\n\n| Task | Status | Notes |\n|------|--------|-------|\n"
    "{rows}\n"
)
OPEN_ROWS = "| AC-1: WHEN x, y. | ⬜ | |\n| AC-2: WHEN z, w. | ⬜ | |"
TICKED_ROWS = "| AC-1: WHEN x, y. | ✅ | |"


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout


def commit_all(repo, subject):
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", subject)


def make_git_repo(path):
    path.mkdir()
    git(path, "init", "-q", "-b", "main")
    git(path, "config", "user.name", "Test")
    git(path, "config", "user.email", "t@example.com")
    return path


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-record-step"


@pytest.fixture
def specs(tmp_path):
    return make_git_repo(tmp_path / "specs")


def make_spec(specs, steps="", rows=OPEN_ROWS, acceptance="", subject=CREATE_SUBJECT):
    """A spec folder carrying the templates' Tracking info, committed as an
    interactive create."""
    folder = specs / FOLDER
    folder.mkdir()
    (folder / "1-description.md").write_text(DESCRIPTION.format(acceptance=acceptance))
    (folder / "2-analysis.md").write_text(ANALYSIS)
    (folder / "3-solution.md").write_text(SOLUTION)
    (folder / "4-status.md").write_text(STATUS.format(steps=steps, rows=rows))
    commit_all(specs, subject)
    return folder


def run_record(script, specs, step="analyze", folder=FOLDER, start=NOW - 125, model=None,
               now=NOW, headless=False):
    args = [str(script), "--specs-root", str(specs), "--folder", folder, "--step", step]
    if start is not None:
        args += ["--start-epoch", str(start)]
    if model is not None:
        args += ["--model", model]
    env = {**os.environ, "AIDE_NOW_EPOCH": str(now)}
    env.pop("AIDE_HEADLESS", None)
    if headless:
        env["AIDE_HEADLESS"] = "1"
    proc = subprocess.run(args, capture_output=True, text=True, env=env)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line)


def steps_line(folder):
    for line in (folder / "4-status.md").read_text().splitlines():
        if line.startswith("- **Workflow steps completed:**"):
            return line.split(":**", 1)[1].strip()
    return None


def state(folder):
    return json.loads((folder / "4-status.json").read_text())


def snapshot(specs):
    return {
        str(p.relative_to(specs)): p.read_bytes()
        for p in sorted(specs.rglob("*")) if p.is_file() and ".git" not in p.parts
    }


def tracking_lines(path):
    lines = path.read_text().splitlines()
    start = lines.index("## Tracking info") + 1
    end = next((i for i in range(start, len(lines)) if lines[i].startswith("## ") or lines[i] == "---"), len(lines))
    return lines[start:end]


# --- the line and the state file ---------------------------------------


def test_analyze_adds_itself_to_the_line_and_the_state_file_and_leaves_the_commit_to_the_session_ac_1(script, specs):
    folder = make_spec(specs)
    head = git(specs, "rev-parse", "HEAD")
    rc, out = run_record(script, specs, "analyze")
    assert rc == 0, out
    assert out["terminalReason"] == "recorded"
    assert steps_line(folder) == "create, analyze"
    assert state(folder)["completedPhases"] == ["create", "analyze"]
    assert git(specs, "rev-parse", "HEAD") == head
    assert f"{FOLDER}/4-status.md" in git(specs, "diff", "--name-only")
    assert set(out["files"]) >= {f"{FOLDER}/4-status.md", f"{FOLDER}/4-status.json", f"{FOLDER}/2-analysis.md"}


def test_implement_after_a_committed_analyze_names_all_three_steps_ac_1(script, specs):
    folder = make_spec(specs)
    assert run_record(script, specs, "analyze")[0] == 0
    commit_all(specs, f"Run /aide-analyze for {FOLDER} (model: claude claude-opus-5)")
    rc, out = run_record(script, specs, "implement")
    assert rc == 0, out
    assert steps_line(folder) == "create, analyze, implement"
    assert state(folder)["completedPhases"] == ["create", "analyze", "implement"]
    assert f"{FOLDER}/3-solution.md" in out["files"]


def test_a_new_analysis_takes_the_implement_before_it_off_the_line_ac_1(script, specs):
    folder = make_spec(specs, steps="- **Workflow steps completed:** create, analyze, implement\n")
    rc, out = run_record(script, specs, "analyze")
    assert rc == 0, out
    assert steps_line(folder) == "create, analyze"
    assert state(folder)["completedPhases"] == ["create", "analyze"]


def test_the_line_is_read_as_committed_so_a_session_cannot_credit_itself_with_a_later_step_ac_1(script, specs):
    folder = make_spec(specs, steps="- **Workflow steps completed:** create\n")
    status = folder / "4-status.md"
    status.write_text(status.read_text().replace("create\n", "create, analyze, implement\n", 1))
    rc, out = run_record(script, specs, "analyze")
    assert rc == 0, out
    assert steps_line(folder) == "create, analyze"


# --- the acceptance rows after an analysis -----------------------------


def test_analyze_marks_every_acceptance_row_not_verified_when_ticking_is_not_required_ac_5(script, specs):
    folder = make_spec(specs, acceptance="- **Acceptance:** not required\n")
    rc, out = run_record(script, specs, "analyze")
    assert rc == 0, out
    rows = [l for l in (folder / "4-status.md").read_text().splitlines() if l.startswith("| AC-")]
    assert len(rows) == 2
    assert all("Not verified" in r for r in rows)


# --- the stamp in the phase's own file ---------------------------------


@pytest.mark.parametrize("step,phase_file", [("analyze", "2-analysis.md"), ("implement", "3-solution.md")])
def test_the_phase_file_gets_model_and_time_spent_once_each_ac_3(script, specs, step, phase_file):
    folder = make_spec(specs, steps="- **Workflow steps completed:** create, analyze\n")
    rc, out = run_record(script, specs, step, model="claude claude-opus-5")
    assert rc == 0, out
    tracking = tracking_lines(folder / phase_file)
    assert tracking.count("- **Model:** claude claude-opus-5") == 1
    assert tracking.count("- **Time spent:** 2m05s") == 1


def test_no_model_writes_time_spent_only_ac_3(script, specs):
    folder = make_spec(specs)
    rc, out = run_record(script, specs, "analyze")
    assert rc == 0, out
    text = (folder / "2-analysis.md").read_text()
    assert text.count("- **Time spent:** 2m05s") == 1
    assert "- **Model:**" not in text


def test_a_second_record_replaces_the_per_run_fields_and_keeps_the_totals_ac_3(script, specs):
    folder = make_spec(specs)
    assert run_record(script, specs, "analyze", model="claude old-model")[0] == 0
    analysis = folder / "2-analysis.md"
    analysis.write_text(analysis.read_text().replace(
        "## Tracking info\n\n", "## Tracking info\n\n- **Result:** stopped (timeout)\n- **Attempts:** 2\n", 1))
    rc, out = run_record(script, specs, "analyze", start=NOW - 60, model="claude new-model")
    assert rc == 0, out
    tracking = tracking_lines(analysis)
    assert tracking.count("- **Model:** claude new-model") == 1
    assert tracking.count("- **Time spent:** 1m00s") == 1
    assert not [l for l in tracking if l.startswith("- **Model:** claude old-model")]
    assert not [l for l in tracking if l.startswith("- **Result:**")]
    assert "- **Attempts:** 2" in tracking


# --- a refused call writes nothing -------------------------------------


def archived_spec(specs):
    folder = make_spec(specs, steps="- **Workflow steps completed:** create, analyze, implement\n")
    (specs / "archive").mkdir()
    git(specs, "mv", FOLDER, f"archive/{FOLDER}")
    status = specs / "archive" / FOLDER / "4-status.md"
    status.write_text(status.read_text() + "\n**Archived:** 2026-11-07\n")
    return folder


REFUSED_CALLS = {
    "a step that is not analyze or implement": (dict(step="archive"), "analyze or implement"),
    "no start epoch": (dict(start=None), "--start-epoch"),
    "a start epoch in the future": (dict(start=NOW + 100), "future"),
    "an unknown folder": (dict(folder="99-nothing"), "not found"),
    "implement on a spec not yet analyzed": (dict(step="implement"), "not been analyzed"),
}


@pytest.mark.parametrize("call,reason", REFUSED_CALLS.values(), ids=REFUSED_CALLS.keys())
def test_a_refused_call_leaves_every_file_as_it_was_ac_4(script, specs, call, reason):
    make_spec(specs)
    before = snapshot(specs)
    rc, out = run_record(script, specs, **call)
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert reason in out["error"]
    assert snapshot(specs) == before


def test_a_spec_under_archive_is_refused_and_left_as_it_was_ac_4(script, specs):
    archived_spec(specs)
    before = snapshot(specs)
    rc, out = run_record(script, specs, "analyze")
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "archived" in out["error"]
    assert snapshot(specs) == before


def test_a_headless_run_is_refused_and_every_file_is_as_it_was_ac_6(script, specs):
    make_spec(specs)
    before = snapshot(specs)
    rc, out = run_record(script, specs, "analyze", headless=True)
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "headless" in out["error"]
    assert snapshot(specs) == before


# --- the archive gate reads what the command wrote ---------------------


def make_project(tmp_path, specs):
    project = make_git_repo(tmp_path / "proj")
    (project / ".aide").mkdir()
    (project / ".aide" / "config").write_text(f"AIDE_SPECS_PATH={specs}\n")
    (project / ".aide" / "project.yaml").write_text("AIDE_TEST_CMD: true\n")
    # -f: the user's global gitignore covers .aide/config.
    git(project, "add", "-f", ".aide/config", ".aide/project.yaml")
    git(project, "commit", "-qm", "init")
    return project


def archive(workspace_root, project):
    proc = subprocess.run(
        [str(workspace_root / "core" / "scripts" / "aide-archive-spec"),
         "--project-dir", str(project), "--spec", FOLDER],
        capture_output=True, text=True,
    )
    return json.loads(proc.stdout.strip().splitlines()[-1])


def record_and_commit(script, specs, step):
    rc, out = run_record(script, specs, step)
    assert rc == 0, out
    commit_all(specs, f"Run /aide-{step} for {FOLDER} (model: claude claude-opus-5)")


def test_a_spec_whose_steps_were_recorded_in_sessions_is_archived_ac_5(script, specs, tmp_path, workspace_root):
    make_spec(specs, rows=TICKED_ROWS)
    project = make_project(tmp_path, specs)
    record_and_commit(script, specs, "analyze")
    record_and_commit(script, specs, "implement")
    assert archive(workspace_root, project)["terminalReason"] == "archived"


def test_a_spec_that_needs_no_ticking_is_archived_after_both_steps_were_recorded_ac_5(script, specs, tmp_path, workspace_root):
    folder = make_spec(specs, acceptance="- **Acceptance:** not required\n")
    project = make_project(tmp_path, specs)
    record_and_commit(script, specs, "analyze")
    record_and_commit(script, specs, "implement")
    rows = [l for l in (folder / "4-status.md").read_text().splitlines() if l.startswith("| AC-")]
    assert rows and all("Not verified" in r for r in rows)
    assert archive(workspace_root, project)["terminalReason"] == "archived"


def test_a_spec_with_only_the_analysis_recorded_is_not_archived_ac_5(script, specs, tmp_path, workspace_root):
    make_spec(specs, acceptance="- **Acceptance:** not required\n")
    project = make_project(tmp_path, specs)
    record_and_commit(script, specs, "analyze")
    assert archive(workspace_root, project)["terminalReason"] == "not-implemented-yet"
