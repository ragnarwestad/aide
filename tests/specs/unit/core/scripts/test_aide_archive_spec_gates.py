"""What stops an archive: an acceptance row nobody has ticked, an
implement that never ran, and the state file each of those is read
from.

Split out of test_aide_archive_spec.py 2026-09-04; the tests are
unchanged and keep their names.
"""

import json
import subprocess
import pytest

from .test_aide_archive_spec import (
    acceptance,
    add_spec,
    checklist,
    configure,
    git,
    init_repo,
    phase,
    project,
    run,
    script,
    specs,
    status_md,
    write_test_run,
)




# --- the acceptance-criteria gate (spec 285) -------------------------------
#
# Scoped ONLY to a `## Acceptance criteria` section — never to the
# ordinary Phase/Checklist rows AC3 above already lets through
# regardless of their own tick state. These rows are for a person to
# judge, and archive refuses until every one of them is ticked.


def test_unticked_acceptance_criteria_row_blocks_archive(script, project, specs):
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + acceptance(["| REQ-1: does the thing | ⬜ | |"]),
    )
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "acceptance-criteria-unticked", out
    assert (specs / "81-x").exists(), "an unticked acceptance-criteria row must block the move"


def test_fully_ticked_acceptance_criteria_archives_normally(script, project, specs):
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + acceptance(["| REQ-1: does the thing | ✅ | |"]),
    )
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "archived", out
    assert not (specs / "81-x").exists()
    assert (specs / "archive" / "81-x").exists()


def test_non_standard_header_acceptance_row_ticked_still_archives(script, project, specs):
    """Spec 299/REQ-1: a header row named something other than `Task |
    Status | Notes` must never count toward the acceptance gate's total
    — only its position above the separator marks it as a header, not
    its own column text."""
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + "\n".join([
            "## Acceptance criteria", "", "| REQ | Criterion | Done |",
            "|------|--------|-------|", "| REQ-1: does the thing | ✅ | |", "", "---", "",
        ]),
    )
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "archived", out
    assert not (specs / "81-x").exists()


def test_no_acceptance_criteria_section_is_unaffected(script, project, specs):
    """REQ-4: a spec with no `## Acceptance criteria` section behaves
    exactly as it did before this spec — implement present is enough."""
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ⬜ | |"]))
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "archived", out


def test_unticked_acceptance_criteria_note_names_the_checks_tab(script, project, specs):
    """REQ-5: the tab that carries this checklist is called Checks
    (spec 294 renamed it from Overview) — the note must send the reader
    there, not to a name the tab no longer has."""
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + acceptance(["| REQ-1: does the thing | ⬜ | |"]),
    )
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert "Checks tab" in out["note"], out
    assert "Overview tab" not in out["note"], out


def test_acceptance_criteria_gate_keeps_refusing_on_every_run(script, project, specs):
    """REQ-6: a spec whose acceptance-criteria row is never ticked stays
    blocked indefinitely — the refusal is not a one-time hiccup, it
    repeats on every later archive run until a person ticks the row."""
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + acceptance(["| REQ-1: does the thing | ⬜ | |"]),
    )
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc1, out1, _ = run(script, project, "81-x")
    rc2, out2, _ = run(script, project, "81-x")
    assert out1["terminalReason"] == "acceptance-criteria-unticked", out1
    assert out2["terminalReason"] == "acceptance-criteria-unticked", out2
    assert (specs / "81-x").exists()


def test_unticked_acceptance_criteria_blocks_before_the_test_command_runs(script, project, specs, tmp_path):
    """Spec 346/REQ-1,2,5: the acceptance-criteria gate must answer before
    the test-record gate ever gets a chance to shell out to the project's
    test command. No test-run.json record exists here, so the pre-fix
    order would have run AIDE_TEST_CMD (dropping the marker file) before
    reaching the unticked row."""
    configure(project, specs)
    marker = tmp_path / "marker"
    (project / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={specs}\nAIDE_TEST_CMD=touch {marker}\n")
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + acceptance(["| REQ-1: does the thing | ⬜ | |"]),
    )
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "acceptance-criteria-unticked", out
    assert not marker.exists(), "the test command must never run before the acceptance gate answers"
    assert (specs / "81-x").exists()


def test_implement_absent_with_every_row_ticked_is_not_implemented_yet(script, project, specs):
    """The other half of AC4: even a checklist that reads fully done
    cannot stand in for the "Workflow steps completed" line actually
    naming implement — a hand-ticked box is not a run that happened."""
    configure(project, specs)
    body = status_md("create, analyze", phase("Phase 1: RED", ["| a | ✅ | |"]))
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "not-implemented-yet", out
    assert (specs / "81-x").exists(), "nothing may be moved on this path"


def test_specs_dir_is_read_from_not_just_conflict_checked(project, specs, script, tmp_path):
    """The bug behind specs 287, 288, 290 and 291 (2026-08-31): a
    headless run passes its own rebased per-run worktree as
    `--specs-dir`, but every status-file read fell back to the
    CONFIGURED `AIDE_SPECS_PATH` instead — the shared, un-rebased
    checkout, which still says "create, analyze" days after implement
    actually ran. Two DIFFERENT specs roots here, on purpose: the
    configured one is stale enough to refuse `not-implemented-yet` on
    its own, and the worktree one is fully done — the script must read
    the worktree, not the configured path, exactly as `--specs-dir` is
    named to promise."""
    configure(project, specs)
    stale = status_md("create, analyze", phase("Phase 1: RED", ["| a | ⬜ | |"]))
    add_spec(specs, "81-x", stale)

    worktree_specs = init_repo(tmp_path / "worktree-specs")
    done = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"]))
    add_spec(worktree_specs, "81-x", done)
    write_test_run(worktree_specs, "81-x", git(project, "rev-parse", "HEAD"), 0)

    rc, out, _ = run(script, project, "81-x", specs_dir=worktree_specs)
    assert out["terminalReason"] == "archived", out
    assert not (worktree_specs / "81-x").exists()
    assert (worktree_specs / "archive" / "81-x").exists()
    # The stale, configured copy is untouched — this run never read it.
    assert (specs / "81-x").exists()


def test_the_move_uses_git_mv_when_the_specs_root_is_tracked(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"]))
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    run(script, project, "81-x")
    # git mv STAGES the rename ("R"), rather than leaving it as an
    # untracked/deleted pair the way a plain `mv` in a tracked repo would.
    status = git(specs, "status", "--porcelain")
    assert status.startswith("R"), status
    assert "D " not in status and "??" not in status, status


def test_running_twice_after_archiving_is_idempotent(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"]))
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc1, out1, _ = run(script, project, "81-x")
    assert out1["terminalReason"] == "archived", out1

    rc2, out2, _ = run(script, project, "81-x")
    assert rc2 == 0, out2
    assert out2["terminalReason"] == "already-archived", out2
    assert out2["specFolder"] == "archive/81-x"

    text = (specs / "archive" / "81-x" / "4-status.md").read_text()
    assert text.count("**Archived:**") == 1, text


def test_the_result_file_carries_the_same_json_as_stdout(script, project, specs, tmp_path):
    configure(project, specs)
    add_spec(specs, "81-x")
    result_file = tmp_path / "result.json"
    rc, out, _ = run(script, project, "81-x", result_file=result_file)
    assert json.loads(result_file.read_text()) == out


# --- the test-record gate (spec 329) --------------------------------------
#
# REQ-4: archive refuses without a passing test-run.json record for the
# exact commit being merged — or, only when that commit is a genuine
# two-parent base-catch-up merge, its first parent. A record for any
# OTHER earlier commit (real, untested work added afterward) must still
# refuse — the must-fix regression case from the plan review.


DONE_BODY = phase("Phase 1: RED", ["| a | ✅ | |"])












# --- spec 355: the state file --------------------------------------------


def test_archiving_writes_the_state_file_at_the_archive_location(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"]))
    add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "archived", out
    assert not (specs / "81-x" / "4-status.json").exists()
    state = json.loads((specs / "archive" / "81-x" / "4-status.json").read_text())
    assert state["completedPhases"] == ["create", "analyze", "implement"]
    assert state["archived"]["date"]


def test_the_acceptance_criteria_gate_reads_the_state_file_not_the_prose(script, project, specs):
    """REQ-3: constructing a state file that DISAGREES with the prose
    (an unticked row in 4-status.md, but a state file already claiming
    it done) proves the gate follows the state file, not a fresh
    re-parse of the prose beside it."""
    configure(project, specs)
    body = status_md("create, analyze, implement", acceptance(["| REQ-1: x | ⬜ | |"]))
    spec_dir = add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    (spec_dir / "4-status.json").write_text(json.dumps({
        "completedPhases": ["create", "analyze", "implement"],
        "archived": None, "reopened": None,
        "acceptanceCriteria": [{"task": "REQ-1: x", "done": True}],
        "phaseCounts": {"Acceptance criteria": {"done": 1, "total": 1}},
    }))
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "archived", out


def test_the_implement_present_check_reads_the_state_file_not_the_prose(script, project, specs):
    """REQ-3: a state file already claiming `implement` lets archive
    proceed past not-implemented-yet even though the prose line itself
    only names `create, analyze` — proving the check no longer
    re-`sed`s the prose."""
    configure(project, specs)
    body = status_md("create, analyze", DONE_BODY)
    spec_dir = add_spec(specs, "81-x", body)
    write_test_run(specs, "81-x", git(project, "rev-parse", "HEAD"), 0)
    (spec_dir / "4-status.json").write_text(json.dumps({
        "completedPhases": ["create", "analyze", "implement"],
        "archived": None, "reopened": None,
        "acceptanceCriteria": [], "phaseCounts": {},
    }))
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] != "not-implemented-yet", out


# --- scoped test commands (spec 361, REQ-8) ---------------------------------
#
# The gate no longer reads a single `AIDE_TEST_CMD` string — it resolves
# through `aide-resolve-test-cmd` and runs every command that resolves,
# each one its own marker-file `touch`, the same style the fixtures above
# already use for "did the gate actually run this command".


def scoped_configure(project, specs, marker_core, marker_dash):
    (project / ".aide").mkdir(exist_ok=True)
    (project / ".aide" / "config").write_text(
        f"AIDE_SPECS_PATH={specs}\n"
        f"AIDE_TEST_SCOPE_PATHS_1=core\n"
        f"AIDE_TEST_SCOPE_CMD_1=touch {marker_core}\n"
        f"AIDE_TEST_SCOPE_PATHS_2=dashboard\n"
        f"AIDE_TEST_SCOPE_CMD_2=touch {marker_dash}\n"
    )


def branch_with_change(project, *rel_paths):
    """Off `init_repo`'s own `main` — see aide_test_scope_base_ref: no
    origin configured in these fixtures, so it falls back to the local
    `main` branch, and a feature branch gives the resolver's own
    `git diff` real content to read."""
    git(project, "switch", "-q", "-c", "feature")
    for rel in rel_paths:
        p = project / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("change\n")
    git(project, "add", "-A")
    git(project, "commit", "-qm", "touch " + " ".join(rel_paths))





def test_a_spec_with_no_state_file_yet_answers_correctly_from_prose(script, project, specs):
    """A spec that predates spec 355 has no 4-status.json at all — the
    gate must still answer correctly, derived from the prose, not refuse
    or silently pass.

    Spec 356 (REQ-3): the gate's own pre-check (may_apply_spec_transition)
    is read-only and must leave the spec byte-for-byte unchanged on a
    refusal, so it no longer self-heals 4-status.json into existence the
    way the plain state-file read it replaced used to — only a granted
    move (through apply_spec_transition) writes the state file now."""
    configure(project, specs)
    body = status_md("create, analyze", checklist(["| a | ⬜ | |"]))
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "not-implemented-yet", out
    assert not (specs / "81-x" / "4-status.json").exists()
