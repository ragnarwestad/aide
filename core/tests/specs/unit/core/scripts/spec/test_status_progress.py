"""Tests for core/scripts/lib/status-progress.sh: `status_rows_in`, the one
reader of a status file's headings and rows, and the two counts built on it,
`status_progress_for` and `status_advanced_count_for`.

`status_progress_for` answers "how many rows are DONE"; this answers "how
many rows have moved off NOT STARTED at all" — the wider question the new
`analyze` scope-violation guard in aide-run-spec needs, since a row that
moved to in-progress/blocked/waiting without ever reaching done is still a
violation of analyze's own scope, not just a row that
reached ✅.
"""
import subprocess
from pathlib import Path

import pytest

LIB = Path(__file__).resolve().parents[7] / "core" / "scripts" / "lib" / "status-progress.sh"


def advanced_count(tmp_path, content):
    status_file = tmp_path / "4-status.md"
    status_file.write_text(content)
    script = (
        f'source "{LIB}"\n'
        f'status_advanced_count_for "{status_file}"\n'
        'echo "$advanced_count"\n'
    )
    proc = subprocess.run(
        ["bash", "-c", script], capture_output=True, text=True, check=True
    )
    return int(proc.stdout.strip())


def test_status_advanced_count_for_counts_any_non_not_started_row(tmp_path):
    content = (
        "# Queue - Status\n\n## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| a | ⬜ | |\n"
        "| b | ✅ | |\n"
        "| c | 🔄 | |\n"
        "| d | ❌ | |\n"
        "| e | ⚠️ | |\n"
        "| f | Not started | |\n"
        "| g | Completed | |\n"
    )
    assert advanced_count(tmp_path, content) == 5


def test_status_advanced_count_for_is_zero_on_a_fresh_skeleton(tmp_path):
    """A fresh Phase-table skeleton — every row still ⬜, the shape
    `/aide-create`/a genuine `/aide-analyze` leaves behind — advances
    nothing."""
    content = (
        "# Queue - Status\n\n## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| a | ⬜ | |\n"
        "| b | ⬜ | |\n"
    )
    assert advanced_count(tmp_path, content) == 0


def test_status_advanced_count_for_is_zero_with_no_phase_rows_at_all(tmp_path):
    content = "# Queue - Status\n\n## Tracking info\n\n- **Task:** `x/`\n"
    assert advanced_count(tmp_path, content) == 0


def test_status_advanced_count_for_excludes_a_non_standard_header_row(tmp_path):
    """The header row is recognized by its position directly
    above the separator, not by its own column text — a table headed
    `REQ | Criterion | Done` must count only the one genuinely advanced
    row, never the header itself."""
    content = (
        "# Queue - Status\n\n## Phase 1: RED\n\n"
        "| REQ | Criterion | Done |\n|------|--------|-------|\n"
        "| a | ✅ | |\n"
    )
    assert advanced_count(tmp_path, content) == 1


def test_status_advanced_count_for_ignores_a_not_verified_row(tmp_path):
    content = (
        "# Queue - Status\n\n## Acceptance criteria\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| AC-1: a | Not verified | Not tested: x |\n"
        "| AC-2: b | not verified | |\n"
        "| AC-3: c | ✅ | |\n"
    )
    assert advanced_count(tmp_path, content) == 1


# The mark is a symbol AND its words — "⬜ Not started" is what the
# shipped `4-status.md` template writes, and what a model writing a fresh
# plan copies. Read as anything but a start state it failed a whole
# analyze: 27 rows nobody had touched were
# counted as advanced, and the step was refused for a scope violation it
# had not committed.
def test_a_not_started_row_written_with_its_symbol_is_not_an_advance(tmp_path):
    content = (
        "# Queue - Status\n\n## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| a | ⬜ Not started | |\n"
        "| b | ⬜ | |\n"
        "| c | Not started | |\n"
    )
    assert advanced_count(tmp_path, content) == 0


def test_a_mark_that_carries_a_symbol_and_real_words_still_counts(tmp_path):
    content = (
        "# Queue - Status\n\n## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| a | ✅ Completed | |\n"
        "| b | 🔄 In progress | |\n"
        "| c | ⬜ Not started | |\n"
    )
    assert advanced_count(tmp_path, content) == 2


def test_not_verified_with_its_symbol_is_still_a_start_state(tmp_path):
    content = (
        "# Queue - Status\n\n## Acceptance criteria\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| AC-1 | ⬜ Not verified | |\n"
        "| AC-2 | Not verified | |\n"
    )
    assert advanced_count(tmp_path, content) == 0


def test_status_progress_for_agrees_with_the_shared_row_counting_fixture_ac_3(tmp_path):
    """`core/tests/fixtures/status-row-counting.json` is the table the
    dashboard's parse-status test reads for the TypeScript half; the
    runner's `Total progress` line is counted by this function."""
    import json
    fixture = Path(__file__).resolve().parents[5] / "fixtures" / "status-row-counting.json"
    status_file = tmp_path / "4-status.md"
    for case in json.loads(fixture.read_text())["cases"]:
        status_file.write_text("# Queue - Status\n\n" + case["body"])
        proc = subprocess.run(
            ["bash", "-c", f'source "{LIB}"\nstatus_progress_for "{status_file}"\n'
             'echo "$progress_done $progress_total"'],
            capture_output=True, text=True, check=True,
        )
        assert proc.stdout.split() == [str(case["done"]), str(case["total"])], case["name"]


# --- status_rows_in: the one reading of headings, rows and marks ------------

SPEC_STATE_LIB = LIB.parent / "spec-state.sh"

# Every rule the reader applies, in one Phase table: the header undone by
# the separator, an escaped pipe kept in the task, an empty task, a mark
# over 30 bytes, a mark with a comma, a mark with a tab inside it, a plain
# row, and a `## Plan review` table that is no status section at all.
MIXED_STATUS = (
    "# Spec - Status\n\n## Phase 1: RED\n\n"
    "| Task | Status | Notes |\n|------|--------|-------|\n"
    "| a \\| b | ✅ | |\n"
    "|  | ✅ | |\n"
    "| long | " + "x" * 31 + " | |\n"
    "| comma | ✅, done | |\n"
    "| tab | ✅\tcompleted | |\n"
    "| plain | ⬜ | |\n\n"
    "## Plan review\n\n"
    "| Task | Status | Notes |\n|------|--------|-------|\n"
    "| reviewed | ✅ | |\n"
)


def rows_in(tmp_path, content):
    status_file = tmp_path / "4-status.md"
    status_file.write_text(content)
    proc = subprocess.run(
        ["bash", "-c", f'source "{LIB}"\nstatus_rows_in "{status_file}"'],
        capture_output=True, text=True, check=True,
    )
    lines = proc.stdout.split("\n")[:-1]
    records = []
    while lines:
        size = 5 if lines[0] == "ROW" else 3
        records.append(lines[:size])
        lines = lines[size:]
    return records


def test_status_rows_in_prints_the_heading_and_only_the_rows_that_count_ac_1(tmp_path):
    assert rows_in(tmp_path, MIXED_STATUS) == [
        ["HEAD", "Phase 1: RED", "phase"],
        ["ROW", "Phase 1: RED", "phase", "a \\| b", "✅"],
        ["ROW", "Phase 1: RED", "phase", "tab", "✅\tcompleted"],
        ["ROW", "Phase 1: RED", "phase", "plain", "⬜"],
    ]


def test_status_rows_in_keeps_a_header_row_no_separator_follows_ac_1(tmp_path):
    content = (
        "# S\n\n## Acceptance criteria\n\n"
        "| Task | Status | Notes |\n| a | ✅ | |\n"
    )
    assert rows_in(tmp_path, content) == [
        ["HEAD", "Acceptance criteria", "acceptance"],
        ["ROW", "Acceptance criteria", "acceptance", "Task", "Status"],
        ["ROW", "Acceptance criteria", "acceptance", "a", "✅"],
    ]


def test_status_rows_in_keeps_a_header_row_a_blank_line_parts_from_its_separator_ac_1(tmp_path):
    content = (
        "# S\n\n## Checklist\n\n"
        "| Task | Status | Notes |\n\n|------|--------|-------|\n| a | ⬜ | |\n"
    )
    assert rows_in(tmp_path, content) == [
        ["HEAD", "Checklist", "checklist"],
        ["ROW", "Checklist", "checklist", "Task", "Status"],
        ["ROW", "Checklist", "checklist", "a", "⬜"],
    ]


def test_status_rows_in_prints_a_heading_with_no_rows_in_file_order_ac_1(tmp_path):
    content = (
        "# S\n\n## Fase 1\n\n## Phase 2\n\n"
        "| Task | Status | Notes |\n|---|---|---|\n| a | ✅ | |\n"
    )
    assert rows_in(tmp_path, content) == [
        ["HEAD", "Fase 1", "fase"],
        ["HEAD", "Phase 2", "phase"],
        ["ROW", "Phase 2", "phase", "a", "✅"],
    ]


def test_the_three_readers_count_the_rows_status_rows_in_prints_ac_1(tmp_path):
    status_file = tmp_path / "4-status.md"
    status_file.write_text(MIXED_STATUS)
    script = (
        f'source "{SPEC_STATE_LIB}"\n'
        f'status_progress_for "{status_file}"\n'
        f'status_advanced_count_for "{status_file}"\n'
        f'write_spec_state "{status_file}"\n'
        'echo "$progress_done $progress_total $advanced_count"\n'
    )
    proc = subprocess.run(["bash", "-c", script], capture_output=True, text=True, check=True)
    # Done is the `a \| b` row alone: `✅<TAB>completed` is not a done mark.
    # Moved are that row and the tab row; `⬜` has not moved.
    assert proc.stdout.split() == ["1", "3", "2"]
    import json
    state = json.loads((tmp_path / "4-status.json").read_text())
    assert state["phaseCounts"] == {"Phase 1: RED": {"done": 1, "total": 3}}


def test_a_unit_separator_inside_a_cell_is_text_ac_2(tmp_path):
    content = (
        "# S\n\n## Acceptance criteria\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| AC-1: a\x1fb | ✅ | |\n"
        "| AC-2: c | ✅\x1f | |\n"
    )
    assert rows_in(tmp_path, content)[1:] == [
        ["ROW", "Acceptance criteria", "acceptance", "AC-1: a\x1fb", "✅"],
        ["ROW", "Acceptance criteria", "acceptance", "AC-2: c", "✅\x1f"],
    ]
    status_file = tmp_path / "4-status.md"
    proc = subprocess.run(
        ["bash", "-c", f'source "{SPEC_STATE_LIB}"\nstatus_progress_for "{status_file}"\n'
         f'status_advanced_count_for "{status_file}"\nwrite_spec_state "{status_file}"\n'
         'echo "$progress_done $progress_total $advanced_count"'],
        capture_output=True, text=True, check=True,
    )
    assert proc.stdout.split() == ["1", "2", "2"]
    import json
    state = json.loads((tmp_path / "4-status.json").read_text())
    assert state["acceptanceCriteria"][0] == {"task": "AC-1: a\x1fb", "done": True}
