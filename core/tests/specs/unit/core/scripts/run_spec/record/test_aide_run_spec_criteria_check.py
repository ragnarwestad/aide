"""At a spec's `criteriaChecks: stop`, an analyze whose plan review names a fault in
its `**Criteria check:**` line ends stopped on the acceptance criteria;
at `off` and `warn` it completes. The runner reads the line the analyze
skill writes and never judges the criteria itself.
"""

import json
import re
from pathlib import Path

import pytest

from ...conftest import READ_SPECS, git, run
from ..run_spec_invoking import BRANCH
from ..run_spec_project_state import configure_criteria_checks
from ..run_spec_results import RESULT_OK
from ..run_spec_status_files import phase_file_text, with_status

PLAN_REVIEW_REFERENCE = (
    Path(__file__).resolve().parents[8] / "core" / "skills" / "aide-analyze" / "references" / "plan-review.md"
)


def _solution(criteria_line):
    line = f"{criteria_line}\n" if criteria_line is not None else ""
    return (
        "# Queue - Solution\n\n## Acceptance criteria\n\n1. **AC-1** — the thing\n\n"
        "## Plan review\n\n**Findings:** 0 must-fix, 1 should-fix, 0 acted on\n" + line
        + "\n## Risk analysis\n\nNone.\n"
    )


def _analyze(runner, workspace, fake_claude, level, criteria_line, extra=""):
    """An analyze at `level` whose session writes 3-solution.md with
    `criteria_line` under its Findings line, then reports success."""
    with_status(workspace, ["create"])
    configure_criteria_checks(workspace, level)
    folder = workspace["folder"]
    body = (
        "cat > /dev/null\n" + READ_SPECS
        + f'echo "analysis" > "$specs/{folder}/2-analysis.md"\n'
        + f'cat > "$specs/{folder}/3-solution.md" <<\'SOLUTIONEOF\'\n' + _solution(criteria_line) + "SOLUTIONEOF\n"
        + extra
        + f"echo '{json.dumps(RESULT_OK)}'\n"
    )
    rc, out, _, err = run(runner, workspace, fake_claude(body), command="analyze", return_stderr=True)
    assert rc == 0, out
    return out, err


def _criteria_log(err):
    return [m.group(1) for m in re.finditer(r"^aide-run-spec \d\d:\d\d:\d\d \+\d+s (criteria check: .+)$", err, re.M)]


def test_a_named_fault_at_stop_ends_analyze_stopped_AC_4(runner, workspace, fake_claude):
    out, _ = _analyze(
        runner, workspace, fake_claude, "stop",
        "**Criteria check:** stop — not in EARS: AC-2, AC-4; no scenario for when the condition does not hold: AC-5",
    )
    assert out["ok"] is False, out
    assert out["terminalReason"] == "acceptance-criteria", out
    for ac in ("AC-2", "AC-4", "AC-5"):
        assert ac in out["error"], out["error"]
    assert out["criteriaFaults"] == {
        "missing": False, "notEars": ["AC-2", "AC-4"], "noScenario": ["AC-5"], "contradictions": [], "cannotBuild": [],
    }, out
    subject = git(workspace["specs"], "log", "-1", "--pretty=%s", BRANCH)
    assert subject.endswith("(stopped: acceptance-criteria)"), subject
    tree = git(workspace["specs"], "ls-tree", "-r", "--name-only", BRANCH)
    state_path = f"{workspace['folder']}/4-status.json"
    if state_path in tree.splitlines():
        assert "analyze" not in json.loads(phase_file_text(workspace, state_path))["completedPhases"]


def test_no_acceptance_criteria_at_stop_ends_analyze_stopped_AC_4(runner, workspace, fake_claude):
    out, _ = _analyze(runner, workspace, fake_claude, "stop", "**Criteria check:** stop — no acceptance criteria")
    assert out["terminalReason"] == "acceptance-criteria", out
    assert out["criteriaFaults"] == {
        "missing": True, "notEars": [], "noScenario": [], "contradictions": [], "cannotBuild": [],
    }, out


EXAMPLE_LINES = [
    line.strip() for line in PLAN_REVIEW_REFERENCE.read_text().splitlines()
    if line.strip().startswith("**Criteria check:**") and "AC-" in line
]


def test_the_skill_shows_an_example_line_for_the_contradiction_and_cannot_be_built_kinds_AC_4():
    assert any("contradiction: " in line and "cannot be built: " in line for line in EXAMPLE_LINES), EXAMPLE_LINES


@pytest.mark.parametrize("example", EXAMPLE_LINES)
def test_every_example_line_the_skill_shows_stops_on_each_id_AC_4(runner, workspace, fake_claude, example):
    ids = re.findall(r"AC-\d+", example)
    out, _ = _analyze(runner, workspace, fake_claude, "stop", example)
    assert out["terminalReason"] == "acceptance-criteria", out
    faults = out["criteriaFaults"]
    named = faults["notEars"] + faults["noScenario"] + faults["cannotBuild"]
    named += [ac for pair in faults["contradictions"] for ac in pair.split("/")]
    assert sorted(named) == sorted(ids), (example, faults)


def test_a_contradiction_at_stop_is_sorted_by_pair_AC_1_AC_4(runner, workspace, fake_claude):
    out, _ = _analyze(
        runner, workspace, fake_claude, "stop", "**Criteria check:** stop — contradiction: AC-1/AC-3, AC-2/AC-5",
    )
    assert out["terminalReason"] == "acceptance-criteria", out
    assert out["criteriaFaults"]["contradictions"] == ["AC-1/AC-3", "AC-2/AC-5"], out
    for ac in ("AC-1", "AC-2", "AC-3", "AC-5"):
        assert ac in out["error"], out["error"]


def test_a_criterion_that_cannot_be_built_at_stop_is_sorted_AC_2_AC_4(runner, workspace, fake_claude):
    out, _ = _analyze(runner, workspace, fake_claude, "stop", "**Criteria check:** stop — cannot be built: AC-6")
    assert out["terminalReason"] == "acceptance-criteria", out
    assert out["criteriaFaults"]["cannotBuild"] == ["AC-6"], out
    assert "AC-6" in out["error"], out["error"]


def test_every_kind_on_one_line_is_sorted_into_its_own_AC_4(runner, workspace, fake_claude):
    out, _ = _analyze(
        runner, workspace, fake_claude, "stop",
        "**Criteria check:** stop — not in EARS: AC-2; contradiction: AC-1/AC-3; cannot be built: AC-6",
    )
    assert out["criteriaFaults"] == {
        "missing": False, "notEars": ["AC-2"], "noScenario": [], "contradictions": ["AC-1/AC-3"], "cannotBuild": ["AC-6"],
    }, out


def test_new_kinds_at_warn_complete_the_analysis_AC_3(runner, workspace, fake_claude):
    out, _ = _analyze(
        runner, workspace, fake_claude, "warn", "**Criteria check:** warn — contradiction: AC-1/AC-3; cannot be built: AC-6",
    )
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out


def test_new_kinds_at_off_complete_AC_5(runner, workspace, fake_claude):
    out, _ = _analyze(
        runner, workspace, fake_claude, "off", "**Criteria check:** stop — contradiction: AC-1/AC-3; cannot be built: AC-6",
    )
    assert out["terminalReason"] == "completed", out


def test_a_fault_worded_outside_the_grammar_still_stops_AC_4(runner, workspace, fake_claude):
    out, _ = _analyze(runner, workspace, fake_claude, "stop", "**Criteria check:** stop — AC-1 is vague")
    assert out["terminalReason"] == "acceptance-criteria", out
    assert "AC-1 is vague" in out["error"], out["error"]
    assert out["criteriaFaults"] == {
        "missing": False, "notEars": [], "noScenario": [], "contradictions": [], "cannotBuild": [],
    }, out


def test_none_found_at_stop_completes_and_says_what_was_read_AC_4(runner, workspace, fake_claude):
    out, err = _analyze(runner, workspace, fake_claude, "stop", "**Criteria check:** stop — none found")
    assert out["terminalReason"] == "completed", out
    assert "criteriaFaults" not in out, out
    assert _criteria_log(err) and "none found" in _criteria_log(err)[0], err


def test_a_plan_review_with_no_criteria_line_at_stop_completes_and_says_so_AC_4(runner, workspace, fake_claude):
    out, err = _analyze(runner, workspace, fake_claude, "stop", None)
    assert out["terminalReason"] == "completed", out
    assert _criteria_log(err), err


def test_a_scope_violation_is_decided_before_the_criteria_AC_4(runner, workspace, fake_claude):
    out, _ = _analyze(
        runner, workspace, fake_claude, "stop", "**Criteria check:** stop — not in EARS: AC-1",
        extra='mkdir -p "$specs/999-made-by-the-run" && echo "# 999" > "$specs/999-made-by-the-run/1-description.md"\n',
    )
    assert out["terminalReason"] == "scope-violation", out


def test_a_fault_at_off_completes_AC_4(runner, workspace, fake_claude):
    out, _ = _analyze(runner, workspace, fake_claude, "off", "**Criteria check:** stop — not in EARS: AC-1")
    assert out["terminalReason"] == "completed", out


def test_faults_at_warn_complete_the_analysis_AC_3(runner, workspace, fake_claude):
    out, _ = _analyze(
        runner, workspace, fake_claude, "warn", "**Criteria check:** warn — not in EARS: AC-2; no acceptance criteria",
    )
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out


def test_faults_with_no_level_recorded_complete_the_analysis_AC_5(runner, workspace, fake_claude):
    out, _ = _analyze(runner, workspace, fake_claude, None, "**Criteria check:** warn — not in EARS: AC-2")
    assert out["terminalReason"] == "completed", out


def test_a_missing_scenario_at_stop_ends_analyze_stopped_AC_6(runner, workspace, fake_claude):
    out, _ = _analyze(
        runner, workspace, fake_claude, "stop",
        "**Criteria check:** stop — no scenario for when the condition does not hold: AC-3",
    )
    assert out["terminalReason"] == "acceptance-criteria", out
    assert out["criteriaFaults"]["noScenario"] == ["AC-3"], out
