"""scripts/plan_eval/report.py: results.md for a run, whether two runs can be compared, and comparison.md."""
import copy

import pytest

import report

from .conftest import DIMENSIONS

SHA = "f" * 40


def identity(**changes):
    value = {
        "project": "aide", "aide_commit": SHA, "analyze": {"tool": "claude", "model": "opus", "effort": "high"}, "advisor": None,
        "judge": {"tool": "claude", "model": "opus", "effort": None}, "rubric": "r" * 64, "repeat": 2, "evaluator": "e" * 40,
        "cases": {"640": {"file_sha256": "1" * 64, "description_sha256": "2" * 64, "before": "3" * 40, "landed": "4" * 40}},
    }
    value.update(changes)
    return value


def stats(seconds=90.0, tokens=330, cost=1.5):
    return {"seconds": seconds, "tokens": tokens, "cost": cost}


def judged(outcome="pass", scores=None, missed=(), why="", judge=None):
    scores = scores or {d: 4 for d in DIMENSIONS}
    return {"outcome": outcome, "why": why, "mean": sum(scores.values()) / 4,
            "dimensions": {d: {"score": s, "reason": f"{d} reason", "evidence": [f"{d} evidence"]} for d, s in scores.items()},
            "omissions": {"S1": {"status": "missed" if "S1" in missed else "covered", "evidence": "where S1 is"}},
            "judge": judge if judge is not None else stats(2.0, 15, 0.25)}


def invalid(why='"tests" has no evidence'):
    return {"outcome": "invalid", "why": why, "mean": None, "dimensions": {}, "omissions": {}, "judge": stats(2.0, 15, 0.25)}


def record(case="640", attempt=1, generation=None, problem=None, analysis=None, plan=None):
    documents = {} if problem else {"analysis": analysis or judged(), "plan": plan or judged()}
    return {"case": case, "attempt": attempt, "generation": generation if generation is not None else stats(),
            "problem": problem, "documents": documents}


def rows(text):
    lines = [[c.strip() for c in line.strip().strip("|").split("|")] for line in text.splitlines() if line.startswith("|")]
    return [dict(zip(lines[0], line)) for line in lines[2:]]


def test_each_row_shows_the_generations_and_the_judges_time_tokens_and_cost_as_measured_ac_6():
    text = report.render_run(identity(), [record()])

    analysis, plan = rows(text)
    assert (analysis["Case"], analysis["Document"], analysis["Run"], analysis["Outcome"]) == ("640", "analysis", "1/2", "pass")
    assert analysis["Generation time/tokens/cost"] == "1m30s · 330 · $1.50"
    assert analysis["Judge time/tokens/cost"] == "2s · 15 · $0.25"
    assert [analysis[d.capitalize()] for d in DIMENSIONS] == ["4", "4", "4", "4"] and analysis["Mean"] == "4.00"


def test_the_runs_identities_head_the_report_ac_4():
    text = report.render_run(identity(advisor="opus"), [record()])

    head = text.split("|", 1)[0]
    for part in (SHA, "claude opus high", "advisor opus", "judge claude opus", "r" * 64, "1" * 64, "3" * 40, "4" * 40):
        assert part in head


def test_missing_figures_read_not_measured_and_the_totals_say_how_many_were_measured_ac_6():
    records = [record(generation=stats(tokens=None, cost=None), plan=judged(judge=stats(3.0, None, None))),
               record(attempt=2, generation=stats(cost=None))]

    text = report.render_run(identity(), records)

    first = rows(text)[0]
    assert first["Generation time/tokens/cost"] == "1m30s · not measured · not measured"
    assert rows(text)[1]["Judge time/tokens/cost"] == "3s · not measured · not measured"
    totals = text.split("## Totals", 1)[1]
    generation = next(line for line in totals.splitlines() if line.startswith("- Generation"))
    assert "330 (1 of 2 measured)" in generation and "not measured (0 of 2 measured)" in generation
    assert "$0.00" not in text


def test_an_invalid_judgment_says_why_and_counts_in_neither_the_pass_count_nor_the_ranges_ac_6():
    records = [record(plan=judged(scores={"requirements": 5, "code": 5, "tests": 5, "approach": 5})),
               record(attempt=2, plan=invalid())]

    text = report.render_run(identity(), records)

    second_plan = rows(text)[3]
    assert second_plan["Outcome"] == "invalid" and "has no evidence" in second_plan["Why"]
    summary = text.split("## Per case and document", 1)[1].split("##", 1)[0]
    plan_line = next(line for line in summary.splitlines() if "640 · plan" in line)
    assert "pass 1 of 2" in plan_line and "invalid 1" in plan_line and "requirements 5," in plan_line
    problems = text.split("## Invalid judgments and attempts with no result", 1)[1]
    assert "640 · plan · run 2/2: invalid — \"tests\" has no evidence" in problems


def test_a_failed_judgment_names_the_omission_it_missed_and_each_dimensions_range_shows_ac_6():
    records = [record(plan=judged("fail", {"requirements": 5, "code": 5, "tests": 5, "approach": 5}, missed=("S1",),
                                  why="serious omission S1 missed (mean 5.00 would pass)")),
               record(attempt=2, plan=judged(scores={"requirements": 3, "code": 4, "tests": 3, "approach": 4}))]

    text = report.render_run(identity(), records)

    first_plan = rows(text)[1]
    assert first_plan["Outcome"] == "fail" and first_plan["Missed"] == "S1" and "S1 missed" in first_plan["Why"]
    summary = text.split("## Per case and document", 1)[1].split("##", 1)[0]
    plan_line = next(line for line in summary.splitlines() if "640 · plan" in line)
    assert "pass 1 of 2" in plan_line and "fail 1" in plan_line
    assert "requirements 3–5" in plan_line and "code 4–5" in plan_line and "S1 missed 1 of 2" in plan_line


def test_an_attempt_with_no_result_says_how_it_ended_ac_6():
    records = [record(), record(attempt=2, generation=stats(cost=0.1), problem="analyze ended timeout")]

    text = report.render_run(identity(), records)

    ended = [r for r in rows(text) if r["Run"] == "2/2"]
    assert [r["Outcome"] for r in ended] == ["no result", "no result"]
    assert all(r["Why"] == "analyze ended timeout" for r in ended)
    summary = text.split("## Per case and document", 1)[1]
    assert "no result 1" in summary
    problems = text.split("## Invalid judgments and attempts with no result", 1)[1]
    assert "640 · run 2/2: no result — analyze ended timeout" in problems


def test_the_judges_reasons_and_evidence_are_in_the_report_ac_6():
    text = report.render_run(identity(), [record()])

    reasons = text.split("## The judge's reasons and evidence", 1)[1]
    assert "tests (4): tests reason — evidence: tests evidence" in reasons
    assert "S1 covered: where S1 is" in reasons


DIFFERENT = {
    "the cases": dict(cases={"647": identity()["cases"]["640"]}),
    "a case file": dict(cases={"640": {**identity()["cases"]["640"], "file_sha256": "9" * 64}}),
    "a pinned commit": dict(cases={"640": {**identity()["cases"]["640"], "before": "9" * 40}}),
    "the rubric": dict(rubric="9" * 64),
    "the judge": dict(judge={"tool": "codex", "model": "gpt-6.1-sol", "effort": None}),
    "the repeat count": dict(repeat=3),
}


@pytest.mark.parametrize("what", DIFFERENT)
def test_two_runs_that_do_not_share_what_is_held_fixed_are_refused_naming_the_difference_ac_4(what):
    refusal, difference = report.comparable(identity(), identity(analyze={"tool": "claude", "model": "sonnet", "effort": None}, **DIFFERENT[what]))

    assert difference is None and what.split()[-1] in refusal


def test_two_runs_that_differ_in_none_of_the_setup_are_refused_ac_4():
    refusal, difference = report.comparable(identity(), identity(evaluator="0" * 40))

    assert difference is None and "none" in refusal


def test_two_runs_that_differ_in_more_than_one_part_of_the_setup_are_refused_ac_4():
    refusal, difference = report.comparable(identity(), identity(aide_commit="0" * 40, advisor="opus"))

    assert difference is None and "Aide commit" in refusal and "advisor" in refusal


@pytest.mark.parametrize("change,name", [(dict(aide_commit="0" * 40), "Aide commit"), (dict(advisor="opus"), "advisor"),
                                         (dict(analyze={"tool": "codex", "model": "gpt-6.1-sol", "effort": None}), "analyze")])
def test_two_runs_that_differ_in_exactly_one_part_of_the_setup_are_comparable_ac_4(change, name):
    refusal, difference = report.comparable(identity(), identity(**change))

    assert refusal is None and difference == name


def test_the_comparison_shows_both_setups_per_case_document_and_dimension_with_totals_and_counts_ac_6():
    base = {"identity": identity(), "records": [
        record(plan=judged(scores={"requirements": 2, "code": 4, "tests": 3, "approach": 4})),
        record(attempt=2, plan=judged(scores={"requirements": 4, "code": 4, "tests": 5, "approach": 4})),
    ]}
    alternative = {"identity": identity(analyze={"tool": "claude", "model": "sonnet", "effort": None}), "records": [
        record(plan=judged("fail", missed=("S1",)), generation=stats(cost=None)),
        record(attempt=2, problem="analyze ended timeout", generation=stats(cost=None)),
    ]}
    base["records"].append(copy.deepcopy(base["records"][0]) | {"attempt": 3})
    base["identity"]["repeat"] = alternative["identity"]["repeat"] = 3
    alternative["records"].append(record(attempt=3, plan=invalid()))

    text = report.render_comparison(base, alternative)

    assert "analyze: claude opus high → claude sonnet" in text
    table = rows(text)
    base_plan = next(r for r in table if r["Case"] == "640" and r["Document"] == "plan" and r["Setup"] == "baseline")
    alt_plan = next(r for r in table if r["Case"] == "640" and r["Document"] == "plan" and r["Setup"] == "alternative")
    assert base_plan["Requirements"] == "2–2–4" and base_plan["Tests"] == "3–3–5" and base_plan["Pass"] == "3 of 3"
    assert alt_plan["Pass"] == "0 of 3" and alt_plan["Missed"] == "S1 1 of 1" and alt_plan["Invalid"] == "1" and alt_plan["No result"] == "1"
    totals = text.split("## Totals", 1)[1]
    alt_line = next(line for line in totals.splitlines() if line.startswith("- alternative, generation"))
    assert "(1 of 3 measured)" in alt_line and "invalid 1" in totals and "no result 1" in totals
