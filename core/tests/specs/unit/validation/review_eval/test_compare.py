"""scripts/review_eval/compare.py: the difference between two planted runs."""
import json

import compare

NM = "not measured"


def _run(setup, *cases):
    return {"setup": setup, "cases": list(cases), "totals": {}}


def _planted(case_id, found, kept, sha="s"):
    return {"id": case_id, "kind": "planted", "sha256": sha, "found": found, "kept": kept, "other": 0}


def _clean(case_id, raised, kept, sha="s"):
    return {"id": case_id, "kind": "clean", "sha256": sha, "false_review": raised, "false_kept": kept}


def test_two_runs_of_the_same_cases_give_the_change_per_case_and_in_total_ac_3():
    a = _run({"model": "a"}, _planted("1-planted", False, False), _planted("2-planted", True, False), _clean("3-clean", 4, 2))
    b = _run({"model": "b"}, _planted("1-planted", True, True), _planted("2-planted", True, True), _clean("3-clean", 1, 0))

    diff = compare.compare(a, b)

    assert diff["cases"]["1-planted"] == {"found": (0, 1, 1), "kept": (0, 1, 1)}
    assert diff["cases"]["3-clean"] == {"false_review": (4, 1, -3), "false_kept": (2, 0, -2)}
    assert diff["totals"] == {"found": (1, 2, 1), "kept": (0, 2, 2), "false_review": (4, 1, -3), "false_kept": (2, 0, -2)}
    assert diff["apart"] == {}


def test_a_case_in_one_run_changed_or_not_measured_is_listed_apart_and_left_out_of_the_totals_ac_3():
    a = _run({}, _planted("1-planted", True, True), _planted("2-planted", True, True, sha="old"),
             _planted("3-planted", True, NM), _clean("4-clean", 2, 1))
    b = _run({}, _planted("2-planted", False, False, sha="new"), _planted("3-planted", False, False),
             _clean("4-clean", 0, 0), _clean("5-clean", 3, 3))

    diff = compare.compare(a, b)

    assert set(diff["apart"]) == {"1-planted", "2-planted", "3-planted", "5-clean"}
    assert "changed" in diff["apart"]["2-planted"]
    assert NM in diff["apart"]["3-planted"]
    assert set(diff["cases"]) == {"4-clean"}
    assert diff["totals"]["found"] == (0, 0, 0)
    assert diff["totals"]["false_review"] == (2, 0, -2)


def test_the_comparison_is_written_into_the_second_runs_folder(tmp_path):
    for name, found in (("a", False), ("b", True)):
        (tmp_path / name).mkdir()
        (tmp_path / name / "results.json").write_text(json.dumps(_run({"model": name}, _planted("1-planted", found, found))))

    text = compare.main(tmp_path / "a", tmp_path / "b")

    assert (tmp_path / "b" / "comparison.md").read_text() == text
    assert "1-planted" in text
