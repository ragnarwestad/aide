"""After an `analyze` whose turn ends `completed`, the runner writes one
line of its own into the step's log: the plan review's counts, read from
the `**Findings:**` line the analyze skill opens its Plan review section
with, and where to read the findings — or that the plan has no Plan
review section, or that the section gives no counts.
"""

import json
import re
from pathlib import Path

from ...conftest import READ_SPECS, run
from ..run_spec_status_files import with_status

PLAN_REVIEW_REFERENCE = (
    Path(__file__).resolve().parents[8] / "core" / "skills" / "aide-analyze" / "references" / "plan-review.md"
)

COUNTS_TAIL = " — the findings are under Plan review in the plan (3-solution.md)"
NO_SECTION = "plan review: the plan (3-solution.md) has no Plan review section"
NO_COUNTS = "plan review: the Plan review section in the plan (3-solution.md) gives no counts — the findings are there"
PARTS_OPENED = "--- Step Aide: tests and commit — started"

RESULT_OK = {
    "type": "result", "subtype": "success", "is_error": False,
    "session_id": "ee80227f-510c-45e9-bfbf-c5124f7761c0", "total_cost_usd": 0.1, "num_turns": 1,
    "terminal_reason": "completed", "result": "done",
}


def _stamped(err):
    return [m.group(1) for m in re.finditer(r"^aide-run-spec \d\d:\d\d:\d\d \+\d+s (.+)$", err, re.M)]


def _plan_review_lines(stages):
    return [s for s in stages if s.startswith("plan review:")]


def _analyze(runner, workspace, fake_claude, solution=None):
    """An analyze whose session writes 2-analysis.md and, when given,
    `solution` as 3-solution.md, then reports success. Returns its
    stamped lines and its whole stderr."""
    with_status(workspace, ["create"])
    folder = workspace["folder"]
    body = "cat > /dev/null\n" + READ_SPECS + f'echo "analysis" > "$specs/{folder}/2-analysis.md"\n'
    if solution is not None:
        body += f'cat > "$specs/{folder}/3-solution.md" <<\'SOLUTIONEOF\'\n' + solution + "SOLUTIONEOF\n"
    body += f"echo '{json.dumps(RESULT_OK)}'\n"
    rc, out, _, err = run(runner, workspace, fake_claude(body), command="analyze", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    return _stamped(err), err


def _solution(plan_review):
    return (
        "# Queue - Solution\n\n## Acceptance criteria\n\n1. **AC-1** — the thing\n\n"
        + plan_review
        + "\n## Risk analysis\n\nNone.\n"
    )


def test_the_counts_line_is_logged_with_a_pointer_to_the_section_AC_1(runner, workspace, fake_claude):
    stages, _ = _analyze(runner, workspace, fake_claude, _solution(
        "## Plan review\n\n**Findings:** 2 must-fix, 3 should-fix, 4 acted on\n\n**Must-fix (2):**\n\n1. a\n2. b\n"
    ))
    line = "plan review: 2 must-fix, 3 should-fix, 4 acted on" + COUNTS_TAIL
    assert _plan_review_lines(stages) == [line], stages
    assert stages.index(line) > stages.index(PARTS_OPENED), stages


def test_the_findings_line_as_the_skill_shows_it_reads_AC_1(runner, workspace, fake_claude):
    examples = [
        line.strip() for line in PLAN_REVIEW_REFERENCE.read_text().splitlines()
        if line.strip().startswith("**Findings:**")
    ]
    assert examples, "plan-review.md shows no **Findings:** line"
    example = examples[0]
    numbers = re.findall(r"\d+", example)
    assert len(numbers) == 3, example
    stages, _ = _analyze(runner, workspace, fake_claude, _solution(f"## Plan review\n\n{example}\n"))
    lines = _plan_review_lines(stages)
    assert len(lines) == 1, stages
    assert re.findall(r"\d+", lines[0].split(" — ")[0]) == numbers, lines


def test_a_held_back_rounds_own_review_is_the_one_logged_AC_1(runner, workspace, fake_claude):
    stages, _ = _analyze(runner, workspace, fake_claude, _solution(
        "## Plan review\n\n**Findings:** 1 must-fix, 1 should-fix, 1 acted on\n\n"
        "## Round 2\n\n"
        "### Round 2: acceptance criteria\n\n1. **AC-1** — again\n\n"
        "### Round 2: plan review\n\n**Findings:** 0 must-fix, 2 should-fix, 2 acted on\n\n"
        "### Round 2: risk analysis\n\nNone.\n\n"
        "#### Round 2: Phase 1\n\n**Findings:** 9 must-fix, 9 should-fix, 9 acted on\n"
    ))
    assert _plan_review_lines(stages) == ["plan review: 0 must-fix, 2 should-fix, 2 acted on" + COUNTS_TAIL], stages


def test_a_section_without_a_findings_line_gives_no_counts_AC_1(runner, workspace, fake_claude):
    stages, _ = _analyze(runner, workspace, fake_claude, _solution(
        "## Plan review\n\n**Must-fix (1):**\n\n1. The thing — *Revised.*\n"
    ))
    assert _plan_review_lines(stages) == [NO_COUNTS], stages


def test_an_analyze_that_does_not_complete_or_an_implement_logs_no_plan_review_line_AC_1(
    runner, workspace, fake_claude
):
    with_status(workspace, ["create"])
    rc, out, _, err = run(runner, workspace, fake_claude("cat > /dev/null\nexit 1\n"), command="analyze", return_stderr=True)
    assert out["terminalReason"] != "completed", out
    assert _plan_review_lines(_stamped(err)) == [], err

    with_status(workspace, ["create", "analyze"])
    claude = fake_claude(
        "prompt=\"$(cat)\"\n"
        "if printf '%s' \"$prompt\" | grep -q \"Read this spec's own description\"; then\n"
        f"  echo '{json.dumps({**RESULT_OK, 'result': 'review: no defects found'})}'\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  echo '{json.dumps(RESULT_OK)}'\n"
        "fi\n"
    )
    rc, out, _, err = run(runner, workspace, claude, command="implement", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert _plan_review_lines(_stamped(err)) == [], err


def test_a_review_that_found_nothing_logs_zero_for_both_AC_2(runner, workspace, fake_claude):
    stages, _ = _analyze(runner, workspace, fake_claude, _solution(
        "## Plan review\n\n**Findings:** 0 must-fix, 0 should-fix, 0 acted on\n\nNothing to fix.\n"
    ))
    assert _plan_review_lines(stages) == ["plan review: 0 must-fix, 0 should-fix, 0 acted on" + COUNTS_TAIL], stages


def test_a_plan_review_quoted_in_a_fence_is_no_section_AC_3(runner, workspace, fake_claude):
    stages, _ = _analyze(runner, workspace, fake_claude, _solution(
        "## Recommended solution\n\n```markdown\n## Plan review\n\n"
        "**Findings:** 2 must-fix, 3 should-fix, 4 acted on\n```\n"
    ))
    assert _plan_review_lines(stages) == [NO_SECTION], stages


def test_an_analyze_with_no_plan_file_says_it_has_no_plan_review_AC_3(runner, workspace, fake_claude):
    stages, err = _analyze(runner, workspace, fake_claude)
    assert _plan_review_lines(stages) == [NO_SECTION], stages
    assert "can't open" not in err, err
