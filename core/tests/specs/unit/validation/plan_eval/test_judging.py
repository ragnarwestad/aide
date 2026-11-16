"""scripts/plan_eval/judging.py: a judge turn on the Claude or the Codex command line, with its time, tokens and
cost, and the user's own login."""
import pytest

import judging
from copies import Refusal

from .conftest import write


def test_a_judge_is_a_tool_and_a_model_with_claude_taking_an_effort_ac_5():
    assert judging.judge_argument(["claude", "opus"]) == judging.Judge("claude", "opus", None)
    assert judging.judge_argument(["claude", "opus", "high"]) == judging.Judge("claude", "opus", "high")
    assert judging.judge_argument(["codex", "gpt-6.1-sol"]) == judging.Judge("codex", "gpt-6.1-sol", None)


@pytest.mark.parametrize("values", [["codex", "gpt-6.1-sol", "high"], ["opencode", "x"], ["claude"], ["claude", "a", "b", "c"]])
def test_a_judge_argument_that_cannot_be_run_is_refused_ac_5(values):
    with pytest.raises(Refusal):
        judging.judge_argument(values)


def ask(tmp_path, judge, prompt="PROMPT-MARKER"):
    scratch = tmp_path / "scratch"
    scratch.mkdir(exist_ok=True)
    return judging.ask(judge, prompt, scratch, tmp_path / "out" / "judge-plan")


def test_a_claude_judge_reads_the_prompt_on_stdin_and_its_time_tokens_and_cost_come_from_the_result_ac_5(tmp_path, judges, monkeypatch):
    monkeypatch.setenv("AIDE_RUN_URL", "http://board.invalid/run")
    judges.say("REPLY-MARKER")

    reply = ask(tmp_path, judging.Judge("claude", "opus", "high"))

    (call,) = judges.calls()
    assert call["tool"].strip() == "claude"
    assert call["args"].split() == ["-p", "--output-format", "json", "--model", "opus", "--effort", "high"]
    assert call["prompt"] == "PROMPT-MARKER" and "AIDE_RUN_URL=unset" in call["env"]
    assert reply.problem is None and reply.text == "REPLY-MARKER"
    assert reply.stats == judging.Stats(2.0, 15, 0.25)
    for suffix in ("prompt.md", "raw", "reply.md"):
        assert (tmp_path / "out" / f"judge-plan.{suffix}").exists()


def test_a_claude_judge_without_an_effort_passes_none(tmp_path, judges):
    ask(tmp_path, judging.Judge("claude", "sonnet", None))

    assert judges.calls()[0]["args"].split() == ["-p", "--output-format", "json", "--model", "sonnet"]


def test_a_codex_judge_runs_read_only_in_an_empty_folder_with_tokens_from_the_last_turn_and_no_cost_ac_5(tmp_path, judges):
    judges.say("CODEX-REPLY")

    reply = ask(tmp_path, judging.Judge("codex", "gpt-6.1-sol", None))

    (call,) = judges.calls()
    args = call["args"].split()
    assert call["tool"].strip() == "codex" and args[:2] == ["exec", "--json"]
    assert args[args.index("-m") + 1] == "gpt-6.1-sol" and args[args.index("-s") + 1] == "read-only"
    assert "--skip-git-repo-check" in args and args[-1] == "-"
    assert (call["dir"] / "folder-listing").read_text() == ""
    assert call["prompt"] == "PROMPT-MARKER"
    assert reply.problem is None and reply.text == "CODEX-REPLY"
    assert reply.stats.tokens == 120 and reply.stats.cost is None and reply.stats.seconds is not None


def test_a_codex_judge_that_reports_no_usage_has_its_tokens_not_measured(tmp_path, judges, monkeypatch):
    codex = tmp_path / "bin" / "codex"
    write(codex, '#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && echo hi > "$2"; shift; done\necho "{}"\n', 0o755)
    monkeypatch.setenv("AIDE_CODEX_BIN", str(codex))

    reply = ask(tmp_path, judging.Judge("codex", "gpt-6.1-sol", None))

    assert reply.text == "hi\n" and reply.stats.tokens is None and reply.stats.cost is None


def test_a_judge_that_cannot_start_has_no_reply_and_says_why(tmp_path, monkeypatch):
    monkeypatch.setenv("AIDE_CLAUDE_BIN", str(tmp_path / "no-such-claude"))

    reply = ask(tmp_path, judging.Judge("claude", "opus", None))

    assert reply.text is None and "could not run" in reply.problem


def test_a_claude_judge_that_answers_no_json_has_no_reply_and_says_why(tmp_path, monkeypatch):
    claude = tmp_path / "bin" / "claude"
    write(claude, "#!/usr/bin/env bash\necho 'Not logged in'\n", 0o755)
    monkeypatch.setenv("AIDE_CLAUDE_BIN", str(claude))

    reply = ask(tmp_path, judging.Judge("claude", "opus", None))

    assert reply.text is None and "Not logged in" in reply.problem


def test_no_api_key_is_needed_by_either_judge_ac_5(tmp_path, judges, monkeypatch):
    for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"):
        monkeypatch.delenv(key, raising=False)

    for judge in (judging.Judge("claude", "opus", None), judging.Judge("codex", "gpt-6.1-sol", None)):
        assert ask(tmp_path, judge).problem is None


@pytest.mark.parametrize("tool", ["claude", "codex"])
def test_a_judge_that_times_out_keeps_its_elapsed_time_with_tokens_and_cost_not_measured_ac_6(tmp_path, monkeypatch, tool):
    slow = tmp_path / "bin" / tool
    write(slow, "#!/usr/bin/env bash\nexec sleep 30\n", 0o755)
    monkeypatch.setenv(f"AIDE_{tool.upper()}_BIN", str(slow))
    monkeypatch.setattr(judging, "TIMEOUT_SEC", 0.5)

    reply = ask(tmp_path, judging.Judge(tool, "m", None))

    assert reply.text is None and "could not run" in reply.problem
    assert reply.stats.seconds >= 0.5 and reply.stats.tokens is None and reply.stats.cost is None
