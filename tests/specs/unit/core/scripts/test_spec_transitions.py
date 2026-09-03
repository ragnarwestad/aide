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


def test_analyze_refused_once_implemented_names_reset(tmp_path):
    status_file = _status_file(tmp_path, "7-x", workflow_line="create, analyze, implement")
    result = may_apply(status_file, "analyze")
    assert result["RC"] == "1"
    assert result["REASON"] == "already-implemented"
    assert "/aide-reset" in result["MESSAGE"]


def test_create_refused_once_analyzed_names_reset(tmp_path):
    status_file = _status_file(tmp_path, "7-x", workflow_line="create, analyze")
    result = may_apply(status_file, "create")
    assert result["RC"] == "1"
    assert result["REASON"] == "already-analyzed"
    assert "/aide-reset" in result["MESSAGE"]


def test_analyze_refused_on_an_archived_spec_names_reopen(tmp_path):
    status_file = _status_file(tmp_path, "7-x", workflow_line="create, analyze, implement", archived="2026-09-01")
    result = may_apply(status_file, "analyze")
    assert result["RC"] == "1"
    assert result["REASON"] == "already-archived"
    assert "only reopen" in result["MESSAGE"]


# --- reopen/reset --------------------------------------------------------


def test_reopen_is_legal_only_from_archived(tmp_path):
    active = _status_file(tmp_path, "1-x", workflow_line="create, analyze")
    result = may_apply(active, "reopen")
    assert result["RC"] == "1"
    assert result["REASON"] == "already-active"
    assert "nothing to reopen" in result["MESSAGE"]

    archived = _status_file(tmp_path, "2-x", workflow_line="create, analyze, implement", archived="2026-09-01")
    result = may_apply(archived, "reopen")
    assert result["RC"] == "0"


def test_reset_is_legal_from_analyzed_and_implemented(tmp_path):
    analyzed = _status_file(tmp_path, "1-x", workflow_line="create, analyze")
    assert may_apply(analyzed, "reset")["RC"] == "0"
    implemented = _status_file(tmp_path, "2-x", workflow_line="create, analyze, implement")
    assert may_apply(implemented, "reset")["RC"] == "0"


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
