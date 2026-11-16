"""scripts/plan_eval: whole `check`, `run` and `compare` commands through main(argv), with replay's stand-in runner and
the stand-in judges."""
import json

from ..replay_specs.conftest import git, snapshot
from .conftest import answer, case_text, sha256_of, write


def runner_args(world):
    lines = (world.record("analyze", "args") or "").splitlines()
    return dict(zip(lines[::2], lines[1::2]))


def add_second_case(pilot):
    description = pilot.specs_root / "archive" / "6-second" / "1-description.md"
    write(pilot.cases / "6.md", case_text(number="6", folder="6-second", before=pilot.before["6-second"],
                                          landed=pilot.landed["6-second"], description_sha=sha256_of(description),
                                          approved="2026-11-16"))


def nothing_ran(pilot):
    assert pilot.record("analyze", "args") is None and pilot.judges.calls() == []
    assert not list(pilot.tmp.iterdir()) and not pilot.results.exists()


def refused(pilot, capsys, plan_eval_main, argv, *words):
    assert plan_eval_main(argv) == 2
    err = capsys.readouterr().err
    assert err.startswith("plan_eval: ")
    for word in words:
        assert word in err
    nothing_ran(pilot)


def run_folder(pilot):
    (folder,) = [p for p in pilot.results.iterdir() if p.is_dir()]
    return folder


def results(pilot):
    return json.loads((run_folder(pilot) / "results.json").read_text())


def test_check_reports_a_consistent_case_ready_and_calls_no_model_ac_1(pilot, plan_eval_main, capsys):
    assert plan_eval_main(pilot.check_argv()) == 0

    assert "4: ready" in capsys.readouterr().out
    nothing_ran(pilot)


def test_check_reports_an_unapproved_case_as_not_approved_and_passes_ac_1(pilot, plan_eval_main, capsys):
    pilot.write_case(approved="no")

    assert plan_eval_main(pilot.check_argv()) == 0

    assert "4: not approved" in capsys.readouterr().out


def test_check_fails_a_case_that_does_not_match_the_archive_and_says_what_differs_ac_1(pilot, plan_eval_main, capsys):
    pilot.write_case(description_sha="0" * 64)

    assert plan_eval_main(pilot.check_argv()) == 1

    assert "Description sha256" in capsys.readouterr().out
    nothing_ran(pilot)


def test_check_fails_a_malformed_case_naming_its_file_ac_1(pilot, plan_eval_main, capsys):
    write(pilot.cases / "4.md", case_text().replace("Evidence: AC-1.", ""))

    assert plan_eval_main(pilot.check_argv()) == 1

    assert str(pilot.cases / "4.md") in capsys.readouterr().out


def test_a_run_generates_from_the_pinned_commit_and_judges_the_analysis_and_the_plan_in_two_turns_ac_2(pilot, plan_eval_main, standin):
    write(standin / "analysis.md", "# Analysis\n\nNEW-ANALYSIS-MARKER\n")

    assert plan_eval_main(pilot.run_argv()) == 0

    assert runner_args(pilot)["--command"] == "analyze"
    assert pilot.record("analyze", "project-head").strip() == pilot.before["4-replayed"]
    analysis, plan = pilot.judges.calls()
    assert "NEW-ANALYSIS-MARKER" in analysis["prompt"] and "NEW-PLAN-MARKER" not in analysis["prompt"]
    assert "NEW-PLAN-MARKER" in plan["prompt"] and "NEW-ANALYSIS-MARKER" not in plan["prompt"]
    assert "ORIGINAL-PLAN-MARKER" in plan["prompt"]
    (only,) = results(pilot)
    assert only["case"] == "4" and [only["documents"][d]["outcome"] for d in ("analysis", "plan")] == ["pass", "pass"]
    folder = run_folder(pilot) / "4" / "run-1"
    for name in ("analyze.log", "analyze-result.json", "2-analysis.md", "3-solution.md", "judge-analysis.prompt.md", "judge-plan.reply.md"):
        assert (folder / name).exists(), name
    assert "| 4 | plan | 1/1 | pass |" in (run_folder(pilot) / "results.md").read_text()


def test_a_missed_omission_fails_the_document_in_the_run_ac_3(pilot, plan_eval_main):
    pilot.judges.say(answer(scores={d: 5 for d in ("requirements", "code", "tests", "approach")}, omissions={"S1": "missed", "S2": "covered"}))

    assert plan_eval_main(pilot.run_argv()) == 0

    (only,) = results(pilot)
    assert only["documents"]["plan"]["outcome"] == "fail" and "S1" in only["documents"]["plan"]["why"]


def test_repeat_generates_each_case_that_many_times_and_run_json_records_the_setup_ac_4(pilot, plan_eval_main):
    add_second_case(pilot)

    assert plan_eval_main(pilot.run_argv("--repeat", "2", "--advisor", "opus")) == 0

    records = results(pilot)
    assert [(r["case"], r["attempt"]) for r in records] == [("4", 1), ("4", 2), ("6", 1), ("6", 2)]
    assert len(pilot.judges.calls()) == 8
    folder = run_folder(pilot)
    assert all((folder / case / f"run-{k}" / "analyze.log").exists() for case in ("4", "6") for k in (1, 2))
    setup = json.loads((folder / "run.json").read_text())
    assert setup["aide_commit"] == pilot.aide.new and setup["repeat"] == 2 and setup["advisor"] == "opus"
    assert setup["analyze"] == {"tool": "claude", "model": "opus", "effort": "high"}
    assert setup["judge"] == {"tool": "claude", "model": "opus", "effort": None}
    assert len(setup["rubric"]) == 64 and setup["evaluator"]
    assert setup["cases"]["6"] == {"file_sha256": sha256_of(pilot.cases / "6.md"),
                                   "description_sha256": sha256_of(pilot.specs_root / "archive" / "6-second" / "1-description.md"),
                                   "before": pilot.before["6-second"], "landed": pilot.landed["6-second"]}


def test_a_repeat_outside_one_to_five_is_refused_before_anything_is_copied_ac_4(pilot, plan_eval_main, capsys):
    for count in ("0", "6"):
        refused(pilot, capsys, plan_eval_main, pilot.run_argv("--repeat", count), "--repeat")


def test_a_codex_analyze_and_a_codex_judge_run_with_no_api_key_or_token_set_ac_5(pilot, plan_eval_main, monkeypatch):
    for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"):
        monkeypatch.delenv(key, raising=False)
    write(pilot.home / ".codex" / "auth.json", "{}")
    monkeypatch.setenv("HOME", str(pilot.home))

    assert plan_eval_main(pilot.run_argv(analyze=("codex", "gpt-6.1-sol"), judge=("codex", "gpt-6.1-sol"))) == 0

    assert runner_args(pilot)["--tool"] == "codex"
    assert {c["tool"].strip() for c in pilot.judges.calls()} == {"codex"}
    (only,) = results(pilot)
    assert only["documents"]["plan"]["outcome"] == "pass" and only["documents"]["plan"]["judge"]["cost"] is None


def test_a_claude_analyze_needs_only_the_login_token_ac_5(pilot, plan_eval_main, monkeypatch):
    for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(key, raising=False)

    assert plan_eval_main(pilot.run_argv()) == 0

    assert results(pilot)[0]["documents"]["analysis"]["outcome"] == "pass"


def test_a_codex_judge_with_an_effort_is_refused_before_anything_is_copied_ac_5(pilot, plan_eval_main, capsys):
    refused(pilot, capsys, plan_eval_main, pilot.run_argv(judge=("codex", "gpt-6.1-sol", "high")), "effort")


def test_a_run_leaves_the_repositories_as_they_were_and_reaches_no_board_ac_7(pilot, plan_eval_main):
    before = (snapshot(pilot.code), snapshot(pilot.specs_repo), snapshot(pilot.aide.path), git(pilot.origin, "for-each-ref"))

    assert plan_eval_main(pilot.run_argv()) == 0

    assert (snapshot(pilot.code), snapshot(pilot.specs_repo), snapshot(pilot.aide.path), git(pilot.origin, "for-each-ref")) == before
    args = runner_args(pilot)
    assert args["--project-dir"] != str(pilot.code) and args["--push"] == "none"
    assert "AIDE_RUN_URL=unset" in pilot.record("analyze", "env")
    assert all("AIDE_RUN_URL=unset" in c["env"] for c in pilot.judges.calls())
    assert not list(pilot.tmp.iterdir())


def test_a_results_folder_inside_a_repository_is_refused_before_anything_is_copied_ac_7(pilot, plan_eval_main, capsys):
    argv = pilot.run_argv()
    argv[argv.index("--results") + 1] = str(pilot.specs_repo / "results")
    pilot.results = pilot.specs_repo / "results"

    refused(pilot, capsys, plan_eval_main, argv, "results")


def test_an_unapproved_case_is_refused_naming_its_file_before_anything_runs_ac_8(pilot, plan_eval_main, capsys):
    pilot.write_case(approved="no")

    refused(pilot, capsys, plan_eval_main, pilot.run_argv(), str(pilot.cases / "4.md"), "Approved: no")


def test_an_approved_case_whose_description_changed_is_refused_before_anything_runs_ac_8(pilot, plan_eval_main, capsys):
    pilot.write_case(description_sha="0" * 64)

    refused(pilot, capsys, plan_eval_main, pilot.run_argv(), "4", "Description sha256")


def test_an_approved_case_pinned_to_a_commit_the_checkout_lacks_is_refused_before_anything_runs_ac_8(pilot, plan_eval_main, capsys):
    pilot.write_case(before="1" * 40)

    refused(pilot, capsys, plan_eval_main, pilot.run_argv(), "1" * 40)


def test_an_analyze_that_does_not_complete_is_no_result_and_nothing_is_judged(pilot, plan_eval_main, standin):
    write(standin / "analyze-result.json", '{"ok":false,"terminalReason":"timeout","costUsd":0.1}')

    assert plan_eval_main(pilot.run_argv()) == 0

    (only,) = results(pilot)
    assert only["problem"] == "analyze ended timeout" and only["documents"] == {} and pilot.judges.calls() == []
    assert only["generation"]["cost"] == 0.1


def test_compare_writes_the_comparison_of_a_baseline_and_one_alternative_ac_4(pilot, plan_eval_main, capsys):
    assert plan_eval_main(pilot.run_argv()) == 0
    assert plan_eval_main(pilot.run_argv(analyze=("claude", "sonnet"))) == 0
    base, alternative = sorted(p for p in pilot.results.iterdir() if p.is_dir())

    assert plan_eval_main(["compare", str(base), str(alternative)]) == 0

    text = (alternative / "comparison.md").read_text()
    assert "analyze: claude opus high → claude sonnet" in text


def test_compare_refuses_two_runs_of_the_same_setup_ac_4(pilot, plan_eval_main, capsys):
    assert plan_eval_main(pilot.run_argv()) == 0
    assert plan_eval_main(pilot.run_argv()) == 0
    base, alternative = sorted(p for p in pilot.results.iterdir() if p.is_dir())

    assert plan_eval_main(["compare", str(base), str(alternative)]) == 2

    assert "none" in capsys.readouterr().err and not (alternative / "comparison.md").exists()
