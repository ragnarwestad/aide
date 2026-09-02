"""Tests for core/scripts/aide-archive-spec — the mechanical steps of
/aide-archive (spec 251): folder resolution, the conflict check, the
status-table read, and the stamp-and-move.

No AI is involved anywhere in this file: the whole point of the script
is to answer "is this spec's work done, and is anything conflicted"
without spawning one.
"""
import json
import subprocess

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-archive-spec"


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True,
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
def project(tmp_path):
    return init_repo(tmp_path / "proj")


@pytest.fixture
def specs(tmp_path):
    return init_repo(tmp_path / "specs")


def configure(project, specs):
    (project / ".aide").mkdir(exist_ok=True)
    (project / ".aide" / "config").write_text(f"AIDE_SPECS_PATH={specs}\n")


def write_test_run(specs, folder, commit, exit_code, command="pytest"):
    """Writes test-run.json the way `aide-record-test-run` does, then
    commits it — by the time archive runs, an earlier `implement` step
    has already committed its own record, exactly like the other spec
    files `add_spec` commits above."""
    (specs / folder / "test-run.json").write_text(json.dumps({
        "command": command, "exitCode": exit_code, "commit": commit, "note": None,
    }))
    subprocess.run(["git", "-C", str(specs), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(specs), "commit", "-qm", "record test run"], check=True)


def add_spec(specs, folder, status_body=None, archived=False):
    parent = specs / "archive" if archived else specs
    parent.mkdir(exist_ok=True)
    (parent / folder).mkdir()
    (parent / folder / "1-description.md").write_text(f"# {folder} - Description\n")
    if status_body is not None:
        (parent / folder / "4-status.md").write_text(status_body)
    subprocess.run(["git", "-C", str(specs), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(specs), "commit", "-qm", f"add {folder}"], check=True)
    return parent / folder


def make_conflict(repo):
    """A real, open merge conflict — MERGE_HEAD set, markers in the file."""
    git(repo, "switch", "-q", "-c", "feature")
    (repo / "contested.txt").write_text("feature side\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "feature side")
    git(repo, "switch", "-q", "main")
    (repo / "contested.txt").write_text("main side\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "main side")
    subprocess.run(["git", "-C", str(repo), "merge", "-q", "--no-edit", "feature"], capture_output=True)


def phase(heading, rows):
    return "\n".join([
        f"## {heading}", "", "### Tasks", "", "| Task | Status | Notes |",
        "|------|--------|-------|", *rows, "", "---", "",
    ])


def checklist(rows):
    return "\n".join([
        "## Checklist", "", "| Task | Status | Notes |",
        "|------|--------|-------|", *rows, "", "---", "",
    ])


def acceptance(rows):
    return "\n".join([
        "## Acceptance criteria", "", "| Task | Status | Notes |",
        "|------|--------|-------|", *rows, "", "---", "",
    ])


def status_md(claims="", body=""):
    text = "# X - Status\n\n## Tracking info\n\n"
    if claims:
        text += f"- **Workflow steps completed:** {claims}\n"
    text += "\n---\n\n" + body
    return text


def run(script, project, spec, specs_dir=None, result_file=None):
    args = [str(script), "--project-dir", str(project), "--spec", spec]
    if specs_dir:
        args += ["--specs-dir", str(specs_dir)]
    if result_file:
        args += ["--result-file", str(result_file)]
    proc = subprocess.run(args, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


# --- refusal ------------------------------------------------------------


def test_refuses_without_project_dir(script):
    proc = subprocess.run([str(script), "--spec", "1"], capture_output=True, text=True)
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2
    assert out["terminalReason"] == "refused"


def test_refuses_without_spec(script, project):
    proc = subprocess.run(
        [str(script), "--project-dir", str(project)], capture_output=True, text=True
    )
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2
    assert out["terminalReason"] == "refused"


def test_unknown_spec_lists_the_active_folders(script, project, specs):
    configure(project, specs)
    add_spec(specs, "80-other")
    rc, out, _ = run(script, project, "999")
    assert rc == 2, out
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    assert "80-other" in out["error"], out


def test_refuses_when_there_is_no_specs_root_at_all(script, project):
    rc, out, _ = run(script, project, "1")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"


# --- already-archived (criterion 6, criterion 7) -------------------------


def test_already_archived_by_full_folder_name(script, project, specs):
    configure(project, specs)
    add_spec(specs, "77-recovered", archived=True)
    rc, out, _ = run(script, project, "77-recovered")
    assert rc == 0, out
    assert out["ok"] is True
    assert out["terminalReason"] == "already-archived"
    assert out["specFolder"] == "archive/77-recovered"
    assert "77-recovered" in out["note"], out


def test_already_archived_resolves_by_number_too(script, project, specs):
    configure(project, specs)
    add_spec(specs, "77-recovered", archived=True)
    rc, out, _ = run(script, project, "77")
    assert out["terminalReason"] == "already-archived"
    assert out["specFolder"] == "archive/77-recovered"


# --- conflict-open (criterion 5) -----------------------------------------


def test_conflict_open_in_the_project_dir(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x", status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"])))
    make_conflict(project)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "conflict-open"
    # No write happened: a conflict must be resolved before anything else.
    assert (specs / "81-x").exists()


def test_conflict_open_in_the_specs_dir_alone(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x", status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"])))
    make_conflict(specs)
    rc, out, _ = run(script, project, "81-x", specs_dir=specs)
    assert out["terminalReason"] == "conflict-open", out


def test_a_specs_conflict_is_not_seen_without_specs_dir(script, project, specs):
    """--specs-dir is opt-in: the caller names which extra directory to
    check, and a conflict there is invisible without it."""
    configure(project, specs)
    add_spec(specs, "81-x", status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"])))
    make_conflict(specs)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] != "conflict-open", out


# --- the status-table read: not-implemented-yet vs held-back vs archived --


def test_no_status_file_at_all_is_not_implemented_yet(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x")
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "not-implemented-yet", out
    assert (specs / "81-x").exists(), "nothing may be moved on this path"


def test_every_row_unstarted_with_no_implement_is_ordinary_progression(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze", phase("Phase 1: RED", ["| a | ⬜ | |", "| b | Not started | |"]))
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "not-implemented-yet", out


def test_ordinary_progression_removes_a_stale_held_back_section(script, project, specs):
    body = status_md("create, analyze", phase("Phase 1: RED", ["| a | ⬜ | |"])) + \
        "\n## Archive held back\n\n- an old reason — tick it on the spec's page\n\n---\n"
    configure(project, specs)
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "not-implemented-yet", out
    text = (specs / "81-x" / "4-status.md").read_text()
    assert "Archive held back" not in text, text


# --- an open row no longer blocks archive (spec 268) ----------------------
#
# Every one of the tests this comment replaces pinned the tick-based
# `held-back` refusal — an in-progress row, a genuinely blocking row over
# an earlier unstarted one, every other open notation symbol,
# `implement` present with an unstarted row (through both the `## Phase`
# and `## Checklist` headings), and the stale-section replace/no-
# duplicate behavior around it. Archive no longer reads the checklist to
# decide anything, so none of that machinery exists to pin any more —
# see AC3/AC4 below for what replaced it.


# --- archived (criterion 4) -----------------------------------------------


def test_every_row_done_archives_the_spec(script, project, specs):
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + phase("Phase 2: GREEN", ["| b | Completed | |"]),
    )
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "archived", out
    assert out["needsDocFeedback"] is True
    assert out["specFolder"] == "archive/81-x"
    assert not (specs / "81-x").exists()
    assert (specs / "archive" / "81-x").exists()
    text = (specs / "archive" / "81-x" / "4-status.md").read_text()
    assert "**Archived:**" in text, text


# --- the status-table read, through a ## Checklist heading (spec 262) ----


def test_checklist_every_row_done_archives_the_spec(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze, implement", checklist(["| a | ✅ | |", "| b | Completed | |"]))
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "archived", out
    assert not (specs / "81-x").exists()
    assert (specs / "archive" / "81-x").exists()


def test_checklist_all_unstarted_with_no_implement_is_ordinary_progression(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze", checklist(["| a | ⬜ | |", "| b | Not started | |"]))
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "not-implemented-yet", out


# --- AC3: archive proceeds once implement has run, whatever the ticks say -


def test_implement_present_with_every_row_unstarted_archives_the_spec(script, project, specs):
    """The exact scenario the description names for spec 265: implement
    landed and is on the record, but every task row still reads
    unstarted. Archive is no longer waiting on the checklist to say the
    work is done — only on whether implement ran."""
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ⬜ | |"]))
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "archived", out
    assert not (specs / "81-x").exists()
    assert (specs / "archive" / "81-x").exists()


def test_implement_present_with_an_open_in_progress_row_archives_the_spec(script, project, specs):
    """Not just unstarted rows — a row genuinely mid-flight (🔄) no
    longer blocks archive either, once implement is on the record."""
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | 🔄 | |"]))
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "archived", out
    assert not (specs / "81-x").exists()


def test_checklist_implement_present_with_an_unstarted_row_archives_the_spec(script, project, specs):
    """AC3 through the `## Checklist` heading a LOW-complexity spec uses
    instead of `## Phase*` (spec 266's second example)."""
    configure(project, specs)
    body = status_md("create, analyze, implement", checklist(["| a | ⬜ | |"]))
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "archived", out
    assert not (specs / "81-x").exists()


def test_archiving_removes_a_stale_held_back_section(script, project, specs):
    """A section written by the OLD gate, before this change landed, is
    cleared on the way through rather than left to rot on an otherwise
    finished spec."""
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ⬜ | |"])) + \
        "\n## Archive held back\n\n- a (Phase 1: RED) — tick it on the spec's page\n\n---\n"
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "archived", out
    text = (specs / "archive" / "81-x" / "4-status.md").read_text()
    assert "Archive held back" not in text, text


# --- AC4: archive still refuses a spec that was never implemented ---------


# --- the acceptance-criteria gate (spec 285) -------------------------------
#
# Scoped ONLY to a `## Acceptance criteria` section — never to the
# ordinary Phase/Checklist rows AC3 above already lets through
# regardless of their own tick state. These rows are for a person to
# judge, and archive refuses until every one of them is ticked.


def test_unticked_acceptance_criteria_row_blocks_archive(script, project, specs):
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + acceptance(["| REQ-1: does the thing | ⬜ | |"]),
    )
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "acceptance-criteria-unticked", out
    assert (specs / "81-x").exists(), "an unticked acceptance-criteria row must block the move"


def test_fully_ticked_acceptance_criteria_archives_normally(script, project, specs):
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + acceptance(["| REQ-1: does the thing | ✅ | |"]),
    )
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "archived", out
    assert not (specs / "81-x").exists()
    assert (specs / "archive" / "81-x").exists()


def test_non_standard_header_acceptance_row_ticked_still_archives(script, project, specs):
    """Spec 299/REQ-1: a header row named something other than `Task |
    Status | Notes` must never count toward the acceptance gate's total
    — only its position above the separator marks it as a header, not
    its own column text."""
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + "\n".join([
            "## Acceptance criteria", "", "| REQ | Criterion | Done |",
            "|------|--------|-------|", "| REQ-1: does the thing | ✅ | |", "", "---", "",
        ]),
    )
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "archived", out
    assert not (specs / "81-x").exists()


def test_no_acceptance_criteria_section_is_unaffected(script, project, specs):
    """REQ-4: a spec with no `## Acceptance criteria` section behaves
    exactly as it did before this spec — implement present is enough."""
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ⬜ | |"]))
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "archived", out


def test_unticked_acceptance_criteria_note_names_the_checks_tab(script, project, specs):
    """REQ-5: the tab that carries this checklist is called Checks
    (spec 294 renamed it from Overview) — the note must send the reader
    there, not to a name the tab no longer has."""
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + acceptance(["| REQ-1: does the thing | ⬜ | |"]),
    )
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert "Checks tab" in out["note"], out
    assert "Overview tab" not in out["note"], out


def test_acceptance_criteria_gate_keeps_refusing_on_every_run(script, project, specs):
    """REQ-6: a spec whose acceptance-criteria row is never ticked stays
    blocked indefinitely — the refusal is not a one-time hiccup, it
    repeats on every later archive run until a person ticks the row."""
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + acceptance(["| REQ-1: does the thing | ⬜ | |"]),
    )
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc1, out1, _ = run(script, project, "81-x")
    rc2, out2, _ = run(script, project, "81-x")
    assert out1["terminalReason"] == "acceptance-criteria-unticked", out1
    assert out2["terminalReason"] == "acceptance-criteria-unticked", out2
    assert (specs / "81-x").exists()


def test_unticked_acceptance_criteria_blocks_before_the_test_command_runs(script, project, specs, tmp_path):
    """Spec 346/REQ-1,2,5: the acceptance-criteria gate must answer before
    the test-record gate ever gets a chance to shell out to the project's
    test command. No test-run.json record exists here, so the pre-fix
    order would have run AIDE_TEST_CMD (dropping the marker file) before
    reaching the unticked row."""
    configure(project, specs)
    marker = tmp_path / "marker"
    (project / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={specs}\nAIDE_TEST_CMD=touch {marker}\n")
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + acceptance(["| REQ-1: does the thing | ⬜ | |"]),
    )
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "acceptance-criteria-unticked", out
    assert not marker.exists(), "the test command must never run before the acceptance gate answers"
    assert (specs / "81-x").exists()


def test_implement_absent_with_every_row_ticked_is_not_implemented_yet(script, project, specs):
    """The other half of AC4: even a checklist that reads fully done
    cannot stand in for the "Workflow steps completed" line actually
    naming implement — a hand-ticked box is not a run that happened."""
    configure(project, specs)
    body = status_md("create, analyze", phase("Phase 1: RED", ["| a | ✅ | |"]))
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "not-implemented-yet", out
    assert (specs / "81-x").exists(), "nothing may be moved on this path"


def test_specs_dir_is_read_from_not_just_conflict_checked(project, specs, script, tmp_path):
    """The bug behind specs 287, 288, 290 and 291 (2026-08-31): a
    headless run passes its own rebased per-run worktree as
    `--specs-dir`, but every status-file read fell back to the
    CONFIGURED `AIDE_SPECS_PATH` instead — the shared, un-rebased
    checkout, which still says "create, analyze" days after implement
    actually ran. Two DIFFERENT specs roots here, on purpose: the
    configured one is stale enough to refuse `not-implemented-yet` on
    its own, and the worktree one is fully done — the script must read
    the worktree, not the configured path, exactly as `--specs-dir` is
    named to promise."""
    configure(project, specs)
    stale = status_md("create, analyze", phase("Phase 1: RED", ["| a | ⬜ | |"]))
    add_spec(specs, "81-x", stale)

    worktree_specs = init_repo(tmp_path / "worktree-specs")
    done = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"]))
    add_spec(worktree_specs, "81-x", done)
    write_test_run(worktree_specs, "81-x", git(project, "rev-parse", "HEAD"), 0)

    rc, out, _ = run(script, project, "81-x", specs_dir=worktree_specs)
    assert out["terminalReason"] == "archived", out
    assert not (worktree_specs / "81-x").exists()
    assert (worktree_specs / "archive" / "81-x").exists()
    # The stale, configured copy is untouched — this run never read it.
    assert (specs / "81-x").exists()


def test_the_move_uses_git_mv_when_the_specs_root_is_tracked(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"]))
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    run(script, project, "81-x")
    # git mv STAGES the rename ("R"), rather than leaving it as an
    # untracked/deleted pair the way a plain `mv` in a tracked repo would.
    status = git(specs, "status", "--porcelain")
    assert status.startswith("R"), status
    assert "D " not in status and "??" not in status, status


def test_running_twice_after_archiving_is_idempotent(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"]))
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc1, out1, _ = run(script, project, "81-x")
    assert out1["terminalReason"] == "archived", out1

    rc2, out2, _ = run(script, project, "81-x")
    assert rc2 == 0, out2
    assert out2["terminalReason"] == "already-archived", out2
    assert out2["specFolder"] == "archive/81-x"

    text = (specs / "archive" / "81-x" / "4-status.md").read_text()
    assert text.count("**Archived:**") == 1, text


def test_the_result_file_carries_the_same_json_as_stdout(script, project, specs, tmp_path):
    configure(project, specs)
    add_spec(specs, "81-x")
    result_file = tmp_path / "result.json"
    rc, out, _ = run(script, project, "81-x", result_file=result_file)
    assert json.loads(result_file.read_text()) == out


# --- the test-record gate (spec 329) --------------------------------------
#
# REQ-4: archive refuses without a passing test-run.json record for the
# exact commit being merged — or, only when that commit is a genuine
# two-parent base-catch-up merge, its first parent. A record for any
# OTHER earlier commit (real, untested work added afterward) must still
# refuse — the must-fix regression case from the plan review.


DONE_BODY = phase("Phase 1: RED", ["| a | ✅ | |"])


def test_no_test_run_record_at_all_blocks_archive(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x", status_md("create, analyze, implement", DONE_BODY))
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "no-passing-test-record", out
    assert (specs / "81-x").exists(), "no record means archive must not move the folder"


def test_no_record_and_no_test_command_says_so(script, project, specs):
    """A project with no test command cannot have a record made for it,
    and is told that rather than being sent to re-run implement."""
    configure(project, specs)
    add_spec(specs, "81-x", status_md("create, analyze, implement", DONE_BODY))
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "no-passing-test-record", out
    assert "no test command" in out["note"], out
    assert (specs / "81-x").exists()


def test_no_record_runs_the_tests_and_archives_when_they_pass(script, project, specs):
    """The gate makes the record it is missing. `implement` writes it
    normally, but an implement step locks once it is done — so a spec
    whose implement predates the gate could never satisfy it. Archive
    runs the command itself rather than refusing for the lack of a file
    nobody is able to produce any more."""
    configure(project, specs)
    (project / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={specs}\nAIDE_TEST_CMD=true\n")
    add_spec(specs, "81-x", status_md("create, analyze, implement", DONE_BODY))
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "archived", out
    assert not (specs / "81-x").exists()
    record = json.loads((specs / "archive" / "81-x" / "test-run.json").read_text())
    assert record["exitCode"] == 0
    assert record["commit"] == git(project, "rev-parse", "HEAD")


def test_no_record_refuses_when_the_tests_it_runs_fail(script, project, specs):
    """Still a gate: it refuses when the tests actually fail, which is
    the only thing it was ever meant to stop."""
    configure(project, specs)
    (project / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={specs}\nAIDE_TEST_CMD=false\n")
    add_spec(specs, "81-x", status_md("create, analyze, implement", DONE_BODY))
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "no-passing-test-record", out
    assert (specs / "81-x").exists()


def test_a_failing_gate_run_keeps_its_output_and_names_the_log(script, project, specs, tmp_path, monkeypatch):
    """The first real refusal (spec 337, exit 2) had sent the test output
    to /dev/null: nobody could say what had failed. The gate keeps the
    run's output in a log and the refusal names it."""
    log = tmp_path / "test-gate.log"
    monkeypatch.setenv("AIDE_TEST_GATE_LOG", str(log))
    configure(project, specs)
    (project / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={specs}\nAIDE_TEST_CMD=echo THE-FAILING-TEST; false\n")
    add_spec(specs, "81-x", status_md("create, analyze, implement", DONE_BODY))
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "no-passing-test-record", out
    assert str(log) in out["note"], out
    assert "THE-FAILING-TEST" in log.read_text()
    assert "81-x @" in log.read_text()


def test_a_passing_record_at_exact_head_archives(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x", status_md("create, analyze, implement", DONE_BODY))
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "archived", out
    assert not (specs / "81-x").exists()


def test_a_record_with_nonzero_exit_code_blocks_archive(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x", status_md("create, analyze, implement", DONE_BODY))
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 1)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "no-passing-test-record", out
    assert (specs / "81-x").exists()


def test_a_passing_record_at_head_first_parent_of_a_genuine_merge_archives(script, project, specs):
    """The ordinary case on any active project: update_branch_to_base
    merges the base into the spec branch, so HEAD at archive time is a
    real two-parent merge commit whose first parent is the spec branch's
    own last (tested) commit."""
    configure(project, specs)
    tested = git(project, "rev-parse", "HEAD")
    git(project, "switch", "-q", "-c", "feature")
    (project / "feature.txt").write_text("feature work\n")
    git(project, "add", "-A")
    git(project, "commit", "-qm", "feature work")
    tested = git(project, "rev-parse", "HEAD")

    git(project, "switch", "-q", "main")
    (project / "base.txt").write_text("base moved on\n")
    git(project, "add", "-A")
    git(project, "commit", "-qm", "base moved on")

    git(project, "switch", "-q", "feature")
    git(project, "merge", "-q", "--no-edit", "main")

    add_spec(specs, "81-x", status_md("create, analyze, implement", DONE_BODY))
    write_test_run(specs, "81-x", tested, 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "archived", out
    assert not (specs / "81-x").exists()


def test_a_record_at_head_first_parent_of_an_ordinary_single_parent_commit_blocks_archive(
    script, project, specs,
):
    """The must-fix regression the plan review found: an ordinary
    single-parent commit added to the branch AFTER the recorded one —
    real, untested work — must not slip through just because its own
    parent happens to be the recorded commit."""
    configure(project, specs)
    tested = git(project, "rev-parse", "HEAD")
    (project / "untested.txt").write_text("untested work\n")
    git(project, "add", "-A")
    git(project, "commit", "-qm", "untested work")

    add_spec(specs, "81-x", status_md("create, analyze, implement", DONE_BODY))
    write_test_run(specs, "81-x", tested, 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "no-passing-test-record", out
    assert (specs / "81-x").exists()


def test_the_gate_never_runs_the_recorded_command_itself(script, project, specs, tmp_path):
    """REQ-5: archive only ever READS test-run.json. A fixture whose
    'command' would drop a marker file if ever executed proves the gate
    never shells out to it."""
    configure(project, specs)
    marker = tmp_path / "marker"
    add_spec(specs, "81-x", status_md("create, analyze, implement", DONE_BODY))
    write_test_run(
        specs, "81-x", git(project, "rev-parse", "HEAD"), 0,
        command=f"touch {marker}",
    )
    run(script, project, "81-x")
    assert not marker.exists(), "aide-archive-spec must never execute the recorded command"
