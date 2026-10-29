"""After an analyze turn the runner reads what the session wrote about its
own analysis (`Analysis:` in 2-analysis.md, `Grade:` and `Acceptance
criteria:` in 3-solution.md, the paths under `### Files to change`) and ends
the step failed when a SHORT analysis is over a limit. A full analysis is
only logged, never failed. The limits are the runner's own constants in
run-spec/setup/arguments.sh.
"""

import json
import re

import pytest

from ...conftest import READ_SPECS, git, run
from ..run_spec_invoking import BRANCH
from ..run_spec_project_state import ANALYSIS_LINE
from ..run_spec_results import RESULT_OK
from ..run_spec_status_files import phase_file_text, with_status

FILES = ["a.ts", "b.ts", "c.ts"]


def _describe(workspace, criteria, choose=None, checks="off", sent_back=None):
    """The spec's own description: `criteria` `- **AC-n:**` lines and the
    two Tracking-info choices the check reads, committed."""
    lines = ["# Queue - Description", "", "## Tracking info", "", "- **Task:** `81-queue-and-runner/`"]
    if choose is not None:
        lines.append(f"- **Let me choose the approach:** {choose}")
    if sent_back is not None:
        lines.append(f"- **Sent back to a full analysis:** {sent_back}")
    lines += [f"- **Acceptance criteria checks:** {checks}", "", "## Description", ""]
    lines += [f"- **AC-{n}:** the thing {n}" for n in range(1, criteria + 1)]
    (workspace["specs"] / workspace["folder"] / "1-description.md").write_text("\n".join(lines) + "\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "describe the spec")


def _analysis(analysis_line, files):
    tracking = [analysis_line] if analysis_line else []
    return (
        "# Queue - Analysis\n\n## Tracking info\n\n" + "".join(f"{l}\n" for l in tracking)
        + "\n## Findings\n\n### Files to change\n\n" + "".join(f"- `{f}`\n" for f in files)
    )


def _solution(grade, recorded_criteria):
    tracking = [l for l in (f"- **Grade:** {grade}" if grade else None,
                            f"- **Acceptance criteria:** {recorded_criteria}" if recorded_criteria is not None else None) if l]
    return "# Queue - Solution\n\n## Tracking info\n\n" + "".join(f"{l}\n" for l in tracking) + "\n## Short analysis\n\nNo plan.\n"


def _analyze(
    runner, workspace, fake_claude, *, analysis_line="- **Analysis:** short", grade="LOW", criteria=3,
    recorded_criteria=None, files=FILES, choose=None, checks="off", sent_back=None,
):
    """An analyze whose session writes the three fields and reports success;
    the description has `criteria` acceptance criteria."""
    with_status(workspace, ["create"])
    _describe(workspace, criteria, choose, checks, sent_back)
    folder = workspace["folder"]
    body = (
        "cat > /dev/null\n" + READ_SPECS
        + f'cat > "$specs/{folder}/2-analysis.md" <<\'ANALYSISEOF\'\n' + _analysis(analysis_line, files) + "ANALYSISEOF\n"
        + f'cat > "$specs/{folder}/3-solution.md" <<\'SOLUTIONEOF\'\n'
        + _solution(grade, criteria if recorded_criteria is None else recorded_criteria) + "SOLUTIONEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'\n"
    )
    rc, out, _, err = run(runner, workspace, fake_claude(body), command="analyze", return_stderr=True)
    assert rc == 0, out
    return out, err


def _log(err):
    return [m.group(1) for m in re.finditer(r"^aide-run-spec \d\d:\d\d:\d\d \+\d+s (short analysis: .+)$", err, re.M)]


def _failed_on_a_limit(out, said):
    assert out["ok"] is False, out
    assert out["terminalReason"] == "short-analysis-over-limit", out
    assert said in out["error"], out["error"]
    assert "Press Analyze again" in out["error"], out["error"]


def test_a_short_analysis_within_every_limit_completes_and_says_so(runner, workspace, fake_claude):
    out, err = _analyze(runner, workspace, fake_claude)
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert _log(err) == [
        "short analysis: short — grade LOW, 3 acceptance criteria, 3 files to change, 3 of them source files"
        " — within the limits, the step completes"
    ], err


def test_a_short_analysis_with_more_than_three_criteria_completes(runner, workspace, fake_claude):
    out, err = _analyze(runner, workspace, fake_claude, criteria=8)
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert _log(err) == [
        "short analysis: short — grade LOW, 8 acceptance criteria, 3 files to change, 3 of them source files"
        " — within the limits, the step completes"
    ], err


@pytest.mark.parametrize("level", ["warn", "stop"])
def test_a_short_analysis_is_not_failed_for_the_criteria_checks_level(runner, workspace, fake_claude, level):
    out, _ = _analyze(runner, workspace, fake_claude, checks=level)
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out


def test_a_full_analysis_over_every_limit_completes(runner, workspace, fake_claude):
    out, err = _analyze(
        runner, workspace, fake_claude, analysis_line="- **Analysis:** full", grade="HIGH", criteria=5,
        files=[f"f{n}.ts" for n in range(7)],
    )
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert _log(err) == [
        "short analysis: full — grade HIGH, 5 acceptance criteria, 7 files to change, 7 of them source files — the step completes"
    ], err


def test_a_short_analysis_for_a_spec_that_asks_to_choose_the_approach_fails(runner, workspace, fake_claude):
    out, _ = _analyze(runner, workspace, fake_claude, choose="yes")
    _failed_on_a_limit(out, "it asks to choose the approach")


@pytest.mark.parametrize("case", ANALYSIS_LINE, ids=[c["name"] for c in ANALYSIS_LINE])
def test_the_analysis_line_is_read_as_the_shared_table_says(runner, workspace, fake_claude, case):
    out, err = _analyze(runner, workspace, fake_claude, analysis_line=case["line"])
    assert out["ok"] is True, out
    assert [l.split(" — ")[0] for l in _log(err)] == [f"short analysis: {case['analysis']}"], err


def test_every_completed_analyze_logs_the_analysis_the_grade_and_both_counts(runner, workspace, fake_claude):
    _, err = _analyze(runner, workspace, fake_claude, analysis_line=None, grade="MEDIUM", criteria=4, files=["a.ts"])
    assert _log(err) == [
        "short analysis: full — grade MEDIUM, 4 acceptance criteria, 1 files to change, 1 of them source files — the step completes"
    ], err


def test_a_short_analysis_over_the_files_limit_fails_the_step(runner, workspace, fake_claude):
    out, _ = _analyze(runner, workspace, fake_claude, criteria=2, files=[f"f{n}.ts" for n in range(5)])
    _failed_on_a_limit(out, "it has 5 source files to change, over the limit of 3 (f0.ts, f1.ts, f2.ts, f3.ts, f4.ts)")
    subject = git(workspace["specs"], "log", "-1", "--pretty=%s", BRANCH)
    assert subject.endswith("(stopped: short-analysis-over-limit)"), subject
    tree = git(workspace["specs"], "ls-tree", "-r", "--name-only", BRANCH)
    state_path = f"{workspace['folder']}/4-status.json"
    if state_path in tree.splitlines():
        assert "analyze" not in json.loads(phase_file_text(workspace, state_path))["completedPhases"]


@pytest.mark.parametrize("criteria, recorded", [(4, 3), (2, 9)])
def test_the_larger_of_the_two_criteria_counts_is_logged_and_limits_nothing(
    runner, workspace, fake_claude, criteria, recorded
):
    out, err = _analyze(runner, workspace, fake_claude, criteria=criteria, recorded_criteria=recorded)
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert [f"{max(criteria, recorded)} acceptance criteria" in l for l in _log(err)] == [True], err


@pytest.mark.parametrize(
    "fields, said",
    [({"grade": None}, "no grade was recorded"), ({"files": []}, "no files to change were recorded")],
    ids=["no-grade", "no-files"],
)
def test_a_short_analysis_that_cannot_show_it_is_within_the_limits_fails(runner, workspace, fake_claude, fields, said):
    out, _ = _analyze(runner, workspace, fake_claude, **fields)
    _failed_on_a_limit(out, said)


@pytest.mark.parametrize("grade", ["MEDIUM", "HIGH"])
def test_a_short_analysis_graded_above_low_fails(runner, workspace, fake_claude, grade):
    out, _ = _analyze(runner, workspace, fake_claude, grade=grade)
    _failed_on_a_limit(out, f"it is graded {grade}, not LOW")


def test_every_limit_crossed_is_named_and_the_criteria_are_not_one(runner, workspace, fake_claude):
    out, _ = _analyze(runner, workspace, fake_claude, grade="HIGH", criteria=8, files=[f"f{n}.ts" for n in range(5)])
    for said in ("it is graded HIGH, not LOW",
                 "it has 5 source files to change, over the limit of 3 (f0.ts, f1.ts, f2.ts, f3.ts, f4.ts)"):
        assert said in out["error"], out["error"]
    assert "acceptance criteria" not in out["error"], out["error"]


def test_a_short_analysis_for_a_spec_sent_back_to_a_full_one_fails(runner, workspace, fake_claude):
    out, _ = _analyze(runner, workspace, fake_claude, sent_back="it changes the result format")
    _failed_on_a_limit(out, "it was sent back to a full analysis")


def test_a_full_analysis_for_a_spec_sent_back_completes(runner, workspace, fake_claude):
    out, _ = _analyze(
        runner, workspace, fake_claude, analysis_line="- **Analysis:** full", grade="MEDIUM",
        sent_back="it changes the result format",
    )
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out


def test_tests_and_documentation_are_not_counted_against_the_files_limit(runner, workspace, fake_claude):
    files = ["src/a.ts", "src/b.ts", "src/c.ts", "test/a.test.ts", "docs/page.md"]
    out, err = _analyze(runner, workspace, fake_claude, files=files)
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert _log(err) == [
        "short analysis: short — grade LOW, 3 acceptance criteria, 5 files to change, 3 of them source files"
        " — within the limits, the step completes"
    ], err


def test_a_short_analysis_listing_only_tests_and_documentation_completes(runner, workspace, fake_claude):
    out, err = _analyze(runner, workspace, fake_claude, files=["test/a.test.ts", "docs/page.md"])
    assert out["ok"] is True, out
    assert _log(err) == [
        "short analysis: short — grade LOW, 3 acceptance criteria, 2 files to change, 0 of them source files"
        " — within the limits, the step completes"
    ], err


@pytest.mark.parametrize(
    "path",
    ["test/x.ts", "tests/x.py", "__tests__/x.js", "e2e/x.ts", "src/x.test.ts", "src/x.spec.ts", "src/test_x.py",
     "src/x_test.go", "README.md"],
)
def test_a_path_that_is_a_test_or_a_markdown_file_is_not_counted(runner, workspace, fake_claude, path):
    out, _ = _analyze(runner, workspace, fake_claude, files=[*(f"src/{f}" for f in FILES), path])
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out


@pytest.mark.parametrize("path", ["src/latest.ts", "src/testing/helper.ts", "src/attest_x.py", "src/tests.ts"])
def test_a_path_that_only_looks_like_a_test_is_counted(runner, workspace, fake_claude, path):
    out, _ = _analyze(runner, workspace, fake_claude, files=[*(f"src/{f}" for f in FILES), path])
    _failed_on_a_limit(out, "it has 4 source files to change")


def test_the_crossing_sentence_names_the_source_files_it_counted(runner, workspace, fake_claude):
    sources = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]
    out, _ = _analyze(runner, workspace, fake_claude, files=[*sources, "test/a.test.ts", "README.md"])
    _failed_on_a_limit(out, "it has 4 source files to change, over the limit of 3 (src/a.ts, src/b.ts, src/c.ts, src/d.ts)")
    assert "test/a.test.ts" not in out["error"] and "README.md" not in out["error"], out["error"]
