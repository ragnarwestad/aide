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

LIB = Path(__file__).resolve().parents[5] / "core" / "scripts" / "lib" / "status-progress.sh"


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


def start_pass(tmp_path, after, before):
    """Runs the start pass over `after`; `before` None means no baseline
    file at all. Returns the rewritten text."""
    status_file = tmp_path / "4-status.md"
    status_file.write_text(after)
    before_file = tmp_path / "status-before"
    if before is not None:
        before_file.write_text(before)
    script = (
        f'source "{LIB}"\n'
        f'start_not_tested_rows_not_verified "{status_file}" "{before_file}"\n'
    )
    subprocess.run(["bash", "-c", script], capture_output=True, text=True, check=True)
    return status_file.read_text()


NO_ACCEPTANCE_BEFORE = "# Queue - Status\n\n## Phase 1: RED\n\n| Task | Status | Notes |\n|------|--------|-------|\n| a | ⬜ | |\n"
WITH_ACCEPTANCE = (
    NO_ACCEPTANCE_BEFORE
    + "\n## Acceptance criteria\n\n| Task | Status | Notes |\n|------|--------|-------|\n"
    + "| AC-1: one | ⬜ | Not tested: needs the deploy; check the page |\n"
    + "| AC-2: two | ⬜ | Read as: this way |\n"
    + "| AC-3: three | ⬜ | |\n"
    + "| AC-4: four | ✅ | Not tested: already ticked |\n"
)


def test_the_start_pass_rewrites_only_open_not_tested_acceptance_rows_AC_7(tmp_path):
    out = start_pass(tmp_path, WITH_ACCEPTANCE, NO_ACCEPTANCE_BEFORE)
    assert "| AC-1: one | Not verified | Not tested: needs the deploy; check the page |" in out
    assert "| AC-2: two | ⬜ | Read as: this way |" in out
    assert "| AC-3: three | ⬜ | |" in out
    assert "| AC-4: four | ✅ | Not tested: already ticked |" in out
    assert out.replace("Not verified", "⬜", 1) == WITH_ACCEPTANCE


def test_the_start_pass_leaves_a_phase_row_alone_AC_7(tmp_path):
    after = NO_ACCEPTANCE_BEFORE.replace("| a | ⬜ | |", "| a | ⬜ | Not tested: x |")
    assert start_pass(tmp_path, after, NO_ACCEPTANCE_BEFORE) == after


def test_the_start_pass_starts_nothing_in_a_later_round_AC_20(tmp_path):
    """The baseline already has Acceptance rows: every Status cell stays
    byte-for-byte, including a row the user left ⬜ on purpose."""
    assert start_pass(tmp_path, WITH_ACCEPTANCE, WITH_ACCEPTANCE) == WITH_ACCEPTANCE


@pytest.mark.parametrize("before", [None, ""])
def test_the_start_pass_starts_nothing_on_a_missing_or_empty_baseline_AC_20(tmp_path, before):
    assert start_pass(tmp_path, WITH_ACCEPTANCE, before) == WITH_ACCEPTANCE


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
