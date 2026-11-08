"""A resumed Claude session reports the session's totals, not the turn's:
after `--resume` the result's `total_cost_usd` and `modelUsage` include every
earlier turn of the session (run-spec/turn/session-totals.sh). A step's cost
and tokens count each turn once, and leave out what an earlier step in the
same session already counted.
"""

import json

import pytest

from ....conftest import run
from ...run_spec_status_files import with_status

TURN_COST = 0.10
TURN_TOKENS = {"input": 10, "output": 100, "cacheRead": 1000, "cacheCreation": 50}
ANALYSIS = "analysis-session-1"


def _one_turn(turns=1):
    tokens = {k: v * turns for k, v in TURN_TOKENS.items()}
    return {**tokens, "total": sum(tokens.values())}


def _cumulative_claude(fake_claude, counters):
    """A stand-in `claude` that reports what a real one does: per session,
    the sum of every turn so far. The session is the one `--resume` names,
    else the one `--session-id` names. A turn whose prompt names the red
    suite writes the fix; any other writes the step's work."""
    counters.mkdir(exist_ok=True)
    return fake_claude(
        'prompt="$(cat)"\n'
        'sid=""; prev=""\n'
        'for a in "$@"; do\n'
        '  [ "$prev" = "--resume" ] && sid="$a"\n'
        '  [ "$prev" = "--session-id" ] && [ -z "$sid" ] && sid="$a"\n'
        '  prev="$a"\n'
        "done\n"
        '[ -n "$sid" ] || sid="fresh-session"\n'
        f'n=$(( $(cat "{counters}/$sid" 2>/dev/null || echo 0) + 1 )); echo "$n" > "{counters}/$sid"\n'
        "if printf '%s' \"$prompt\" | grep -q 'test suite is red'; then\n"
        "  printf 'fixed\\n' > fixed.txt\n"
        "else\n"
        "  printf 'real work %s\\n' \"$n\" >> implemented.txt\n"
        "fi\n"
        "git add -A >/dev/null 2>&1 && git commit -q -m 'the turn' >/dev/null 2>&1\n"
        f'cost=$(awk "BEGIN {{ print $n * {TURN_COST} }}")\n'
        "printf '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"session_id\":\"%s\","
        "\"total_cost_usd\":%s,\"num_turns\":1,\"terminal_reason\":\"completed\",\"result\":\"done\","
        "\"modelUsage\":{\"claude-opus-5-5\":{\"inputTokens\":%d,\"outputTokens\":%d,"
        "\"cacheReadInputTokens\":%d,\"cacheCreationInputTokens\":%d,\"costUSD\":%s}}}\\n' "
        f"\"$sid\" \"$cost\" $((n * {TURN_TOKENS['input']})) $((n * {TURN_TOKENS['output']})) "
        f"$((n * {TURN_TOKENS['cacheRead']})) $((n * {TURN_TOKENS['cacheCreation']})) \"$cost\"\n"
    )


def _project_with_test_cmd(workspace, cmd):
    manifest = workspace["project"] / ".aide" / "project.yaml"
    manifest.write_text(manifest.read_text().replace("AIDE_TEST_CMD: true", f"AIDE_TEST_CMD: {cmd}"))


def test_a_red_suites_fix_turn_adds_its_own_cost_once(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "test -f fixed.txt")
    claude = _cumulative_claude(fake_claude, tmp_path / "counters")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 2
    assert out["costUsd"] == pytest.approx(2 * TURN_COST), out
    assert out["tokens"] == _one_turn(2), out


def test_an_implement_that_continues_the_analysis_leaves_the_analysis_out(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create"])
    claude = _cumulative_claude(fake_claude, tmp_path / "counters")
    run(runner, workspace, claude, command="analyze", session_id=ANALYSIS)
    with_status(workspace, ["create", "analyze"])
    rc, out, _ = run(runner, workspace, claude, command="implement", resume_session=ANALYSIS)
    assert out["terminalReason"] == "completed", out
    assert out["costUsd"] == pytest.approx(TURN_COST), out
    assert out["tokens"] == _one_turn(), out


def test_a_second_implement_on_the_same_session_leaves_the_first_out(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create"])
    claude = _cumulative_claude(fake_claude, tmp_path / "counters")
    run(runner, workspace, claude, command="analyze", session_id=ANALYSIS)
    with_status(workspace, ["create", "analyze"])
    run(runner, workspace, claude, command="implement", resume_session=ANALYSIS)
    rc, out, _ = run(runner, workspace, claude, command="implement", resume_session=ANALYSIS)
    assert out["terminalReason"] == "completed", out
    assert out["costUsd"] == pytest.approx(TURN_COST), out
    assert out["tokens"] == _one_turn(), out


def test_an_implement_that_starts_afresh_counts_its_own_session_whole(runner, workspace, fake_claude, tmp_path):
    """No analysis on this machine recorded the session: nothing is known to
    leave out, so the implement counts what the session reports."""
    with_status(workspace, ["create", "analyze"])
    claude = _cumulative_claude(fake_claude, tmp_path / "counters")
    rc, out, _ = run(runner, workspace, claude, command="implement", session_id="implement-session-1")
    assert out["terminalReason"] == "completed", out
    assert out["costUsd"] == pytest.approx(TURN_COST), out
    assert out["tokens"] == _one_turn(), out


def _cumulative_codex(fake_codex, counters):
    """A stand-in `codex` that reports what a real one does: `turn.completed`
    carries the thread's usage so far, every turn of it, its input holding
    the cached input. The thread is the one
    `exec resume` names, else a new one."""
    counters.mkdir(exist_ok=True)
    return fake_codex(
        "cat > /dev/null\n"
        'tid="fresh-thread"\n'
        'if [ "$1" = exec ] && [ "$2" = resume ]; then eval "tid=\\${$(( $# - 1 ))}"; fi\n'
        f'n=$(( $(cat "{counters}/$tid" 2>/dev/null || echo 0) + 1 )); echo "$n" > "{counters}/$tid"\n'
        "printf 'real work %s\\n' \"$n\" >> implemented.txt\n"
        "git add -A >/dev/null 2>&1 && git commit -q -m 'the turn' >/dev/null 2>&1\n"
        "printf '{\"type\":\"thread.started\",\"thread_id\":\"%s\"}\\n' \"$tid\"\n"
        "printf '{\"type\":\"item.completed\",\"item\":{\"id\":\"i\",\"item_type\":\"agent_message\",\"text\":\"done\"}}\\n'\n"
        "printf '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":%d,\"cached_input_tokens\":%d,"
        "\"output_tokens\":%d,\"reasoning_output_tokens\":0}}\\n' "
        f"$((n * {TURN_TOKENS['input'] + TURN_TOKENS['cacheRead']})) $((n * {TURN_TOKENS['cacheRead']})) "
        f"$((n * {TURN_TOKENS['output']}))\n"
    )


def test_a_codex_implement_that_continues_the_analysis_leaves_the_analysis_out(
    runner, workspace, fake_codex, tmp_path
):
    with_status(workspace, ["create"])
    codex = _cumulative_codex(fake_codex, tmp_path / "counters")
    run(runner, workspace, tool="codex", codex=codex, command="analyze")
    with_status(workspace, ["create", "analyze"])
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, command="implement", resume_session="fresh-thread")
    assert out["terminalReason"] == "completed", out
    one = {"input": TURN_TOKENS["input"], "output": TURN_TOKENS["output"],
           "cacheRead": TURN_TOKENS["cacheRead"], "cacheCreation": 0}
    assert out["tokens"] == {**one, "total": sum(one.values())}, out


def test_an_opencode_fix_turn_adds_its_own_cost_once(runner, workspace, fake_opencode):
    """OpenCode reports each call on its own, and every turn of a step is
    written to the step's one transcript: a turn's cost is the calls after
    where it began, and the step's tokens are every call's."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "test -f fixed.txt")
    step = {"type": "step_finish", "sessionID": "ses_1", "part": {
        "type": "step-finish", "reason": "stop", "cost": TURN_COST,
        "tokens": {"input": 10, "output": 100, "reasoning": 0, "cache": {"read": 1000, "write": 50}}}}
    text = {"type": "text", "sessionID": "ses_1", "part": {"type": "text", "text": "done"}}
    oc = fake_opencode(
        f"if grep -q 'test suite is red' '{fake_opencode.prompt_log}'; then printf 'fixed\\n' > fixed.txt;"
        " else printf 'real work\\n' > implemented.txt; fi\n"
        "git add -A >/dev/null 2>&1 && git commit -q -m 'the turn' >/dev/null 2>&1\n"
        f"printf '%s\\n' '{json.dumps(step)}' '{json.dumps(text)}'\n"
    )
    rc, out, _ = run(runner, workspace, tool="opencode", opencode=oc, command="implement")
    assert out["terminalReason"] == "completed", out
    assert out["costUsd"] == pytest.approx(2 * TURN_COST), out
    assert out["tokens"] == _one_turn(2), out
