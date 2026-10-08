"""scripts/replay_specs: whole runs through main(argv), with a stand-in runner, judge and gh."""
import os
import re
import signal
import subprocess
import sys
import time

import pytest

from .conftest import SCRIPT_DIR, git, judge_says, snapshot, write

PLAN = """# Plan

## Plan review

**Findings:** 1 must-fix, 2 should-fix, 3 acted on

## Testing

### Where the tests sit

- **`parse`** in `t.py` (new) — AC-1, AC-2
"""


def args_of(world, step):
    lines = (world.record(step, "args") or "").splitlines()
    return dict(zip(lines[::2], lines[1::2]))


def table(text):
    """The rows of results.md's table as {column: cell}."""
    rows = [[c.strip() for c in line.strip().strip("|").split("|")] for line in text.splitlines() if line.startswith("|")]
    return [dict(zip(rows[0], row)) for row in rows[2:]]


def results_text(world):
    return (world.run_folder() / "results.md").read_text()


def test_analyze_then_implement_run_in_a_copy_at_the_commit_before_the_landing_AC_1(world, replay_main):
    argv = world.argv("4-replayed", analyze=("claude", "opus", "high"), implement=("codex", "gpt-6.1-sol"))

    assert replay_main(argv) == 0

    analyze, implement = args_of(world, "analyze"), args_of(world, "implement")
    assert [analyze[k] for k in ("--command", "--tool", "--model", "--effort")] == ["analyze", "claude", "opus", "high"]
    assert [implement[k] for k in ("--command", "--tool", "--model")] == ["implement", "codex", "gpt-6.1-sol"]
    assert "--effort" not in implement
    for step in ("analyze", "implement"):
        assert args_of(world, step)["--project-dir"] != str(world.code)
        assert world.record(step, "project-head").strip() == world.before["4-replayed"]
    assert "NEW-PLAN-MARKER" in world.record("implement", "solution")
    assert world.record("analyze", "venv-link").strip() == str(world.code / ".venv")
    assert ".aide" in world.record("analyze", "project-files").split()


def test_an_analyze_that_does_not_complete_leaves_implement_uncalled_and_the_row_says_how_it_ended_AC_1(world, replay_main, standin):
    write(standin / "analyze-result.json", '{"ok":false,"terminalReason":"timeout","costUsd":0.1}')

    assert replay_main(world.argv("4-replayed")) == 0

    assert world.record("implement", "args") is None
    assert "analyze ended timeout" in table(results_text(world))[0]["Note"]


def test_a_specs_root_holds_the_spec_and_an_empty_folder_per_dependency_and_no_state_files_AC_2(world, replay_main):
    assert replay_main(world.argv("4-replayed")) == 0

    listing = set(world.record("analyze", "specs-listing").split())
    assert listing == {".", "./4-replayed", "./archive", "./archive/1-nolanding", "./4-replayed/0-README.md", "./4-replayed/1-description.md",
                       "./4-replayed/2-analysis.md", "./4-replayed/3-solution.md", "./4-replayed/4-status.md"}
    archived = (world.specs_root / "archive" / "4-replayed" / "1-description.md").read_text()
    assert world.record("analyze", "description") == archived
    assert world.record("analyze", "analysis").startswith("# 4-replayed - Analysis")


def test_the_runner_the_skills_the_rules_and_the_scripts_are_those_of_the_aide_commit_given_AC_3(world, replay_main):
    assert replay_main(world.argv("4-replayed", commit_=world.aide.old, analyze=("claude", "opus"))) == 0

    assert "mark=v1" in world.record("analyze", "env")
    assert "CLAUDE_CONFIG_DIR=unset" not in world.record("analyze", "env")
    assert world.record("analyze", "claude-skill") == "skill aide-analyze v1\n"
    assert world.record("analyze", "claude-skills").split() == ["aide-analyze", "aide-implement"]
    assert world.record("analyze", "claude-rules").split() == ["git.md", "llm-discipline.md"]
    assert "write-spec v1" in world.record("analyze", "write-spec")


def test_a_codex_step_gets_the_commits_skills_a_linked_login_and_the_installed_skills_switched_off_AC_3(world, replay_main, monkeypatch):
    write(world.home / ".agents" / "skills" / "aide-analyze" / "SKILL.md", "installed\n")
    write(world.home / ".codex" / "auth.json", "{}")
    monkeypatch.setenv("HOME", str(world.home))

    assert replay_main(world.argv("4-replayed", analyze=("codex", "gpt-6.1-sol"), implement=("codex", "gpt-6.1-sol"))) == 0

    assert world.record("analyze", "codex-agents") == "agents v2\n"
    assert world.record("analyze", "codex-skills").split() == ["aide-analyze", "aide-implement", "spec-structure"]
    assert world.record("analyze", "codex-auth").strip() == str(world.home / ".codex" / "auth.json")
    config = world.record("analyze", "codex-config")
    assert f'path = "{world.home}/.agents/skills/aide-analyze/SKILL.md"' in config and "enabled = false" in config


def refused(world, capsys, replay_main, argv, sentence):
    assert replay_main(argv) == 2
    assert sentence in capsys.readouterr().err
    assert not list(world.tmp.iterdir()) and not world.results.exists()
    assert world.record("analyze", "args") is None


def test_a_claude_step_with_no_login_token_is_refused_before_anything_is_copied_AC_3(world, replay_main, capsys, monkeypatch):
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    refused(world, capsys, replay_main, world.argv("4-replayed"), "claude setup-token")


def test_an_aide_commit_whose_runner_has_no_worktree_base_is_refused_before_anything_is_copied_AC_3(world, replay_main, capsys, make_aide_repo):
    old = make_aide_repo(takes_worktree_base=False, name="aide-old")

    refused(world, capsys, replay_main, world.argv("4-replayed", commit_=old.new, extra=("--aide-repo", str(old.path))), "--worktree-base")


def test_an_aide_commit_the_repository_does_not_know_is_refused_before_anything_is_copied_AC_3(world, replay_main, capsys):
    refused(world, capsys, replay_main, world.argv("4-replayed", commit_="0123456789abcdef0123456789abcdef01234567"), "0123456789abcdef")


def test_the_repositories_are_left_as_they_were_and_nothing_reaches_an_origin_or_a_board_AC_4(world, replay_main):
    before = (snapshot(world.code), snapshot(world.specs_repo), git(world.origin, "for-each-ref"))

    assert replay_main(world.argv("4-replayed", "6-second")) == 0

    assert (snapshot(world.code), snapshot(world.specs_repo), git(world.origin, "for-each-ref")) == before
    for step in ("analyze", "implement"):
        args = args_of(world, step)
        assert args["--push"] == "none"
        assert args["--worktree-base"].startswith(str(world.tmp))
        assert "AIDE_RUN_URL=unset" in world.record(step, "env")
        assert world.record(step, "project-remotes").strip() == ""
    assert not list(world.tmp.iterdir())


def test_a_sigterm_during_a_step_ends_the_runners_group_and_removes_the_copies_AC_4(world, standin):
    (standin / "hang-analyze").write_text("")
    proc = subprocess.Popen([sys.executable, str(SCRIPT_DIR), *world.argv("4-replayed")], stderr=subprocess.PIPE)
    pids = [standin / "analyze" / name for name in ("pid", "child")]
    deadline = time.time() + 30
    while time.time() < deadline and not all(p.exists() for p in pids):
        time.sleep(0.1)
    assert all(p.exists() for p in pids), proc.stderr.read()
    runner, child = (int(p.read_text()) for p in pids)

    proc.send_signal(signal.SIGTERM)
    proc.wait(timeout=60)

    for pid in (runner, child):
        with pytest.raises(ProcessLookupError):
            os.kill(pid, 0)
    assert not list(world.tmp.iterdir())


def test_the_judges_score_and_reasons_reach_the_row_and_it_is_given_both_plans_AC_7(world, replay_main, standin):
    assert replay_main(world.argv("4-replayed")) == 0

    prompt = (standin / "judge-prompt").read_text()
    assert "ORIGINAL-PLAN-MARKER" in prompt and "NEW-PLAN-MARKER" in prompt and "The thing 1 SHALL work." in prompt
    assert "--model opus" in (standin / "judge-args").read_text()
    text = results_text(world)
    assert table(text)[0]["Judge"] == "4"
    assert "- 4-replayed (4): covers AC-3" in text


def test_an_answer_with_no_json_object_is_recorded_as_no_score_AC_7(world, replay_main, standin):
    judge_says(standin, "I would rather not say.")

    assert replay_main(world.argv("4-replayed")) == 0

    assert table(results_text(world))[0]["Judge"] == "no score"


def test_a_steps_time_tokens_and_cost_fill_the_row_and_a_cost_the_runner_left_out_reads_not_measured_AC_8(world, replay_main, standin):
    write(standin / "analyze-result.json", '{"ok":true,"terminalReason":"completed","costUsd":1.5}')
    write(standin / "implement-result.json", '{"ok":true,"terminalReason":"completed","testedGreen":true}')

    assert replay_main(world.argv("4-replayed")) == 0

    row = table(results_text(world))[0]
    analyze, implement, judge = (row[f"{step} time/tokens/cost"].split(" · ") for step in ("Analyze", "Implement", "Judge"))
    assert re.fullmatch(r"\d+(m\d*s?|s)", analyze[0]) and analyze[1:] == ["330", "$1.50"]
    assert implement[1:] == ["330", "not measured"]
    assert judge == ["2s", "15", "$0.25"]


def test_results_md_holds_the_settings_a_row_per_spec_and_the_totals_AC_9(world, replay_main, standin):
    write(standin / "plan.md", PLAN)

    assert replay_main(world.argv("4-replayed", "6-second")) == 0

    folder = world.run_folder()
    assert re.fullmatch(r"\d{8}-\d{4}-" + world.aide.new[:8], folder.name)
    text = (folder / "results.md").read_text()
    assert f"Aide {world.aide.new[:8]} · analyze claude opus high · implement claude sonnet · judge claude opus" in text
    first, second, total = table(text)
    assert [first["Spec"], second["Spec"], total["Spec"]] == ["4", "6", "Total (2 of 2 replayed)"]
    assert (first["Must-fix"], first["Should-fix"], first["Every AC placed"], first["Green"], first["Rounds"], first["Original tests"]) == \
        ("1", "2", "no: AC-3", "yes", "1", "1/1")
    assert second["Original tests"] == "1/2"
    assert (total["Must-fix"], total["Should-fix"], total["Every AC placed"], total["Green"], total["Rounds"], total["Original tests"], total["Judge"]) == \
        ("2", "4", "0 of 2", "2 of 2", "2", "2/3", "4.0")
    assert total["Analyze time/tokens/cost"].endswith(" · 660 · $1.00 (2 of 2 measured)")


def test_a_results_folder_inside_a_repository_is_refused_before_anything_is_copied_AC_9(world, replay_main, capsys):
    refused(world, capsys, replay_main, world.argv("4-replayed", extra=("--results", str(world.code / "results"))), "results")


def test_a_spec_that_cannot_be_replayed_says_why_and_the_next_one_is_replayed_AC_10(world, replay_main, standin):
    write(standin / "plan.md", PLAN)

    assert replay_main(world.argv("1-nolanding", "2", "3-closed", "4-replayed")) == 0

    rows = table(results_text(world))
    assert [r["Spec"] for r in rows] == ["1", "2", "3", "4", "Total (1 of 4 replayed)"]
    assert "cannot be replayed: no landing of its code found" in rows[0]["Note"]
    assert "cannot be replayed: not archived" in rows[1]["Note"]
    assert "cannot be replayed: closed" in rows[2]["Note"]
    assert rows[3]["Judge"] == "4" and rows[3]["Note"] == ""


def test_the_aide_repository_defaults_to_the_one_the_script_sits_in_AC_3():
    import importlib.util
    spec = importlib.util.spec_from_file_location("replay_specs_parse", SCRIPT_DIR / "__main__.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    args = module.parse(["--specs", "1", "--aide-commit", "x", "--analyze", "claude", "m", "--implement", "claude", "m"])

    assert os.path.exists(os.path.join(args.aide_repo, "core", "scripts", "aide-run-spec"))
