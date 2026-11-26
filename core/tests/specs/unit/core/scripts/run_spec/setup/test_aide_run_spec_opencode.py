"""The third tool: what opencode is told on its command line, what it
records, how a permission mode reaches it, and how a step asks for its
skill.

opencode differs from the other two in three ways that each get a test
here: its totals are a SUM over every `step_finish` rather than one
closing event, its safety is an agent rather than a sandbox flag, and it
has no slash command for aide's skills, so the prompt names the skill in
words instead.
"""

import json
import os
import re
import shutil
import subprocess
from fnmatch import fnmatchcase

import pytest

from ...conftest import run
from ..run_spec_status_files import with_status
from ..run_spec_results import (
    OPENCODE_SESSION_ID,
    OPENCODE_STREAM_FAILED,
    OPENCODE_STREAM_OK,
    OPENCODE_TOTALS,
    asks_for_step,
    emits,
)


REVIEW_MARKER = "Read this spec's own description"


def test_an_opencode_run_sums_tokens_and_cost_over_every_step(runner, workspace, fake_opencode):
    """opencode reports per STEP, not per turn. Reading the last event
    alone would report the final step's numbers as the whole run's."""
    oc = fake_opencode(emits(OPENCODE_STREAM_OK))
    rc, out, _, stderr = run(runner, workspace, tool="opencode", opencode=oc, return_stderr=True)
    assert rc == 0, out
    assert "unbound variable" not in stderr
    assert out["tool"] == "opencode"
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"
    assert "modelId" not in out, "AC-3: no second id beside the one the tool was given"
    assert out["sessionId"] == OPENCODE_SESSION_ID
    assert out["costMeasured"] is True
    assert out["costUsd"] == pytest.approx(OPENCODE_TOTALS["cost"])
    tokens = out["tokens"]
    assert tokens["input"] == OPENCODE_TOTALS["input"]
    # Reasoning tokens are billed as output, so both halves count — the
    # same rule Codex's usage block already follows.
    assert tokens["output"] == OPENCODE_TOTALS["output"]
    assert tokens["cacheRead"] == OPENCODE_TOTALS["cacheRead"]
    assert tokens["cacheCreation"] == OPENCODE_TOTALS["cacheCreation"]
    assert tokens["total"] == (
        OPENCODE_TOTALS["input"]
        + OPENCODE_TOTALS["output"]
        + OPENCODE_TOTALS["cacheRead"]
        + OPENCODE_TOTALS["cacheCreation"]
    )


def test_an_opencode_review_beside_an_opencode_step_counts_each_turn_once_ac_5(
    runner, workspace, fake_opencode, tmp_path
):
    """opencode's figures are a sum over the transcript's `step_finish`
    events, and the review appends to the step's transcript: each turn
    must read only its own bytes."""
    with_status(workspace, ["create", "analyze"])
    review_stream = OPENCODE_STREAM_OK.replace('"text": "done"', '"text": "review: no defects found"')
    oc = fake_opencode(
        f"if grep -q \"{REVIEW_MARKER}\" {tmp_path / 'opencode-prompt.txt'}; then\n"
        f"  {emits(review_stream).replace('cat > /dev/null; ', '')}\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  {emits(OPENCODE_STREAM_OK).replace('cat > /dev/null; ', '')}\n"
        "fi\n"
    )
    rc, out, _ = run(runner, workspace, tool="opencode", opencode=oc, command="implement",
                     review_tool="opencode", review_model="openai/gpt-5")
    assert out["terminalReason"] == "completed", out
    turn_total = (OPENCODE_TOTALS["input"] + OPENCODE_TOTALS["output"]
                  + OPENCODE_TOTALS["cacheRead"] + OPENCODE_TOTALS["cacheCreation"])
    assert out["review"]["costUsd"] == pytest.approx(OPENCODE_TOTALS["cost"]), out["review"]
    assert out["review"]["tokens"]["total"] == turn_total, out["review"]
    assert out["costUsd"] == pytest.approx(2 * OPENCODE_TOTALS["cost"]), out
    assert out["tokens"]["total"] == 2 * turn_total, out["tokens"]


def test_an_opencode_error_event_is_the_failure_and_carries_its_message(
    runner, workspace, fake_opencode
):
    """There is no failed-turn event to select: the `error` event is the
    only place a sentence for the reader exists."""
    oc = fake_opencode(emits(OPENCODE_STREAM_FAILED))
    rc, out, _ = run(runner, workspace, tool="opencode", opencode=oc)
    assert out["ok"] is False, out
    assert "the model refused the turn" in json.dumps(out)
    # The session is read off any event, so a run that failed before a
    # single step finished still says which session it was.
    assert out["sessionId"] == OPENCODE_SESSION_ID


def test_an_opencode_2_error_event_carries_its_message_too(runner, workspace, fake_opencode):
    """opencode 2.x puts the sentence under `.error.message`, and its name
    under `.error.type` (opencode 2.2.6, read off a failed run)."""
    event = {"type": "error", "sessionID": OPENCODE_SESSION_ID,
             "error": {"type": "provider.quota", "message": "Insufficient account funds", "status": 402}}
    oc = fake_opencode(emits(json.dumps(event)))
    rc, out, _ = run(runner, workspace, tool="opencode", opencode=oc)
    assert out["ok"] is False, out
    assert "Insufficient account funds" in json.dumps(out)


def test_an_opencode_account_without_credit_is_a_forbidden_request(runner, workspace, fake_opencode):
    """A paid model on an OpenCode account with no balance answers 402
    (opencode 2.3.2): pressing the step again cannot help until the account
    is topped up, so it is not an `other` error."""
    said = ("Insufficient balance. This request is pay-as-you-go, billed to OpenCode Models credits. "
            "Top up at https://opencode.ai/console/billing?credits=1.")
    event = {"type": "error", "sessionID": OPENCODE_SESSION_ID,
             "error": {"type": "provider.quota", "message": said, "status": 402}}
    oc = fake_opencode(emits(json.dumps(event)))
    rc, out, _ = run(runner, workspace, tool="opencode", opencode=oc)
    assert out["terminalReason"] == "cli-error", out
    assert out["providerError"]["kind"] == "forbidden", out
    assert out["providerError"]["message"].startswith("Insufficient balance"), out


@pytest.mark.parametrize(
    "mode,expected,forbidden",
    [
        ("bypassPermissions", ["--agent", "build", "--auto"], []),
        ("acceptEdits", ["--agent", "build"], ["--auto"]),
        ("plan", ["--agent", "plan"], ["--auto"]),
    ],
)
def test_a_permission_mode_reaches_opencode_as_an_agent(
    runner, workspace, fake_opencode, mode, expected, forbidden
):
    """opencode has no sandbox flag. The agent IS the boundary, and the
    `plan` agent, with the config the next test checks, is the read-only
    one."""
    oc = fake_opencode(emits(OPENCODE_STREAM_OK))
    run(runner, workspace, tool="opencode", opencode=oc, permission_mode=mode)
    argv = fake_opencode.calls.read_text()
    for token in expected:
        assert token in argv, argv
    for token in forbidden:
        assert token not in argv, argv


def _config_seen(fake_opencode, tmp_path, runner, workspace, mode):
    """The OPENCODE_CONFIG_CONTENT the turn was started with, or None."""
    seen = tmp_path / "opencode-config.txt"
    oc = fake_opencode(
        f'printf "%s" "${{OPENCODE_CONFIG_CONTENT-<unset>}}" > {seen}\n' + emits(OPENCODE_STREAM_OK)
    )
    run(runner, workspace, tool="opencode", opencode=oc, permission_mode=mode)
    text = seen.read_text()
    return None if text == "<unset>" else json.loads(text)


@pytest.mark.parametrize("mode", ["plan", "default"])
def test_a_read_only_mode_denies_opencode_every_tool_that_changes_a_file(
    runner, workspace, fake_opencode, tmp_path, mode
):
    """The `plan` agent alone still writes `.opencode/plans/*.md`, runs any
    shell command, and can start a subagent that does both. A config passed
    in the environment outranks the project's own `opencode.json`, but a
    project's rule for one agent outranks a general one, so the deny is
    written for the plan agent as well, and `task` is denied with it."""
    config = _config_seen(fake_opencode, tmp_path, runner, workspace, mode)
    assert config is not None
    for rules in (config["permission"], config["agent"]["plan"]["permission"]):
        assert rules == {"edit": "deny", "bash": "deny", "task": "deny"}, config


# The OpenCode whose plan behaviour this check answers for: 2.4.2 moved the
# plan rules into the system prompt, so an older binary passing says nothing
# about it and is skipped rather than counted.
REAL_OPENCODE_MIN = (2, 4, 2)


def _real_opencode():
    """The installed opencode and its version, or a reason to skip."""
    binary = shutil.which("opencode")
    if binary is None:
        pytest.skip("no opencode on PATH: the resolved rules need a real OpenCode")
    said = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=60).stdout
    found = re.search(r"(\d+)\.(\d+)\.(\d+)", said)
    version = tuple(int(n) for n in found.groups()) if found else (0, 0, 0)
    if version < REAL_OPENCODE_MIN:
        pytest.skip(f"opencode {said.strip()!r} is older than 2.4.2, the version whose plan rules this check verifies")
    return binary


def _effect(rules, action, resource):
    """OpenCode's answer for one action on one resource: the LAST rule
    that matches it wins."""
    effect = None
    for rule in rules:
        if fnmatchcase(action, rule["action"]) and fnmatchcase(resource, rule["resource"]):
            effect = rule["effect"]
    return effect


def test_a_real_opencode_keeps_the_plan_agent_read_only_under_aides_config_ac_1(
    runner, workspace, fake_opencode, tmp_path
):
    """The other tests prove what Aide hands OpenCode; this one asks a real
    OpenCode how it resolves it, with no model and no provider called.
    OpenCode 2 names Aide's `bash` and `task` rules `shell` and `subagent`
    in its resolved list, and lets the plan agent write its own plan files
    unless a later rule says otherwise."""
    binary = _real_opencode()
    config = _config_seen(fake_opencode, tmp_path, runner, workspace, "plan")
    repo = tmp_path / "fixture"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    said = subprocess.run(
        [binary, "debug", "agents", "--standalone"], cwd=repo, capture_output=True, text=True,
        timeout=120, env={**os.environ, "OPENCODE_CONFIG_CONTENT": json.dumps(config)},
    )
    assert said.returncode == 0, said.stderr
    plan = next(agent for agent in json.loads(said.stdout) if agent["id"] == "plan")
    rules = plan["permissions"]
    edited = ["README.md", str(repo / "src" / "app.py")]
    edited += [rule["resource"] for rule in rules if rule["action"] == "edit" and rule["effect"] == "allow"]
    for resource in edited:
        assert _effect(rules, "edit", resource) == "deny", (resource, rules)
    for action in ("shell", "subagent"):
        assert _effect(rules, action, "anything") == "deny", (action, rules)
    for action in ("read", "glob", "grep", "webfetch", "websearch", "skill", "todowrite"):
        assert _effect(rules, action, "src/app.py") == "allow", (action, rules)


@pytest.mark.parametrize("mode", ["bypassPermissions", "acceptEdits"])
def test_a_writing_mode_passes_opencode_no_permission_rules(runner, workspace, fake_opencode, tmp_path, mode):
    config = _config_seen(fake_opencode, tmp_path, runner, workspace, mode)
    assert "permission" not in config and "agent" not in config, config


@pytest.mark.parametrize("mode", ["bypassPermissions", "acceptEdits", "plan", "default"])
def test_every_opencode_turn_has_automations_off(runner, workspace, fake_opencode, tmp_path, mode):
    """An automation runs a prompt or a shell command later, after the
    step has ended and outside its boundaries (OpenCode 2.4.0)."""
    config = _config_seen(fake_opencode, tmp_path, runner, workspace, mode)
    assert config["automations"] is False, config


def test_an_unknown_permission_mode_refuses_rather_than_guessing(
    runner, workspace, fake_opencode
):
    """A mode with no entry must refuse: guessing wrong means a step
    running with the wrong boundary and nobody finding out."""
    oc = fake_opencode(emits(OPENCODE_STREAM_OK))
    rc, out, _ = run(
        runner, workspace, tool="opencode", opencode=oc, permission_mode="noSuchMode"
    )
    assert rc != 0, out
    assert "opencode" in json.dumps(out)


def test_opencode_is_asked_to_read_the_same_instructions_file(runner, workspace, fake_opencode):
    """Every tool gets the same sentence: the step's instructions file
    beside the runner, and the spec's own number."""
    oc = fake_opencode(emits(OPENCODE_STREAM_OK))
    run(runner, workspace, tool="opencode", opencode=oc, command="analyze")
    prompt = fake_opencode.prompt_log.read_text()
    assert asks_for_step(prompt, "analyze", workspace["folder"].split("-")[0]), prompt


def test_the_stream_is_asked_for_as_json_on_stdout(runner, workspace, fake_opencode):
    """One event per line as it happens, the prompt read from stdin —
    the same shape the other two tools are driven in."""
    oc = fake_opencode(emits(OPENCODE_STREAM_OK))
    run(runner, workspace, tool="opencode", opencode=oc)
    argv = fake_opencode.calls.read_text()
    assert "run" in argv.split(), argv
    assert "--format json" in argv, argv


def test_a_missing_opencode_binary_refuses_by_name(runner, workspace, tmp_path):
    """The refusal names the override to set, as the other two do."""
    missing = tmp_path / "not-here"
    rc, out, _ = run(runner, workspace, tool="opencode", opencode=missing)
    assert rc != 0, out
    assert "AIDE_OPENCODE_BIN" in json.dumps(out)


def test_opencode_runs_on_a_server_of_its_own(runner, workspace, fake_opencode):
    """`opencode run` hands the turn to a background service otherwise, which
    never sees this turn's environment: the read-only deny in
    OPENCODE_CONFIG_CONTENT and the provider's login were ignored there
    (2.3.0, a plan turn under the deny ran a shell command)."""
    oc = fake_opencode(emits(OPENCODE_STREAM_OK))
    run(runner, workspace, tool="opencode", opencode=oc)
    assert "--standalone" in fake_opencode.calls.read_text().split()
