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
