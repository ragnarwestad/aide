"""Tests for core/scripts/aide-backfill-spec-state — the one-time,
re-runnable pass that gives every already-archived spec a 4-status.json
(spec 355, REQ-5, REQ-9). No AI is involved: it is a deterministic,
prose-parsing pass over archive/, run once (and safely re-run) rather
than kept alive as a second, ongoing prose-reading path.
"""
import json
import subprocess

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-backfill-spec-state"


def run(script, specs_root):
    proc = subprocess.run(
        [str(script), "--specs-root", str(specs_root)],
        capture_output=True, text=True,
    )
    lines = proc.stdout.strip().splitlines()
    totals = json.loads(lines[-1]) if lines else {}
    return proc.returncode, totals, "\n".join(lines[:-1])


def make_archived_spec(specs_root, folder, body):
    d = specs_root / "archive" / folder
    d.mkdir(parents=True)
    (d / "4-status.md").write_text(body)
    return d


def test_writes_a_state_file_for_every_archived_spec(script, tmp_path):
    specs_root = tmp_path / "specs"
    make_archived_spec(specs_root, "1-a", "# X - Status\n\n## Tracking info\n\n"
                        "- **Workflow steps completed:** create, analyze, implement\n\n"
                        "**Archived:** 2026-08-20\n")
    rc, totals, out = run(script, specs_root)
    assert rc == 0, out
    assert totals == {"written": 1, "uncertain": 0}
    state = json.loads((specs_root / "archive" / "1-a" / "4-status.json").read_text())
    assert state["completedPhases"] == ["create", "analyze", "implement"]
    assert state["archived"] == {"date": "2026-08-20"}


def test_is_idempotent_on_a_second_run(script, tmp_path):
    specs_root = tmp_path / "specs"
    make_archived_spec(specs_root, "1-a", "# X - Status\n\n## Tracking info\n\n"
                        "- **Workflow steps completed:** create\n\n**Archived:** 2026-08-20\n")
    run(script, specs_root)
    first = (specs_root / "archive" / "1-a" / "4-status.json").read_text()
    rc, totals, out = run(script, specs_root)
    assert rc == 0, out
    assert totals == {"written": 1, "uncertain": 0}
    assert (specs_root / "archive" / "1-a" / "4-status.json").read_text() == first


def test_reports_a_spec_with_no_4_status_md_at_all(script, tmp_path):
    specs_root = tmp_path / "specs"
    d = specs_root / "archive" / "2-b"
    d.mkdir(parents=True)
    (d / "1-description.md").write_text("# 2-b\n")
    rc, totals, out = run(script, specs_root)
    assert rc == 0, out
    assert totals == {"written": 0, "uncertain": 1}
    assert "2-b" in out
    assert "no 4-status.md" in out
    assert not (d / "4-status.json").exists()


def test_reports_an_unparseable_reopened_stamp_rather_than_guessing(script, tmp_path):
    """A malformed fixture: the file names a Reopened stamp, but not in
    the "history before `sha`" grammar spec-state.sh parses — this must
    be reported by name, not silently written with reopened:null (which
    would be indistinguishable from "never reopened at all")."""
    specs_root = tmp_path / "specs"
    make_archived_spec(specs_root, "3-c", "# X - Status\n\n## Tracking info\n\n"
                        "- **Reopened:** at some point, not sure when\n")
    rc, totals, out = run(script, specs_root)
    assert rc == 0, out
    assert totals == {"written": 0, "uncertain": 1}
    assert "3-c" in out
    assert "Reopened" in out
    # The state file is still written -- every OTHER field is still
    # derivable with certainty -- just flagged in the summary, not
    # silently dropped.
    state = json.loads((specs_root / "archive" / "3-c" / "4-status.json").read_text())
    assert state["reopened"] is None


def test_reports_an_unparseable_archived_stamp(script, tmp_path):
    specs_root = tmp_path / "specs"
    make_archived_spec(specs_root, "4-d", "# X - Status\n\n## Tracking info\n\n"
                        "**Archived:** sometime last month\n")
    rc, totals, out = run(script, specs_root)
    assert rc == 0, out
    assert totals["uncertain"] == 1
    assert "4-d" in out
    assert "Archived" in out


def test_a_wellformed_spec_among_uncertain_ones_is_still_written(script, tmp_path):
    specs_root = tmp_path / "specs"
    make_archived_spec(specs_root, "5-e", "# X - Status\n\n## Tracking info\n\n"
                        "- **Workflow steps completed:** create, analyze, implement\n\n"
                        "**Archived:** 2026-08-20\n")
    make_archived_spec(specs_root, "6-f", "# X - Status\n\n## Tracking info\n\n"
                        "**Archived:** unknown date\n")
    rc, totals, out = run(script, specs_root)
    assert rc == 0, out
    assert totals == {"written": 1, "uncertain": 1}
    assert (specs_root / "archive" / "5-e" / "4-status.json").exists()


def test_no_archive_directory_at_all_is_a_clean_no_op(script, tmp_path):
    specs_root = tmp_path / "specs"
    specs_root.mkdir()
    rc, totals, out = run(script, specs_root)
    assert rc == 0, out
    assert totals == {"written": 0, "uncertain": 0}


def test_refuses_without_specs_root(script):
    proc = subprocess.run([str(script)], capture_output=True, text=True)
    assert proc.returncode == 2
