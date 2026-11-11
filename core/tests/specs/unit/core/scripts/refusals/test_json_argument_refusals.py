"""Regression tests for JSON refusals produced during argument parsing."""

import json
import os
import shutil
import subprocess

import pytest


COMMANDS = (
    "aide-reopen-spec",
    "aide-ac-prefix",
    "aide-spec-overlap",
    "aide-create-spec",
    "aide-archive-spec",
    "aide-reset-spec",
    "aide-record-step",
    "aide-resolve-test-cmd",
    "aide-write-spec",
    "aide-close-spec",
    "aide-record-test-run",
    "aide-run-spec",
)

RESULT_FILE_COMMANDS = (
    "aide-reopen-spec",
    "aide-create-spec",
    "aide-archive-spec",
    "aide-reset-spec",
    "aide-record-step",
    "aide-write-spec",
    "aide-close-spec",
    "aide-record-test-run",
    "aide-run-spec",
)

HELP_COMMANDS = tuple(command for command in COMMANDS if command != "aide-run-spec")
HOSTILE_ARGUMENT = '--bad"argument\\part\nnext-line'


@pytest.fixture
def scripts(workspace_root):
    return workspace_root / "core" / "scripts"


@pytest.fixture
def path_without_jq(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for command in ("bash", "cat", "dirname"):
        (bin_dir / command).symlink_to(shutil.which(command))
    return str(bin_dir)


def run(script, *args, env=None):
    return subprocess.run(
        [str(script), *args], capture_output=True, text=True, env=env,
    )


@pytest.mark.parametrize("command", COMMANDS)
def test_unknown_arguments_are_safely_serialized_for_every_command_ac_1_ac_2_ac_4(
    scripts, command,
):
    result = run(scripts / command, HOSTILE_ARGUMENT)

    assert result.returncode == 2
    assert json.loads(result.stdout) == {
        "ok": False,
        "exitCode": 2,
        "terminalReason": "refused",
        "error": f"unknown argument: {HOSTILE_ARGUMENT}",
    }


@pytest.mark.parametrize("command", RESULT_FILE_COMMANDS)
def test_an_accepted_result_file_gets_the_same_refusal_as_stdout_ac_3(
    scripts, tmp_path, command,
):
    result_file = tmp_path / "result.json"
    result = run(scripts / command, "--result-file", str(result_file), HOSTILE_ARGUMENT)

    assert result.returncode == 2
    assert json.loads(result_file.read_text()) == json.loads(result.stdout)


@pytest.mark.parametrize("command", HELP_COMMANDS)
def test_help_stays_plain_text_when_jq_is_unavailable_ac_4(
    scripts, path_without_jq, command,
):
    env = {**os.environ, "PATH": path_without_jq}
    result = run(scripts / command, "--help", env=env)

    assert result.returncode == 0
    assert result.stdout.startswith("Usage:\n")


@pytest.mark.parametrize("command", HELP_COMMANDS)
def test_unknown_arguments_stay_json_when_jq_is_unavailable_ac_1(
    scripts, path_without_jq, command,
):
    env = {**os.environ, "PATH": path_without_jq}
    result = run(scripts / command, HOSTILE_ARGUMENT, env=env)

    assert result.returncode == 2
    assert json.loads(result.stdout)["error"] == f"unknown argument: {HOSTILE_ARGUMENT}"
