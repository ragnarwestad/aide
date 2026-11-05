"""A red implement run names its failing tests (run-spec/turn/step-tests.sh,
run-spec/turn/failing-tests.sh): in the step result's `testsRed`, with
whether any is in a file the change touched and whether the runner's runs
failed different tests, and by name in each fix round's prompt.
"""

import json

from ....conftest import run, stand_in
from ...run_spec_results import RESULT_OK
from ...run_spec_status_files import with_status


def _project_with_test_cmd(workspace, cmd):
    manifest = workspace["project"] / ".aide" / "project.yaml"
    manifest.write_text(manifest.read_text().replace("AIDE_TEST_CMD: true", f"AIDE_TEST_CMD: {cmd}"))


def _playwright_suite(tmp_path, *per_run):
    """A suite that prints Playwright's summary, failing the tests given
    for its first run, then for its second, and so on (the last repeats),
    after forty lines of noise."""
    suite = tmp_path / "suite.sh"
    counter = tmp_path / "runs"
    arms = "".join(
        f"  {i + 1}) printf '%s\\n' {' '.join(repr(f'    [chromium] › {t}') for t in tests)} ;;\n"
        for i, tests in enumerate(per_run[:-1])
    )
    last = " ".join(repr(f"    [chromium] › {t}") for t in per_run[-1])
    stand_in(
        suite,
        "#!/bin/bash\n"
        f"n=$(( $(cat {counter} 2>/dev/null || echo 0) + 1 )); echo $n > {counter}\n"
        "i=0; while [ $i -lt 40 ]; do echo \"noise line $i\"; i=$((i+1)); done\n"
        f"echo '  {len(per_run[0])} failed'\n"
        "case $n in\n"
        f"{arms}"
        f"  *) printf '%s\\n' {last} ;;\n"
        "esac\n"
        "echo '  20 passed (1.2m)'\n"
        "echo 'Error: ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL'\n"
        "exit 1\n",
    )
    return suite


def _claude(fake_claude, tmp_path, work="printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'"):
    """Implements on the first turn (the review takes the same branch);
    a fix turn mends nothing. Every prompt is kept, split by `----`."""
    seen = tmp_path / "prompts.txt"
    return fake_claude(
        "prompt=\"$(cat)\"\n"
        f"printf '%s\\n----\\n' \"$prompt\" >> {seen}\n"
        "if ! printf '%s' \"$prompt\" | grep -q 'test suite is red'; then\n"
        f"  {{ {work}; }} >/dev/null 2>&1 || true\n"
        "fi\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    ), seen


def test_tests_in_files_the_change_never_touched_are_named_and_counted(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    suite = _playwright_suite(tmp_path, ["e2e/a.spec.ts:5:1 › a works", "e2e/b.spec.ts:9:1 › b works"])
    _project_with_test_cmd(workspace, str(suite))
    claude, _ = _claude(fake_claude, tmp_path)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "tests-red", out
    assert out["testsRed"] == {
        "tests": ["e2e/a.spec.ts:5 › a works", "e2e/b.spec.ts:9 › b works"],
        "failed": 2,
        "total": 22,
        "touched": False,
        "untouched": 2,
        "variedBetweenRuns": False,
    }, out


def test_a_failing_test_in_a_file_the_session_changed_and_left_uncommitted_is_touched(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    suite = _playwright_suite(tmp_path, ["e2e/a.spec.ts:5:1 › a works"])
    _project_with_test_cmd(workspace, str(suite))
    claude, _ = _claude(fake_claude, tmp_path, work="mkdir -p web/e2e && printf 'x\\n' > web/e2e/a.spec.ts")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "tests-red", out
    assert out["testsRed"]["touched"] is True, out
    assert out["testsRed"]["untouched"] == 0, out


def test_a_run_that_fails_a_test_the_run_before_did_not_is_a_varied_run(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    suite = _playwright_suite(tmp_path, ["e2e/a.spec.ts:5:1 › a works"], ["e2e/c.spec.ts:3:1 › c works"])
    _project_with_test_cmd(workspace, str(suite))
    claude, _ = _claude(fake_claude, tmp_path)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "tests-red", out
    assert out["testsRed"]["variedBetweenRuns"] is True, out
    assert out["testsRed"]["tests"] == ["e2e/c.spec.ts:3 › c works"], out


def test_the_fix_round_is_handed_the_failing_tests_by_name_not_the_end_of_the_log(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    suite = _playwright_suite(tmp_path, ["e2e/a.spec.ts:5:1 › a works"])
    _project_with_test_cmd(workspace, str(suite))
    claude, seen = _claude(fake_claude, tmp_path)
    run(runner, workspace, claude, command="implement")
    fix_turn = seen.read_text().split("----")[2]
    assert "- e2e/a.spec.ts:5 › a works" in fix_turn, fix_turn
    assert "noise line" not in fix_turn, fix_turn
    assert "ERR_PNPM" not in fix_turn, fix_turn


def test_a_red_run_that_names_no_test_carries_no_named_tests(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "false")
    claude, _ = _claude(fake_claude, tmp_path)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "tests-red", out
    assert "testsRed" not in out, out
