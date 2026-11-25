"""Tests for core/scripts/aide-close-spec — the mechanical
steps of /aide-close: folder resolution, the conflict check, and the
stamp-and-move with the reason the person closing it typed.

Unlike aide-archive-spec, this script carries no not-implemented-yet or
acceptance-criteria-unticked gate: Close must succeed
from every pre-archive phase, including one that never implemented and
one held on unticked acceptance rows.
"""
import json
import subprocess

import pytest

from .spec_repos import acceptance, add_spec, configure, make_conflict, phase, project, specs, status_md  # noqa: F401


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-close-spec"


def run(script, project, spec, reason="not going to work", specs_dir=None, result_file=None, omit_reason=False):
    args = [str(script), "--project-dir", str(project), "--spec", spec]
    if not omit_reason:
        args += ["--reason", reason]
    if specs_dir:
        args += ["--specs-dir", str(specs_dir)]
    if result_file:
        args += ["--result-file", str(result_file)]
    proc = subprocess.run(args, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


# --- refusal --------------------------------------------------------------


def test_refuses_without_project_dir(script):
    proc = subprocess.run([str(script), "--spec", "1", "--reason", "x"], capture_output=True, text=True)
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2
    assert out["terminalReason"] == "refused"


def test_refuses_without_spec(script, project):
    proc = subprocess.run(
        [str(script), "--project-dir", str(project), "--reason", "x"], capture_output=True, text=True
    )
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2
    assert out["terminalReason"] == "refused"


# --- No reason, no close ------------------------------------


def test_refuses_without_a_reason(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x")
    rc, out, _ = run(script, project, "81-x", omit_reason=True)
    assert rc == 2, out
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    # Nothing was touched: the folder is still where it was.
    assert (specs / "81-x").exists()


def test_unknown_spec_lists_the_active_folders(script, project, specs):
    configure(project, specs)
    add_spec(specs, "80-other")
    rc, out, _ = run(script, project, "999")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "80-other" in out["error"], out


# --- Legal from every pre-archive phase, unlike archive ----


def test_closes_a_spec_that_never_implemented(script, project, specs):
    """The exact case Archive refuses (not-implemented-yet): Close must
    succeed on it instead."""
    configure(project, specs)
    add_spec(specs, "81-x")
    rc, out, _ = run(script, project, "81-x", reason="this idea does not hold")
    assert rc == 0, out
    assert out["terminalReason"] == "closed", out
    assert out["specFolder"] == "archive/81-x"
    assert not (specs / "81-x").exists()
    assert (specs / "archive" / "81-x").exists()


def test_closes_a_spec_analyzed_but_not_implemented(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze", phase("Phase 1: RED", ["| a | ⬜ | |"]))
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "closed", out


def test_closes_a_spec_held_on_unticked_acceptance_rows(script, project, specs):
    """The exact case Archive refuses (acceptance-criteria-unticked):
    Close must succeed on it instead."""
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + acceptance(["| REQ-1: does a thing | ⬜ | |"]),
    )
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "closed", out
    assert not (specs / "81-x").exists()
    assert (specs / "archive" / "81-x").exists()


# --- The stamp carries the exact reason ------------------------------


def test_the_stamp_carries_the_exact_reason_text(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x", status_md())
    rc, out, _ = run(script, project, "81-x", reason="the idea does not hold up")
    assert rc == 0, out
    text = (specs / "archive" / "81-x" / "4-status.md").read_text()
    assert "**Closed:**" in text, text
    assert "the idea does not hold up" in text, text
    state = json.loads((specs / "archive" / "81-x" / "4-status.json").read_text())
    assert state["closed"]["reason"] == "the idea does not hold up"


# --- already-closed / already-archived idempotency -------------------------


def test_already_closed_is_idempotent(script, project, specs):
    configure(project, specs)
    body = "# X - Status\n\n## Tracking info\n\n**Closed:** 2026-09-01 — first reason\n"
    add_spec(specs, "81-x", body, archived=True)
    rc, out, _ = run(script, project, "81-x", reason="second attempt")
    assert rc == 0, out
    assert out["terminalReason"] == "already-closed", out
    assert out["specFolder"] == "archive/81-x"
    # The original stamp is left exactly as it was — closing twice does
    # not overwrite the recorded reason.
    text = (specs / "archive" / "81-x" / "4-status.md").read_text()
    assert "first reason" in text
    assert "second attempt" not in text


def test_close_on_a_plainly_archived_spec_names_reopen(script, project, specs):
    """A spec archived through the ordinary route (no **Closed:** stamp)
    refuses a close request, naming reopen — mirrors the transitions
    table's own `archived` + `close` refusal."""
    configure(project, specs)
    body = "# X - Status\n\n## Tracking info\n\n**Archived:** 2026-09-01\n"
    add_spec(specs, "81-x", body, archived=True)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "already-archived", out
    assert "reopen" in out["note"], out
    text = (specs / "archive" / "81-x" / "4-status.md").read_text()
    assert "**Closed:**" not in text


def test_an_archived_spec_that_mentions_the_stamp_is_not_already_closed(script, project, specs):
    """The stamp is the start of a line; a status table that quotes it
    (the spec that built Close does) is an archived spec, and close
    answers already-archived, not already-closed."""
    configure(project, specs)
    body = (
        "# X - Status\n\n| Task | Status | Notes |\n|---|---|---|\n"
        "| write the stamp | done | writes `**Closed:** <date> — <reason>` |\n\n"
        "**Archived:** 2026-09-01\n"
    )
    add_spec(specs, "82-x", body, archived=True)
    rc, out, _ = run(script, project, "82-x")
    assert rc == 0, out
    assert out["terminalReason"] == "already-archived", out


# --- conflict-open ----------------------------------------------------------


def test_conflict_open_in_the_project_dir(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x")
    make_conflict(project)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "conflict-open"
    assert (specs / "81-x").exists()


def test_conflict_open_in_the_specs_dir_alone(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x")
    make_conflict(specs)
    rc, out, _ = run(script, project, "81-x", specs_dir=specs)
    assert out["terminalReason"] == "conflict-open", out
