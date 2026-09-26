"""Tests for `may_apply_spec_transition`/`apply_spec_transition`
(core/scripts/lib/spec-transitions.sh), spec 356's one table and one
function pair for moving a spec between phases: created, analyzed,
implemented, archived.
"""
import json
import subprocess
from pathlib import Path

import pytest

LIB = Path(__file__).resolve().parents[5] / "core" / "scripts" / "lib" / "spec-transitions.sh"


def _run(script):
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True)


def _status_file(tmp_path, folder, workflow_line=None, archived=None):
    d = tmp_path / folder
    d.mkdir(exist_ok=True)
    lines = ["# X - Status", "", "## Tracking info", ""]
    if workflow_line is not None:
        lines.append(f"- **Workflow steps completed:** {workflow_line}")
    if archived is not None:
        lines.append(f"- **Archived:** {archived}")
    status_file = d / "4-status.md"
    status_file.write_text("\n".join(lines) + "\n")
    return status_file


def may_apply(status_file, event):
    script = (
        f'source "{LIB}"\n'
        f'may_apply_spec_transition "{status_file}" "{event}"\n'
        'echo "RC=$?"\n'
        'echo "REASON=$transition_refusal"\n'
        'echo "MESSAGE=$transition_message"\n'
    )
    proc = _run(script)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    out = {}
    for line in proc.stdout.splitlines():
        if "=" in line:
            k, _, v = line.partition("=")
            out[k] = v
    return out


def apply(status_file, event, value=""):
    """`apply_spec_transition` — the single-path convenience wrapper,
    used for reopen/reset only (see the function's own doc comment)."""
    script = (
        f'source "{LIB}"\n'
        f'apply_spec_transition "{status_file}" "{event}" "{value}"\n'
        'echo "RC=$?"\n'
    )
    proc = _run(script)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return proc


def write_stamp_and_mirror(status_file, kind, value=""):
    """The two-call shape aide-run-spec's phase-append and
    aide-archive-spec's stamp-and-move actually use: write_phase_stamp
    at one path, write_spec_state at (possibly) another."""
    script = (
        f'source "{LIB}"\n'
        f'write_phase_stamp "{status_file}" "{kind}" "{value}"\n'
        f'write_spec_state "{status_file}"\n'
        'echo "RC=$?"\n'
    )
    proc = _run(script)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return proc


# --- REQ-1, REQ-3: forward moves and their refusals ------------------------


def test_analyze_is_legal_from_created(tmp_path):
    status_file = _status_file(tmp_path, "1-x")
    result = may_apply(status_file, "analyze")
    assert result["RC"] == "0"


def test_analyze_is_legal_again_from_analyzed_same_phase_rerun(tmp_path):
    status_file = _status_file(tmp_path, "1-x", workflow_line="create, analyze")
    result = may_apply(status_file, "analyze")
    assert result["RC"] == "0"


def test_implement_refused_before_analyze_with_the_gates_own_words(tmp_path):
    status_file = _status_file(tmp_path, "1-x")
    result = may_apply(status_file, "implement")
    assert result["RC"] == "1"
    assert result["REASON"] == "not-analyzed-yet"
    assert "1-x has not been analyzed yet" in result["MESSAGE"]


def test_implement_is_legal_from_analyzed(tmp_path):
    status_file = _status_file(tmp_path, "1-x", workflow_line="create, analyze")
    result = may_apply(status_file, "implement")
    assert result["RC"] == "0"


def test_archive_refused_before_implement(tmp_path):
    status_file = _status_file(tmp_path, "1-x", workflow_line="create, analyze")
    result = may_apply(status_file, "archive")
    assert result["RC"] == "1"
    assert result["REASON"] == "not-implemented-yet"
    assert "run /aide-implement next" in result["MESSAGE"]


def test_archive_is_legal_from_implemented(tmp_path):
    status_file = _status_file(tmp_path, "1-x", workflow_line="create, analyze, implement")
    result = may_apply(status_file, "archive")
    assert result["RC"] == "0"


# --- REQ-9: backward moves are refused, naming the way back ----------------


def test_analyze_refused_once_implemented_names_another_round(tmp_path):
    status_file = _status_file(tmp_path, "7-x", workflow_line="create, analyze, implement")
    result = may_apply(status_file, "analyze")
    assert result["RC"] == "1"
    assert result["REASON"] == "already-implemented"
    # The way back is another round, since the reset step was removed.
    assert "another round" in result["MESSAGE"]
    assert "aide-reset" not in result["MESSAGE"]


def test_create_refused_once_analyzed_says_so_without_naming_a_way_back(tmp_path):
    status_file = _status_file(tmp_path, "7-x", workflow_line="create, analyze")
    result = may_apply(status_file, "create")
    assert result["RC"] == "1"
    assert result["REASON"] == "already-analyzed"
    assert "cannot run again" in result["MESSAGE"]
    assert "aide-reset" not in result["MESSAGE"]


def test_analyze_refused_on_an_archived_spec_names_reopen(tmp_path):
    status_file = _status_file(tmp_path, "7-x", workflow_line="create, analyze, implement", archived="2026-09-01")
    result = may_apply(status_file, "analyze")
    assert result["RC"] == "1"
    assert result["REASON"] == "already-archived"
    assert "only reopen" in result["MESSAGE"]


# --- reopen ---------------------------------------------------------------


def test_reopen_is_legal_only_from_archived(tmp_path):
    active = _status_file(tmp_path, "1-x", workflow_line="create, analyze")
    result = may_apply(active, "reopen")
    assert result["RC"] == "1"
    assert result["REASON"] == "already-active"
    assert "nothing to reopen" in result["MESSAGE"]

    archived = _status_file(tmp_path, "2-x", workflow_line="create, analyze, implement", archived="2026-09-01")
    result = may_apply(archived, "reopen")
    assert result["RC"] == "0"


# --- close: legal from any pre-archive phase, unlike archive (REQ-1, REQ-13) --


def test_close_is_legal_from_created_with_no_step_completed(tmp_path):
    status_file = _status_file(tmp_path, "1-x")
    result = may_apply(status_file, "close")
    assert result["RC"] == "0"


def test_close_is_legal_from_analyzed(tmp_path):
    status_file = _status_file(tmp_path, "1-x", workflow_line="create, analyze")
    result = may_apply(status_file, "close")
    assert result["RC"] == "0"


def test_close_is_legal_from_implemented(tmp_path):
    status_file = _status_file(tmp_path, "1-x", workflow_line="create, analyze, implement")
    result = may_apply(status_file, "close")
    assert result["RC"] == "0"


def test_close_refused_on_an_archived_spec_names_reopen(tmp_path):
    status_file = _status_file(tmp_path, "7-x", workflow_line="create, analyze, implement", archived="2026-09-01")
    result = may_apply(status_file, "close")
    assert result["RC"] == "1"
    assert result["REASON"] == "already-archived"
    assert "only reopen" in result["MESSAGE"]


def _closed_status_file(tmp_path, folder, workflow_line=None):
    d = tmp_path / folder
    d.mkdir(exist_ok=True)
    lines = ["# X - Status", "", "## Tracking info", ""]
    if workflow_line is not None:
        lines.append(f"- **Workflow steps completed:** {workflow_line}")
    lines.append("")
    lines.append("**Closed:** 2026-09-05 — this idea does not hold")
    status_file = d / "4-status.md"
    status_file.write_text("\n".join(lines) + "\n")
    return status_file


def test_closed_spec_refuses_every_event_but_reopen(tmp_path):
    status_file = _closed_status_file(tmp_path, "1-x", workflow_line="create")
    for event in ("create", "analyze", "implement", "archive", "close"):
        result = may_apply(status_file, event)
        assert result["RC"] == "1", f"{event} should be refused on a closed spec"
        assert result["REASON"] == "already-closed"
        assert "only reopen" in result["MESSAGE"]


def test_reopen_is_legal_from_closed(tmp_path):
    status_file = _closed_status_file(tmp_path, "1-x", workflow_line="create")
    result = may_apply(status_file, "reopen")
    assert result["RC"] == "0"


def test_write_phase_stamp_writes_the_closed_stamp_with_its_reason(tmp_path):
    status_file = _status_file(tmp_path, "1-x")
    write_stamp_and_mirror(status_file, "closed", "this idea does not hold")
    text = status_file.read_text()
    assert "**Closed:**" in text
    assert "this idea does not hold" in text
    state = json.loads((status_file.parent / "4-status.json").read_text())
    assert state["closed"]["reason"] == "this idea does not hold"
    assert state["closed"]["date"]


# --- may_apply never writes (REQ-3) -----------------------------------------


def test_may_apply_leaves_the_file_byte_for_byte_unchanged_on_refusal(tmp_path):
    status_file = _status_file(tmp_path, "1-x")
    before = status_file.read_bytes()
    may_apply(status_file, "implement")
    assert status_file.read_bytes() == before
    assert not (status_file.parent / "4-status.json").exists()


# --- apply_spec_transition writes the stamp and mirrors it -----------------


def test_write_phase_stamp_writes_the_workflow_steps_line_and_mirrors_json(tmp_path):
    status_file = _status_file(tmp_path, "1-x", workflow_line="create")
    write_stamp_and_mirror(status_file, "workflow-line", "create, analyze")
    text = status_file.read_text()
    assert "- **Workflow steps completed:** create, analyze" in text
    state = json.loads((status_file.parent / "4-status.json").read_text())
    assert state["completedPhases"] == ["create", "analyze"]


def test_write_phase_stamp_writes_the_archived_stamp(tmp_path):
    status_file = _status_file(tmp_path, "1-x", workflow_line="create, analyze, implement")
    write_stamp_and_mirror(status_file, "archived")
    text = status_file.read_text()
    assert "**Archived:**" in text
    state = json.loads((status_file.parent / "4-status.json").read_text())
    assert state["archived"]["date"]


def test_apply_writes_the_reopened_stamp_with_its_boundary_sha(tmp_path):
    status_file = _status_file(tmp_path, "1-x", workflow_line="create, analyze, implement", archived="2026-08-01")
    apply(status_file, "reopen", "abc1234")
    text = status_file.read_text()
    assert "- **Reopened:**" in text
    assert "history before `abc1234` does not count" in text
    state = json.loads((status_file.parent / "4-status.json").read_text())
    assert state["reopened"]["boundaryCommit"] == "abc1234"
    # A reopen starts the new round with nothing completed yet.
    assert state["completedPhases"] == []


def test_apply_writes_the_reset_stamp_with_its_boundary_sha(tmp_path):
    status_file = _status_file(tmp_path, "1-x", workflow_line="create, analyze")
    apply(status_file, "reset", "def5678")
    text = status_file.read_text()
    assert "- **Reset:**" in text
    assert "history before `def5678` does not count" in text
    state = json.loads((status_file.parent / "4-status.json").read_text())
    assert state["completedPhases"] == []


# --- spec 511: a stamp with a later boundary after it is history -----------


def _status_with(tmp_path, folder, lines, workflow_line="create, analyze, implement"):
    d = tmp_path / folder
    d.mkdir(exist_ok=True)
    body = ["# X - Status", "", "## Tracking info", ""]
    if workflow_line is not None:
        body.append(f"- **Workflow steps completed:** {workflow_line}")
    body.extend(lines)
    status_file = d / "4-status.md"
    status_file.write_text("\n".join(body) + "\n")
    return status_file


def _phase(status_file):
    script = (
        f'source "{LIB}"\n'
        f'_peek_spec_state "{status_file}"\n'
        'current_phase_from "$state_json"\n'
    )
    proc = _run(script)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return proc.stdout.strip()


ROUND = "- **Round boundary:** 2026-09-19 (history before `abc1234` does not count)"


def test_implement_is_legal_on_an_archived_spec_reopened_without_reset_AC_2(tmp_path):
    status_file = _status_with(tmp_path, "5-x", ["", "**Archived:** 2026-09-01", "", ROUND])
    assert _phase(status_file) == "implemented"
    assert may_apply(status_file, "implement")["RC"] == "0"


def test_an_archived_spec_that_was_not_reopened_still_refuses_implement_AC_2(tmp_path):
    status_file = _status_with(tmp_path, "5-x", ["", "**Archived:** 2026-09-01"])
    assert _phase(status_file) == "archived"
    result = may_apply(status_file, "implement")
    assert result["RC"] == "1"


def test_a_closed_spec_reopened_without_reset_no_longer_reads_closed_AC_2(tmp_path):
    status_file = _status_with(
        tmp_path, "5-x", ["", "**Closed:** 2026-09-01 — no", "", ROUND], workflow_line="create, analyze")
    assert _phase(status_file) == "analyzed"


def test_an_archive_stamp_after_the_boundary_counts_again_AC_2(tmp_path):
    status_file = _status_with(
        tmp_path, "5-x", ["", "**Archived:** 2026-09-01", "", ROUND, "", "**Archived:** 2026-09-20"])
    assert _phase(status_file) == "archived"


def test_a_closed_stamp_after_the_boundary_counts_again_AC_2(tmp_path):
    status_file = _status_with(
        tmp_path, "5-x", ["", "**Archived:** 2026-09-01", "", ROUND, "", "**Closed:** 2026-09-20 — no"])
    assert _phase(status_file) == "closed"


def test_a_reopened_or_reset_mark_after_the_stamp_is_history_too_AC_2(tmp_path):
    for mark in ("Reopened", "Reset"):
        line = f"- **{mark}:** 2026-09-19 (history before `abc1234` does not count)"
        status_file = _status_with(tmp_path, f"5-{mark}", ["", "**Archived:** 2026-09-01", "", line])
        assert _phase(status_file) == "implemented", mark


def test_reopen_keep_takes_archive_off_the_line_and_the_state_and_stamps_the_boundary_AC_2(tmp_path):
    status_file = _status_with(
        tmp_path, "5-x", ["", "**Archived:** 2026-09-01"], workflow_line="create, analyze, implement, archive")
    script = (
        f'source "{LIB}"\n'
        f'apply_spec_transition "{status_file}" reopen-keep "abc1234"\n'
        'echo "RC=$?"\n'
    )
    proc = _run(script)
    assert "RC=0" in proc.stdout, proc.stdout + proc.stderr
    text = status_file.read_text()
    assert "- **Workflow steps completed:** create, analyze, implement\n" in text
    assert text.count("**Round boundary:**") == 1 and "`abc1234`" in text
    assert "**Archived:** 2026-09-01" in text
    state = json.loads((status_file.parent / ("4-status." + "json")).read_text())
    assert state["completedPhases"] == ["create", "analyze", "implement"]
    assert state["archived"] is None


# --- A Failed row goes back to open on Reopen (spec 510) ---------------------

_FAILED_STATUS = (
    "## Phase 1: RED\n\n| Task | Status | Notes |\n|------|--------|-------|\n"
    "| a phase row | ❌ Failed | left alone |\n\n"
    "## Acceptance criteria\n\n| Task | Status | Notes |\n|------|--------|-------|\n"
    "| AC-1: one | ❌ Failed | Failed: the log shows no row for $& |\n"
    "| AC-2: two | Failed | Failed: x |\n"
    "| AC-3: three | 🔍 Not verified | Not tested: y |\n"
    "| AC-4: four | ✅ | |\n"
)


def _reopen_keep(tmp_path, body):
    status_file = _status_with(
        tmp_path, "5-x", ["", "**Archived:** 2026-09-01", "", body],
        workflow_line="create, analyze, implement, archive")
    script = f'source "{LIB}"\napply_spec_transition "{status_file}" reopen-keep "abc1234"\necho "RC=$?"\n'
    proc = _run(script)
    assert "RC=0" in proc.stdout, proc.stdout + proc.stderr
    return status_file


def test_reopen_keep_unticks_failed_acceptance_rows_and_keeps_their_notes_AC_9(tmp_path):
    status_file = _reopen_keep(tmp_path, _FAILED_STATUS)
    text = status_file.read_text()
    assert "| AC-1: one | ⬜ | Failed: the log shows no row for $& |" in text
    assert "| AC-2: two | ⬜ | Failed: x |" in text
    assert "| AC-3: three | 🔍 Not verified | Not tested: y |" in text
    assert "| AC-4: four | ✅ | |" in text
    assert "| a phase row | ❌ Failed | left alone |" in text
    state = json.loads((status_file.parent / ("4-status." + "json")).read_text())
    assert [r.get("failed") for r in state["acceptanceCriteria"]] == [None, None, None, None]


def test_reopen_keep_without_a_failed_row_changes_no_row_AC_9(tmp_path):
    body = _FAILED_STATUS.replace("❌ Failed", "✅").replace("| Failed |", "| ✅ |")
    status_file = _reopen_keep(tmp_path, body)
    assert body in status_file.read_text()
