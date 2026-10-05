"""Tests for `status_advanced_count_for` (core/scripts/lib/status-progress.sh),
spec 288's sibling to the existing `status_progress_for`.

`status_progress_for` answers "how many rows are DONE"; this answers "how
many rows have moved off NOT STARTED at all" — the wider question the new
`analyze` scope-violation guard in aide-run-spec needs, since a row that
moved to in-progress/blocked/waiting without ever reaching done is still a
violation of analyze's own scope (REQ-1, REQ-2), not just a row that
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
    """Spec 299: the header row is recognized by its position directly
    above the separator, not by its own column text — a table headed
    `REQ | Criterion | Done` must count only the one genuinely advanced
    row, never the header itself."""
    content = (
        "# Queue - Status\n\n## Phase 1: RED\n\n"
        "| REQ | Criterion | Done |\n|------|--------|-------|\n"
        "| a | ✅ | |\n"
    )
    assert advanced_count(tmp_path, content) == 1


def test_status_advanced_count_for_ignores_a_not_verified_row_AC_7(tmp_path):
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
# analyze (north-star:01, 2026-09-23): 27 rows nobody had touched were
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


def test_status_progress_for_agrees_with_the_shared_row_counting_fixture(tmp_path):
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
