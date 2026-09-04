"""Spec 356 (REQ-2, REQ-7): a spec's phase changes only through
`apply_spec_transition` (core/scripts/lib/spec-transitions.sh) — the
"Workflow steps completed" line, the `**Archived:**` stamp, and the
`**Reopened:**`/`**Reset:**` marks are written nowhere else. Grepped for
by the WRITE SHAPE itself (the exact construct that puts one of these
patterns into a file), the same approach test_no_second_writer_of_
spec_state.py already uses for 4-status.json's own writers — a caller
that reads the pattern (every gate already does, to decide what to do)
is untouched; only a second WRITER of it is caught.
"""
from pathlib import Path

import pytest

BASH_SCRIPTS = ["core/scripts/aide-run-spec", "core/scripts/aide-archive-spec",
                 "core/scripts/aide-write-spec", "core/scripts/aide-backfill-spec-state"]

# The exact write shapes that put a phase/stamp pattern into a file.
# Anything matching one of these outside spec-transitions.sh is a second
# writer REQ-2 forbids.
WORKFLOW_LINE_WRITE_SHAPE = 'line="- **Workflow steps completed:**'
ARCHIVED_STAMP_WRITE_SHAPE = "printf '\\n**Archived:** %s\\n'"
REOPEN_RESET_STAMP_WRITE_SHAPE = "printf '\\n- **%s:** %s (history before"


class TestBashWritesConfinedToSpecTransitions:
    def test_workflow_steps_line_written_only_in_spec_transitions(self, workspace_root):
        for name in BASH_SCRIPTS:
            text = (workspace_root / name).read_text()
            assert WORKFLOW_LINE_WRITE_SHAPE not in text, (
                f"{name} writes the 'Workflow steps completed' line directly — "
                "only spec-transitions.sh's write_phase_stamp may write it"
            )
        lib = (workspace_root / "core/scripts/lib/spec-transitions.sh").read_text()
        assert WORKFLOW_LINE_WRITE_SHAPE in lib

    def test_archived_stamp_written_only_in_spec_transitions(self, workspace_root):
        for name in BASH_SCRIPTS:
            text = (workspace_root / name).read_text()
            assert ARCHIVED_STAMP_WRITE_SHAPE not in text, (
                f"{name} writes the **Archived:** stamp directly — "
                "only spec-transitions.sh's write_phase_stamp may write it"
            )
        lib = (workspace_root / "core/scripts/lib/spec-transitions.sh").read_text()
        assert ARCHIVED_STAMP_WRITE_SHAPE in lib

    def test_reopened_and_reset_stamps_written_only_in_spec_transitions(self, workspace_root):
        for name in BASH_SCRIPTS:
            text = (workspace_root / name).read_text()
            assert REOPEN_RESET_STAMP_WRITE_SHAPE not in text, (
                f"{name} writes the **Reopened:**/**Reset:** stamp directly — "
                "only spec-transitions.sh's write_phase_stamp may write it"
            )
        lib = (workspace_root / "core/scripts/lib/spec-transitions.sh").read_text()
        assert REOPEN_RESET_STAMP_WRITE_SHAPE in lib


class TestDashboardNeverWritesAPhaseOrStamp:
    """`aide-write-spec` and `spec-edit.ts`'s tick route are additional
    writers of 4-status.md content (a person ticking a Checks-tab row),
    but neither writes a PHASE (2-analysis.md) — this pins that they stay
    that way."""

    def test_spec_edit_never_writes_the_workflow_steps_line_or_the_stamps(self, workspace_root):
        text = (workspace_root / "dashboard/src/serve/handle-queue/spec-edit.ts").read_text()
        assert "Workflow steps completed" not in text
        assert "**Archived:**" not in text
        assert "**Reopened:**" not in text
        assert "**Reset:**" not in text

    def test_aide_write_spec_never_constructs_the_workflow_steps_line_or_the_stamps(self, workspace_root):
        text = (workspace_root / "core/scripts/aide-write-spec").read_text()
        assert WORKFLOW_LINE_WRITE_SHAPE not in text
        assert ARCHIVED_STAMP_WRITE_SHAPE not in text
        assert REOPEN_RESET_STAMP_WRITE_SHAPE not in text
