"""An analyze may find that what the spec asks for already holds. The runner
accepts that, and tells the board so with `noChangeNeeded` on the result,
only when the description allows it (`- **Completion without changes:**
allowed`) and the newest round's `### No change needed` names a check that
passed, why, and no files to change. Every other analysis is read as before.
"""

import json
import re

import pytest

from ...conftest import READ_SPECS, git, run
from ..run_spec_results import RESULT_OK
from ..run_spec_status_files import with_status

CHECK = "grep -n Files core/scripts/lib/files-to-change.sh"
WHY = "the section is already read from the newest round"


def _describe(workspace, allowed):
    lines = ["# Queue - Description", "", "## Tracking info", "", "- **Task:** `81-queue-and-runner/`",
             "- **Created:** `2026-10-29 20:42 UTC`"]
    if allowed:
        lines.append("- **Completion without changes:** allowed")
    lines += ["- **Acceptance criteria checks:** off", "", "## Description", "", "- **AC-1:** the thing 1"]
    (workspace["specs"] / workspace["folder"] / "1-description.md").write_text("\n".join(lines) + "\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "describe the spec")


def _analysis(analysis, files, verdict):
    text = (f"# Queue - Analysis\n\n## Tracking info\n\n- **Analysis:** {analysis}\n\n## Findings\n\n"
            "### Files to change\n\n")
    text += "".join(f"- `{f}`\n" for f in files) if files else "- None — the requested condition already holds\n"
    if verdict is not None:
        text += "\n### No change needed\n\n" + "".join(f"- **{k}:** {v}\n" for k, v in verdict.items())
    return text


def _analyze(runner, workspace, fake_claude, *, allowed=True, analysis="full", files=(), verdict=None):
    if verdict is None:
        verdict = {"Check": f"`{CHECK}`", "Result": "passed", "Why": WHY}
    with_status(workspace, ["create"])
    _describe(workspace, allowed)
    folder = workspace["folder"]
    body = (
        "cat > /dev/null\n" + READ_SPECS
        + f'cat > "$specs/{folder}/2-analysis.md" <<\'ANALYSISEOF\'\n' + _analysis(analysis, files, verdict) + "ANALYSISEOF\n"
        + f'cat > "$specs/{folder}/3-solution.md" <<\'SOLUTIONEOF\'\n'
        + "# Queue - Solution\n\n## Tracking info\n\n- **Grade:** LOW\n- **Acceptance criteria:** 1\n\n"
        + "## No change needed\n\nNo plan.\n" + "SOLUTIONEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'\n"
    )
    rc, out, _, err = run(runner, workspace, fake_claude(body), command="analyze", return_stderr=True)
    assert rc == 0, out
    return out, err


def _said(err):
    return [m.group(1) for m in re.finditer(r"^aide-run-spec \d\d:\d\d:\d\d \+\d+s (no change needed.*)$", err, re.M)]


@pytest.mark.parametrize("analysis", ["short", "full"])
def test_an_allowed_and_passed_check_completes_the_analyze_with_no_change_needed_on_the_result_ac_1(
    runner, workspace, fake_claude, analysis
):
    out, _ = _analyze(runner, workspace, fake_claude, analysis=analysis)
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert out["noChangeNeeded"] == {"check": CHECK, "why": WHY}, out


def test_the_run_log_names_the_check_and_why_it_passed_ac_2(runner, workspace, fake_claude):
    _, err = _analyze(runner, workspace, fake_claude)
    assert _said(err) == [f"no change needed: {CHECK} passed — {WHY}"], err


def test_without_the_description_line_a_short_analysis_with_no_files_is_still_refused_ac_3(
    runner, workspace, fake_claude
):
    out, _ = _analyze(runner, workspace, fake_claude, allowed=False, analysis="short")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "short-analysis-over-limit", out
    assert "no files to change were recorded" in out["errorLog"], out
    assert "noChangeNeeded" not in out, out


UNVERIFIED = [
    ("not-passed", {"Check": CHECK, "Result": "failed", "Why": WHY}),
    ("no-check", {"Check": "", "Result": "passed", "Why": WHY}),
    ("no-why", {"Check": CHECK, "Result": "passed", "Why": ""}),
]


@pytest.mark.parametrize("verdict", [v for _, v in UNVERIFIED], ids=[n for n, _ in UNVERIFIED])
def test_an_unverified_record_on_a_full_analysis_completes_without_the_field_ac_3(
    runner, workspace, fake_claude, verdict
):
    out, err = _analyze(runner, workspace, fake_claude, verdict=verdict)
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert "noChangeNeeded" not in out, out
    assert [l for l in _said(err) if l.startswith("no change needed:")] == [], err


def test_a_record_beside_files_to_change_is_not_accepted_ac_3(runner, workspace, fake_claude):
    out, _ = _analyze(runner, workspace, fake_claude, files=["src/a.ts"])
    assert out["ok"] is True, out
    assert "noChangeNeeded" not in out, out


def test_an_unverified_record_on_a_short_analysis_with_no_files_is_still_refused_ac_3(
    runner, workspace, fake_claude
):
    out, _ = _analyze(runner, workspace, fake_claude, analysis="short", verdict=dict(UNVERIFIED)["not-passed"])
    assert out["ok"] is False, out
    assert out["terminalReason"] == "short-analysis-over-limit", out
    assert "no files to change were recorded" in out["errorLog"], out
    assert "noChangeNeeded" not in out, out


def test_a_check_that_passes_on_code_an_earlier_implement_left_unmerged_is_not_accepted_ac_3(
    runner, workspace, fake_claude
):
    project = workspace["project"]
    git(project, "switch", "-q", "-c", "aide/81-queue-and-runner")
    (project / "feature.txt").write_text("written by the earlier implement\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "earlier implement")
    git(project, "switch", "-q", "main")
    out, err = _analyze(runner, workspace, fake_claude)
    assert out["ok"] is True, out
    assert "noChangeNeeded" not in out, out
    assert "not accepted as no change needed: the spec's branch holds code not yet on the default branch" in err, err
