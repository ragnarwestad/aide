"""scripts/plan_eval/rubric.py: the judge's prompt, reading its answer, and the verdict computed from it."""
import json
import re

import pytest

import cases
import rubric

from .conftest import DIMENSIONS, answer, case_text, write


@pytest.fixture
def case(tmp_path):
    write(tmp_path / "4.md", case_text())
    return cases.load(tmp_path / "4.md")


def build(case, document):
    return rubric.prompt(document, "DESCRIPTION-MARKER", case, "ORIGINAL-MARKER", "NEW-MARKER")


@pytest.mark.parametrize("document", ["analysis", "plan"])
def test_a_prompt_carries_every_dimensions_anchors_the_expected_assessment_and_only_its_own_document_ac_2(case, document):
    text = build(case, document)

    for dimension in DIMENSIONS:
        for score in (1, 3, 5):
            assert rubric.ANCHORS[dimension][score] in text
    assert "DESCRIPTION-MARKER" in text and "NEW-MARKER" in text
    for item in ("R1", "C1", "T1"):
        assert item in text
    original = re.search(r"<original_[a-z]+>\n(.*?)\n</original_[a-z]+>", text, re.S)
    assert original and original.group(1) == "ORIGINAL-MARKER"
    under_evaluation = re.search(r"<new_[a-z]+>\n(.*?)\n</new_[a-z]+>", text, re.S)
    assert under_evaluation and under_evaluation.group(1) == "NEW-MARKER"
    assert rubric.DOCUMENTS[document] in text


def test_the_analysis_and_the_plan_are_asked_their_own_questions_ac_2(case):
    analysis, plan = build(case, "analysis"), build(case, "plan")

    assert rubric.QUESTIONS["analysis"]["tests"] in analysis and rubric.QUESTIONS["analysis"]["tests"] not in plan
    assert rubric.QUESTIONS["plan"]["tests"] in plan and rubric.QUESTIONS["plan"]["tests"] not in analysis


def test_an_omission_for_the_plan_alone_is_not_in_the_analysis_prompt_ac_3(case):
    analysis, plan = build(case, "analysis"), build(case, "plan")

    assert "Omission S1 is missed" in analysis and "Omission S2 is missed" not in analysis
    assert "Omission S1 is missed" in plan and "Omission S2 is missed" in plan


def test_a_whole_answer_gives_each_dimension_a_score_a_reason_and_evidence_ac_2():
    judgment, why = rubric.read(answer(scores={"tests": 2}), ["S1"])

    assert why is None
    assert [judgment.dimensions[d].score for d in DIMENSIONS] == [4, 4, 2, 4]
    assert judgment.dimensions["code"].reason == "reason for code"
    assert judgment.dimensions["code"].evidence == ("evidence for code",)
    assert judgment.omissions["S1"].status == "covered"


def test_the_last_json_object_in_the_judges_words_is_the_answer():
    judgment, why = rubric.read("Thinking {not json} then\n" + answer(scores={"code": 5}) + "\nDone.", ["S1"])

    assert why is None and judgment.dimensions["code"].score == 5


INVALID = {
    "no JSON": ("I would rather not say.", "JSON"),
    "a missing dimension": (answer(tests=None), "tests"),
    "a missing reason": (answer(code={"reason": ""}), "code"),
    "missing evidence": (answer(approach={"evidence": []}), "approach"),
    "blank evidence": (answer(approach={"evidence": ["  "]}), "approach"),
    "a score of 0": (answer(scores={"requirements": 0}), "requirements"),
    "a score of 6": (answer(scores={"requirements": 6}), "requirements"),
    "a score of 3.5": (answer(scores={"requirements": 3.5}), "requirements"),
    "a bool for a score": (answer(scores={"requirements": True}), "requirements"),
    "a text for a score": (answer(scores={"requirements": "4"}), "requirements"),
}


@pytest.mark.parametrize("name", INVALID)
def test_an_answer_that_cannot_be_read_whole_is_invalid_and_says_why_ac_2(name):
    text, word = INVALID[name]

    judgment, why = rubric.read(text, ["S1"])

    assert judgment is None and word in why


def test_an_answer_leaving_out_an_omission_that_applies_is_invalid_never_pass_ac_3():
    verdict = rubric.judge(answer(scores={d: 5 for d in DIMENSIONS}, omissions={}), ["S1"])

    assert verdict.outcome == "invalid" and "S1" in verdict.why


@pytest.mark.parametrize("omission", [{"status": "partly", "evidence": "x"}, {"status": "covered", "evidence": ""}])
def test_an_omission_with_an_unknown_status_or_no_evidence_is_invalid_ac_3(omission):
    text = json.loads(answer())
    text["omissions"] = {"S1": omission}

    assert rubric.judge(json.dumps(text), ["S1"]).outcome == "invalid"


def test_a_missed_serious_omission_fails_whatever_the_scores_and_names_the_item_ac_3():
    verdict = rubric.judge(answer(scores={d: 5 for d in DIMENSIONS}, omissions={"S1": "missed"}), ["S1"])

    assert verdict.outcome == "fail" and "S1" in verdict.why and verdict.mean == 5


def test_the_same_answer_with_every_omission_covered_passes_ac_3():
    verdict = rubric.judge(answer(scores={d: 5 for d in DIMENSIONS}, omissions={"S1": "covered"}), ["S1"])

    assert verdict.outcome == "pass" and verdict.why == ""


def test_an_omission_that_applies_only_to_the_other_document_cannot_fail_this_one_ac_3():
    verdict = rubric.judge(answer(omissions={"S1": "covered", "S2": "missed"}), ["S1"])

    assert verdict.outcome == "pass"


def test_a_mean_under_the_threshold_fails_and_says_so():
    verdict = rubric.judge(answer(scores={"requirements": 3, "code": 3, "tests": 3, "approach": 4}), ["S1"])

    assert verdict.outcome == "fail" and "mean 3.25" in verdict.why


def test_a_dimension_under_the_minimum_fails_even_with_a_passing_mean():
    verdict = rubric.judge(answer(scores={"requirements": 5, "code": 5, "tests": 2, "approach": 5}), ["S1"])

    assert verdict.outcome == "fail" and "tests 2" in verdict.why


def test_the_rubrics_identity_is_a_sha256_of_what_it_judges_by():
    assert re.fullmatch(r"[0-9a-f]{64}", rubric.IDENTITY)
