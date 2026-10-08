"""scripts/replay_specs/measure.py: the readers that turn a replayed spec's files, log and stream into the table's cells."""
import json
import sys

import measure
from .conftest import commit, init_repo, write

FENCE = "`" * 3


def test_the_newest_plan_review_gives_the_counts_and_a_fenced_example_is_not_one_AC_5():
    text = "\n".join([
        "## Plan review", "", "**Findings:** 5 must-fix, 9 should-fix, 14 acted on", "",
        "## Round 2", "", "## Plan review", "", FENCE + "text", "**Findings:** 9 must-fix, 9 should-fix, 9 acted on", FENCE, "",
        "**Findings:** 1 must-fix, 4 should-fix, 5 acted on", "",
    ])

    counts = measure.plan_review_counts(text)

    assert (counts.must, counts.should) == (1, 4)


def test_a_plan_with_no_review_or_no_counts_says_which_AC_5():
    assert measure.plan_review_counts("# Plan\n\n## Risk analysis\n").note == "no plan review"
    no_counts = measure.plan_review_counts("## Plan review\n\n**Verdicts.** fine\n")
    assert (no_counts.must, no_counts.should, no_counts.note) == (None, None, "no counts")


DESCRIPTION = "- **AC-1:** one\n- **AC-2:** two\n- **AC-3:** three\n"


def solution(*bullets):
    return "\n".join(["## Testing", "", "### Where the tests sit", "", *bullets, "", "### Unit tests", "", "- AC-9 is not a place"])


def test_every_criterion_has_a_place_when_the_bullets_name_them_all_wrapped_or_not_AC_5():
    wrapped = "- **`parse`** in `t.py` (new) — AC-1,\n  AC-3"
    assert measure.unplaced_criteria(DESCRIPTION, solution(wrapped)) == "no: AC-2"
    assert measure.unplaced_criteria(DESCRIPTION, solution(wrapped, "- **`x`** in `u.py` (new) — AC-2")) == "yes"


def test_a_plan_without_the_subsection_or_a_description_without_criteria_says_so_AC_5():
    assert measure.unplaced_criteria(DESCRIPTION, "## Testing\n\n### Unit tests\n") == "no such subsection"
    assert measure.unplaced_criteria("No criteria here.\n", solution("- x")) == "no criteria"


def test_implement_rounds_are_one_plus_every_hand_back_the_log_names_AC_6():
    log = "\n".join([
        "aide-run-spec 10:00:00 +1s preparing",
        "aide-run-spec 10:20:00 +1200s the review found 2 defect(s) — handing them to the session",
        "aide-run-spec 10:30:00 +1800s the tests are red — handing them back to the session (round 1 of 3)",
        "aide-run-spec 10:40:00 +2400s the tests are red — handing them back to the session (round 2 of 3)",
    ])
    assert measure.implement_rounds(log) == 4
    assert measure.implement_rounds("aide-run-spec 10:00:00 +1s preparing\n") == 1


def test_a_step_is_green_when_it_completed_with_a_green_run_of_its_own_AC_6():
    assert measure.implement_green({"terminalReason": "completed", "testedGreen": {"tree": "x"}}) == "yes"
    assert measure.implement_green({"terminalReason": "tests-red"}) == "no"
    assert measure.implement_green({"terminalReason": "completed"}) == "no test command"
    assert measure.implement_green({"terminalReason": "timeout"}) == "–"


def test_the_original_tests_are_the_test_files_a_landing_added_or_changed_AC_6(tmp_path):
    repo = init_repo(tmp_path / "code")
    before = commit(repo, {"test_b.py": "def test_b(): pass\n", "src/b.py": "b = 0\n"})
    landed = commit(repo, {"test/a.test.ts": "x", "src/a.ts": "a", "test_b.py": "def test_b(): assert 1\n"})

    assert measure.original_test_files(str(repo), before, landed) == ["test/a.test.ts", "test_b.py"]


def junit(*cases):
    body = "".join(f'<testcase name="{n}">{inner}</testcase>' for n, inner in cases)
    return f'<?xml version="1.0"?><testsuites><testsuite name="s">{body}</testsuite></testsuites>'


def test_junit_counts_add_the_cases_that_passed_of_those_that_ran_and_leave_skipped_ones_out_AC_6(tmp_path):
    pytest_xml = write_file(tmp_path / "py.xml", junit(("a", ""), ("b", ""), ("c", "<failure>no</failure>")))
    bun_xml = write_file(tmp_path / "bun.xml", junit(("d", ""), ("e", "<skipped/>")))

    assert measure.junit_counts([pytest_xml, bun_xml]) == (3, 4)


def write_file(path, text):
    write(path, text)
    return str(path)


def test_a_test_file_is_run_on_its_own_and_its_cases_counted_AC_6(tmp_path):
    work = tmp_path / "work"
    write(work / "test_two.py", "def test_a():\n    pass\n\n\ndef test_b():\n    assert False\n")
    write(work / "notes.sh", "echo hi\n")

    assert measure.run_test_file(str(work), "test_two.py", python=sys.executable) == (1, 2)
    assert measure.run_test_file(str(work), "notes.sh", python=sys.executable) is None


def test_step_tokens_sum_every_turn_in_the_stream_not_the_last_AC_8(tmp_path):
    claude = tmp_path / "claude.jsonl"
    claude.write_text("\n".join(json.dumps(e) for e in [
        {"type": "assistant", "usage": {"input_tokens": 99999}},
        {"type": "result", "modelUsage": {"a": {"inputTokens": 100, "outputTokens": 10, "cacheReadInputTokens": 50, "cacheCreationInputTokens": 5},
                                           "b": {"inputTokens": 1, "outputTokens": 1}}},
        {"type": "result", "usage": {"input_tokens": 10, "output_tokens": 2, "cache_read_input_tokens": 3, "cache_creation_input_tokens": 4}},
        {"type": "result", "modelUsage": {"a": {"inputTokens": 1000}}},
    ]) + "\nnot json\n")
    codex = tmp_path / "codex.jsonl"
    codex.write_text("\n".join(json.dumps(e) for e in [
        {"type": "turn.completed", "usage": {"input_tokens": 100, "output_tokens": 10, "reasoning_output_tokens": 5, "cached_input_tokens": 50}},
        {"type": "turn.completed", "usage": {"input_tokens": 1, "output_tokens": 1}},
        {"type": "item.completed"},
    ]))

    assert measure.step_tokens(str(claude), "claude") == 167 + 19 + 1000
    assert measure.step_tokens(str(codex), "codex") == 165 + 2
    assert measure.step_tokens(str(tmp_path / "missing.jsonl"), "claude") is None
