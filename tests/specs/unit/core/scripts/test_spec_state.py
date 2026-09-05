"""Tests for `write_spec_state`/`read_spec_state`
(core/scripts/lib/spec-state.sh), spec 355's shared derivation function:
the one place a spec's completed phases, archived/reopened stamps,
acceptance-criteria ticks and per-phase task-row counts are derived from
4-status.md's prose and written to 4-status.json beside it.
"""
import json
import subprocess
from pathlib import Path

import pytest

LIB = Path(__file__).resolve().parents[5] / "core" / "scripts" / "lib" / "spec-state.sh"
FIXTURE = Path(__file__).resolve().parents[5] / "tests" / "fixtures" / "status-row-counting.json"


def _run(script):
    proc = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
    return proc


def write_state(tmp_path, content, override=None):
    status_file = tmp_path / "4-status.md"
    status_file.write_text(content)
    override_arg = f' "{override}"' if override is not None else ""
    script = (
        f'source "{LIB}"\n'
        f'write_spec_state "{status_file}"{override_arg}\n'
        'echo "exit=$?"\n'
    )
    proc = _run(script)
    assert "exit=0" in proc.stdout, proc.stdout + proc.stderr
    state_file = tmp_path / "4-status.json"
    return json.loads(state_file.read_text())


def read_state(tmp_path, content):
    status_file = tmp_path / "4-status.md"
    status_file.write_text(content)
    script = (
        f'source "{LIB}"\n'
        f'read_spec_state "{status_file}"\n'
        'printf "%s" "$state_json"\n'
    )
    proc = _run(script)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return json.loads(proc.stdout)


# --- completedPhases ---------------------------------------------------


def test_derives_completed_phases_from_the_prose_line_with_no_state_file_yet(tmp_path):
    content = (
        "# Spec - Status\n\n## Tracking info\n\n"
        "- **Workflow steps completed:** create, analyze\n"
    )
    state = write_state(tmp_path, content)
    assert state["completedPhases"] == ["create", "analyze"]


def test_override_wins_over_the_prose_line(tmp_path):
    content = (
        "# Spec - Status\n\n## Tracking info\n\n"
        "- **Workflow steps completed:** create\n"
    )
    state = write_state(tmp_path, content, override="create, analyze, implement")
    assert state["completedPhases"] == ["create", "analyze", "implement"]


def test_a_write_with_no_override_preserves_the_existing_state_files_value(tmp_path):
    content = (
        "# Spec - Status\n\n## Tracking info\n\n"
        "- **Workflow steps completed:** create, analyze\n"
    )
    status_file = tmp_path / "4-status.md"
    status_file.write_text(content)
    # A stray hand edit of the prose line must not leak into the state
    # file on a plain re-derive — only an explicit override changes
    # completedPhases once a state file exists.
    script = (
        f'source "{LIB}"\n'
        f'write_spec_state "{status_file}"\n'
        f'sed -i.bak "s/create, analyze/create, analyze, implement, archive/" "{status_file}"\n'
        f'write_spec_state "{status_file}"\n'
    )
    proc = _run(script)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    state = json.loads((tmp_path / "4-status.json").read_text())
    assert state["completedPhases"] == ["create", "analyze"]


def test_read_spec_state_self_heals_when_no_state_file_exists(tmp_path):
    content = (
        "# Spec - Status\n\n## Tracking info\n\n"
        "- **Workflow steps completed:** create, analyze, implement\n"
    )
    state = read_state(tmp_path, content)
    assert state["completedPhases"] == ["create", "analyze", "implement"]
    assert (tmp_path / "4-status.json").exists()


# --- archived / reopened stamps -----------------------------------------


def test_archived_stamp_is_null_when_absent(tmp_path):
    content = "# Spec - Status\n\n## Tracking info\n\n- **Task:** `x/`\n"
    state = write_state(tmp_path, content)
    assert state["archived"] is None


def test_archived_stamp_carries_the_last_dated_mark(tmp_path):
    content = "# Spec - Status\n\n## Tracking info\n\n**Archived:** 2026-08-20\n"
    state = write_state(tmp_path, content)
    assert state["archived"] == {"date": "2026-08-20"}


def test_closed_stamp_is_null_when_absent(tmp_path):
    content = "# Spec - Status\n\n## Tracking info\n\n- **Task:** `x/`\n"
    state = write_state(tmp_path, content)
    assert state["closed"] is None


def test_closed_stamp_carries_the_date_and_reason(tmp_path):
    content = "# Spec - Status\n\n## Tracking info\n\n**Closed:** 2026-09-05 — this idea does not hold\n"
    state = write_state(tmp_path, content)
    assert state["closed"] == {"date": "2026-09-05", "reason": "this idea does not hold"}


def test_the_last_closed_mark_wins(tmp_path):
    content = (
        "# Spec - Status\n\n## Tracking info\n\n"
        "**Closed:** 2026-09-01 — first reason\n"
        "**Closed:** 2026-09-05 — second reason\n"
    )
    state = write_state(tmp_path, content)
    assert state["closed"] == {"date": "2026-09-05", "reason": "second reason"}


def test_reopened_stamp_carries_date_and_boundary_commit(tmp_path):
    content = (
        "# Spec - Status\n\n## Tracking info\n\n"
        "- **Reopened:** 2026-08-23 (history before `1d0fe79` does not count)\n"
    )
    state = write_state(tmp_path, content)
    assert state["reopened"] == {"date": "2026-08-23", "boundaryCommit": "1d0fe79"}


def test_reset_stamp_uses_the_same_grammar_as_reopened(tmp_path):
    content = (
        "# Spec - Status\n\n## Tracking info\n\n"
        "- **Reset:** 2026-08-23 (history before `abcdef0` does not count)\n"
    )
    state = write_state(tmp_path, content)
    assert state["reopened"] == {"date": "2026-08-23", "boundaryCommit": "abcdef0"}


def test_the_last_reopened_or_reset_mark_wins(tmp_path):
    content = (
        "# Spec - Status\n\n## Tracking info\n\n"
        "- **Reopened:** 2026-08-01 (history before `aaaaaaa` does not count)\n"
        "- **Reopened:** 2026-08-23 (history before `1d0fe79` does not count)\n"
    )
    state = write_state(tmp_path, content)
    assert state["reopened"] == {"date": "2026-08-23", "boundaryCommit": "1d0fe79"}


# --- acceptance criteria -------------------------------------------------


def test_acceptance_criteria_rows_carry_task_text_and_done_flag(tmp_path):
    content = (
        "# Spec - Status\n\n## Acceptance criteria\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| REQ-1: first | ✅ | |\n"
        "| REQ-2: second | ⬜ | |\n"
    )
    state = write_state(tmp_path, content)
    assert state["acceptanceCriteria"] == [
        {"task": "REQ-1: first", "done": True},
        {"task": "REQ-2: second", "done": False},
    ]


def test_no_acceptance_section_gives_an_empty_list(tmp_path):
    content = "# Spec - Status\n\n## Tracking info\n\n- **Task:** `x/`\n"
    state = write_state(tmp_path, content)
    assert state["acceptanceCriteria"] == []


# --- phase task-row counts ------------------------------------------------


def test_phase_counts_are_keyed_per_heading(tmp_path):
    content = (
        "# Spec - Status\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| a | ✅ | |\n| b | ⬜ | |\n\n"
        "## Phase 2: GREEN\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| c | ✅ | |\n\n"
        "## Acceptance criteria\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| REQ-1: x | ⬜ | |\n"
    )
    state = write_state(tmp_path, content)
    assert state["phaseCounts"] == {
        "Phase 1: RED": {"done": 1, "total": 2},
        "Phase 2: GREEN": {"done": 1, "total": 1},
        "Acceptance criteria": {"done": 0, "total": 1},
    }


def test_a_non_phase_heading_is_not_counted(tmp_path):
    """`## Plan review` and similar tables must never be mistaken for a
    Phase/Fase/Checklist/Acceptance section — same rule status_progress_for
    already applies."""
    content = (
        "# Spec - Status\n\n## Plan review\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| Reviewed | ✅ | |\n"
    )
    state = write_state(tmp_path, content)
    assert state["phaseCounts"] == {}


@pytest.mark.parametrize("missing", [True, False])
def test_write_spec_state_returns_nonzero_when_status_file_is_missing(tmp_path, missing):
    status_file = tmp_path / "4-status.md"
    if not missing:
        status_file.write_text("# Spec - Status\n")
    script = f'source "{LIB}"\nwrite_spec_state "{status_file}"\necho "exit=$?"\n'
    proc = _run(script)
    if missing:
        assert "exit=1" in proc.stdout
        assert not (tmp_path / "4-status.json").exists()
    else:
        assert "exit=0" in proc.stdout


# --- cross-check against the shared status-row-counting fixture ------------
#
# `status_progress_for` (status-progress.sh) and `parseStatusChecks`
# (dashboard/src/project/parse-status.ts) are kept in step by this
# fixture (spec 246/285). spec-state.sh's own row/mark detection is a
# SEPARATE piece of awk, not a call into status_progress_for — it needs
# per-heading breakdowns and row-level task text neither of the existing
# two give — so this proves the two independent implementations still
# agree on every one of the fixture's cases, rather than assuming it
# from a shared code path that does not actually exist here.
FIXTURE_CASES = json.loads(FIXTURE.read_text())["cases"]


@pytest.mark.parametrize("case", FIXTURE_CASES, ids=[c["name"] for c in FIXTURE_CASES])
def test_phase_counts_summed_agree_with_the_shared_row_counting_fixture(tmp_path, case):
    content = "# Spec - Status\n\n" + case["body"]
    state = write_state(tmp_path, content)
    done = sum(c["done"] for c in state["phaseCounts"].values())
    total = sum(c["total"] for c in state["phaseCounts"].values())
    assert (done, total) == (case["done"], case["total"]), case["name"]
