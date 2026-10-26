"""scripts/review_eval/replies.py: reading a review's and a verification's answers, and scoring them."""
import replies


def test_the_defects_are_the_numbered_lines_after_the_last_review_line_and_a_wrapped_one_is_joined():
    text = "I looked.\nreview: 1 defect(s) found\n1. an old one\n\nreview: 2 defect(s) found\n1. the first\n   goes on\n2. the second\n"

    assert replies.review_defects(text) == ["the first goes on", "the second"]


def test_no_defects_is_an_empty_list_and_a_reply_without_the_line_is_none():
    assert replies.review_defects("All good.\nreview: no defects found\n") == []
    assert replies.review_defects("1. something is wrong\n") is None


def test_a_defect_the_verification_gives_no_line_for_is_kept():
    text = "Checked.\nkeep 1\ndrop 2. the guard is at x.ts:10\nkeep 9\n"

    assert replies.decisions(text, 3) == {1: ("keep", ""), 2: ("drop", "the guard is at x.ts:10"), 3: ("keep", "no line for it")}


def test_a_verification_scores_real_kept_false_dropped_and_unclear_kept():
    findings = [{"id": "a", "verdict": "real"}, {"id": "b", "verdict": "real"},
                {"id": "c", "verdict": "false"}, {"id": "d", "verdict": "unclear"}]
    decided = {"a": ("keep", ""), "b": ("drop", ""), "c": ("drop", ""), "d": ("keep", "")}

    score = replies.verify_score(findings, decided)

    assert (score["real kept"], score["real"], score["false dropped"], score["unclear kept"]) == (1, 2, 1, 1)


def test_the_judges_match_to_an_id_it_was_not_given_counts_as_new():
    answer = 'Here: {"1": "known-a", "2": "made-up", "3": "new"}'

    assert replies.matches(answer, 3, {"known-a"}) == {1: "known-a", 2: "new", 3: "new"}


def test_a_review_run_counts_each_labelled_finding_it_matched_once():
    labelled = [{"id": "r", "verdict": "real"}, {"id": "r2", "verdict": "real"}, {"id": "f", "verdict": "false"}]

    score = replies.review_score(labelled, ["r", "r", "f", "new"])

    assert score == {"real": 2, "real found": 1, "false reported": 1, "unclear reported": 0, "new": 1}
