"""The runner's own test run is made through aide-record-test-run. When
the recorder itself refuses — the spec's folder is not where it looks, an
argument is wrong — no test ran: the step ends `tests-not-started` with
the cause in the result, and no turn goes back to the session as if the
tests were red (run-spec/turn/step-tests.sh).
"""

import json

from ....conftest import READ_SPECS, stand_in
from ....conftest import run
from ...run_spec_results import RESULT_OK
from ...run_spec_status_files import with_status

FOLDER = "81-queue-and-runner"


def _claude_moving_the_folder_away(fake_claude, tmp_path):
    """Implements, and moves the spec's folder under archive/ on the specs
    branch, where the recorder does not look. Every prompt is kept."""
    prompts = tmp_path / "prompts.txt"
    claude = fake_claude(
        f'cat >> {prompts}; echo "=== end" >> {prompts}\n'
        + READ_SPECS
        + f'if [ -d "$specs/{FOLDER}" ]; then\n'
        + f'  mkdir -p "$specs/archive" && git -C "$specs" mv "{FOLDER}" "archive/{FOLDER}"\n'
        + '  git -C "$specs" commit -q -m "moved" >/dev/null 2>&1\n'
        + "fi\n"
        + "printf 'real work\\n' > implemented.txt\n"
        + "git add -A && git commit -q -m 'the step' >/dev/null 2>&1 || true\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    return claude, prompts


def test_a_spec_folder_the_recorder_cannot_find_ends_tests_not_started_without_a_fix_round(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    claude, prompts = _claude_moving_the_folder_away(fake_claude, tmp_path)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "tests-not-started", out
    assert out["testsNotStarted"] == {"kind": "spec-folder-missing", "folder": FOLDER}, out
    assert "test suite is red" not in prompts.read_text(), "no fix round for tests that never ran"


def test_a_recorder_that_ends_without_a_result_is_not_red_tests(
    runner, workspace, fake_claude, tmp_path, monkeypatch
):
    """The recorder is a stand-in that dies before writing its result: the
    exit code alone looks like a failing suite, and is not one."""
    with_status(workspace, ["create", "analyze"])
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    copied = scripts / "aide-run-spec"
    # The runner finds the recorder beside itself, so a copy of the
    # scripts folder with a broken recorder is the runner the test runs.
    import shutil
    shutil.copytree(runner.parent, scripts, dirs_exist_ok=True, symlinks=True)
    stand_in(scripts / "aide-record-test-run", "#!/bin/sh\necho 'something broke' >&2\nexit 2\n")
    prompts = tmp_path / "prompts.txt"
    claude = fake_claude(
        f'cat >> {prompts}\n'
        "printf 'real work\\n' > implemented.txt\n"
        "git add -A && git commit -q -m 'the step' >/dev/null 2>&1 || true\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement", runner_path=copied)
    assert out["terminalReason"] == "tests-not-started", out
    assert out["testsNotStarted"]["kind"] == "recorder-failed", out
    assert "test suite is red" not in prompts.read_text()
