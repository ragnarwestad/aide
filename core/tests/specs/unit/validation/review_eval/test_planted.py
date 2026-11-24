"""scripts/review_eval/planted.py: preparing a planted or clean case, scoring what the review, the verification and
the judge answered, and the report of a run."""
import json
import subprocess

import planted

PLANTED = {"id": "1-planted", "spec": "1", "commit": "abc", "kind": "planted", "patch": "p.patch",
           "defect": "An empty list gives 1 instead of 0."}
CLEAN = {"id": "2-clean", "spec": "2", "commit": "def", "kind": "clean"}
TWO = "review: 2 defect(s) found\n1. The empty list counts as one.\n2. A name with a space is cut."
THREE = "review: 3 defect(s) found\n1. one\n2. two\n3. three"


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout


def _repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "t")
    (repo / "count.py").write_text("def count(xs):\n    return len(xs)\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "commit")
    return repo


def test_a_planted_patch_is_applied_uncommitted_and_shows_in_the_diff_ac_1(tmp_path):
    repo = _repo(tmp_path)
    (repo / "count.py").write_text("def count(xs):\n    return len(xs) or 1\n")
    patch = tmp_path / "p.patch"
    patch.write_text(_git(repo, "diff"))
    _git(repo, "checkout", "--", "count.py")

    assert planted.apply_patch(repo, patch) is None

    assert "return len(xs) or 1" in _git(repo, "diff", "HEAD")
    assert len(_git(repo, "log", "--format=%H").split()) == 1


def test_a_patch_that_does_not_apply_gives_the_case_an_error_and_no_score_ac_1(tmp_path):
    repo = _repo(tmp_path)
    (tmp_path / "p.patch").write_text("--- a/nothing.py\n+++ b/nothing.py\n@@ -1 +1 @@\n-a\n+b\n")
    asked = []

    outcome = planted.run_case(PLANTED, repo, "HEAD", tmp_path / "d.md", tmp_path, "(headless)", "{known}{new}",
                               build=lambda *a: "prompt", ask=lambda role, text: asked.append(role) or "")

    assert outcome["error"]
    assert not set(planted.FIGURES["planted"]) & set(outcome)
    assert asked == []


def test_a_planted_defect_named_and_kept_is_found_and_kept_and_the_rest_count_as_other_ac_2():
    outcome = planted.score_case(PLANTED, TWO, "keep 1\ndrop 2. no", '{"1": "planted", "2": "new"}')

    assert outcome["found"] is True and outcome["kept"] is True
    assert outcome["other"] == 1
    assert "error" not in outcome


def test_a_planted_defect_the_review_did_not_name_is_neither_found_nor_kept_ac_2():
    missed = planted.score_case(PLANTED, TWO, "keep 1\nkeep 2", '{"1": "new", "2": "new"}')
    silent = planted.score_case(PLANTED, "review: no defects found", None, None)

    for outcome in (missed, silent):
        assert outcome["found"] is False and outcome["kept"] is False
    assert missed["other"] == 2 and silent["other"] == 0


def test_a_clean_case_counts_every_finding_raised_and_kept_as_false_ac_2():
    outcome = planted.score_case(CLEAN, THREE, "drop 1. no\nkeep 2\ndrop 3. no", None)

    assert outcome["false_review"] == 3 and outcome["false_kept"] == 1


def test_a_clean_case_with_no_findings_has_none_and_runs_no_verification_ac_2(tmp_path):
    asked = []
    replies = {"review": "review: no defects found"}

    outcome = planted.run_case(CLEAN, tmp_path, "HEAD", tmp_path / "d.md", tmp_path, "(headless)", "{known}{new}",
                               build=lambda *a: "prompt", ask=lambda role, text: asked.append(role) or replies[role])

    assert outcome["false_review"] == 0 and outcome["false_kept"] == 0
    assert asked == ["review"]


def test_the_measured_prompts_carry_the_worktree_as_the_project_directory(tmp_path):
    built = []
    replies = {"review": TWO, "verify": "keep 1\nkeep 2", "judge": '{"1": "new", "2": "new"}'}

    planted.run_case(CLEAN, tmp_path, "fork1", tmp_path / "d.md", tmp_path, "(headless)", "{known}{new}",
                     build=lambda *a: built.append(a) or "prompt", ask=lambda role, text: replies[role])

    assert [b[0] for b in built] == ["review_prompt", "verify_prompt"]
    assert all(b[-1] == str(tmp_path) for b in built)


def test_a_judge_answer_without_json_leaves_found_and_kept_not_measured_ac_2():
    outcome = planted.score_case(PLANTED, TWO, "keep 1\nkeep 2", "I cannot tell.")

    assert outcome["found"] == planted.NOT_MEASURED and outcome["kept"] == planted.NOT_MEASURED
    assert "judge" in outcome["error"]


def test_an_empty_verification_reply_leaves_kept_not_measured_ac_2():
    planted_case = planted.score_case(PLANTED, TWO, "", '{"1": "planted", "2": "new"}')
    clean_case = planted.score_case(CLEAN, THREE, "  \n", None)

    assert planted_case["found"] is True and planted_case["kept"] == planted.NOT_MEASURED
    assert clean_case["false_review"] == 3 and clean_case["false_kept"] == planted.NOT_MEASURED
    assert "verification" in planted_case["error"] and "verification" in clean_case["error"]


def test_a_figure_not_measured_counts_in_no_total_ac_2():
    outcomes = [
        {"id": "a", "kind": "planted", **planted.score_case(PLANTED, TWO, "keep 1", '{"1": "planted", "2": "new"}')},
        {"id": "b", "kind": "planted", **planted.score_case(PLANTED, TWO, "", '{"1": "planted", "2": "new"}')},
        {"id": "c", "kind": "planted", **planted.score_case(PLANTED, TWO, "keep 1", "no json")},
    ]

    totals = planted.totals(outcomes)

    assert totals["found"] == {"sum": 2, "cases": 2}
    assert totals["kept"] == {"sum": 1, "cases": 1}


def test_the_report_has_a_line_per_case_and_the_json_holds_the_same_outcomes_and_totals_ac_2(tmp_path):
    outcomes = [
        {"id": "1-planted", "kind": "planted", "sha256": "x", **planted.score_case(PLANTED, TWO, "keep 1\nkeep 2", '{"1": "planted", "2": "new"}')},
        {"id": "3-planted", "kind": "planted", "sha256": "y", **planted.score_case(PLANTED, TWO, "keep 1\nkeep 2", '{"1": "new", "2": "new"}')},
        {"id": "2-clean", "kind": "clean", "sha256": "z", **planted.score_case(CLEAN, THREE, "drop 1. no\nkeep 2\ndrop 3. no", None)},
        {"id": "4-clean", "kind": "clean", "sha256": "w", **planted.score_case(CLEAN, "no verdict line", None, None)},
    ]

    head = planted.write_results(tmp_path, {"tool": "codex"}, outcomes)

    data = json.loads((tmp_path / "results.json").read_text())
    report = (tmp_path / "results.md").read_text()
    assert data["setup"] == {"tool": "codex"}
    assert data["cases"] == outcomes
    assert data["totals"] == planted.totals(outcomes)
    assert data["totals"]["found"] == {"sum": 1, "cases": 2}
    assert data["totals"]["false_review"] == {"sum": 3, "cases": 1}
    assert head in report
    lines = {line.split(":")[0][2:]: line for line in report.splitlines() if line.startswith("- ")}
    assert set(lines) == {"1-planted", "3-planted", "2-clean", "4-clean"}
    assert " found" in lines["1-planted"] and "not found" in lines["3-planted"]
    assert "3" in lines["2-clean"]
    assert "review:" in lines["4-clean"]


def test_a_judge_answer_that_names_not_every_finding_leaves_found_and_kept_not_measured_ac_2():
    for answer in ("{}", '{"1": "planted"}'):
        outcome = planted.score_case(PLANTED, TWO, "keep 1\nkeep 2", answer)

        assert outcome["found"] == planted.NOT_MEASURED and outcome["kept"] == planted.NOT_MEASURED, answer
        assert planted.totals([{"kind": "planted", **outcome}])["found"] == {"sum": 0, "cases": 0}


def test_a_verification_reply_with_no_keep_or_drop_line_leaves_kept_not_measured_ac_2():
    clean_case = planted.score_case(CLEAN, "review: 1 defect(s) found\n1. one", "Error: rate limit exceeded", None)
    planted_case = planted.score_case(PLANTED, TWO, "Error: rate limit exceeded", '{"1": "planted", "2": "new"}')

    assert clean_case["false_review"] == 1 and clean_case["false_kept"] == planted.NOT_MEASURED
    assert planted_case["found"] is True and planted_case["kept"] == planted.NOT_MEASURED
    assert "verification" in clean_case["error"]
