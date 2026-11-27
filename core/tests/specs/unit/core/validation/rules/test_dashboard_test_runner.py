"""The dashboard's test command and the script it hands the work to.

`make test` is what the landing, the runner and CI all invoke, and it runs
the suite as several bun processes. Three things have to stay true of that
pair, and each is a silent failure if it drifts:

- the target type-checks before it tests, since bun transpiles without
  type-checking;
- the round's own tests, which start a real board each, stay out of it —
  they have a target of their own, and the browser tests do not: those
  run with everything else;
- the per-test limit stays generous enough for a git-backed test running
  beside another job's suite.
"""

import os
import re
import subprocess

import pytest


@pytest.fixture
def makefile(workspace_root):
    path = workspace_root / "dashboard" / "Makefile"
    assert path.exists(), "dashboard/Makefile is gone"
    return path.read_text()


def _target(text, name):
    """The recipe lines of one Makefile target."""
    match = re.search(rf"^{name}:\n((?:\t.*\n)+)", text, re.M)
    assert match, f"the Makefile has no {name}: target"
    return match.group(1)


class TestTheTestTarget:
    def test_it_type_checks_before_it_runs_the_tests(self, makefile):
        recipe = _target(makefile, "test")
        lines = [ln.strip() for ln in recipe.splitlines() if not ln.strip().startswith("#")]
        assert lines[0] == "bunx tsc --noEmit", \
            "the first thing `make test` does must be the type check"


# A stand-in for `bun test`, handed to run-tests.sh as an exported bash
# function so no new executable is written. What it does is decided by
# the one file it is given: `killed-once` is stopped by a signal the first
# time only, `killed` every time, `red-once` has a failing test the first
# time only, `red` every time. Like bun, it heads the file's output with
# its path, and prints a failing test's error and assertion lines above its
# `(fail)` line; those name the attempt, so the two can be told apart. The
# temp directory it was given is noted beside the file.
_FAKE_BUN = r'''() {
  [ "$1" = test ] || return 0
  f="${@: -1}"; name="$(basename "$f" .test.ts)"
  echo "$TMPDIR" > "$f.tmpdir"
  echo "x" >> "$f.attempts"; n=$(wc -l < "$f.attempts" | tr -d ' ')
  fail() { echo "error: boom on attempt $n"; echo "expect(1).toBe(2) on attempt $n"; echo "(fail) a test > that fails"; echo " 0 pass"; echo " 1 fail"; echo "Ran 1 tests across 1 file."; }
  echo "$f:"
  case "$name" in
    killed-once) [ -e "$f.seen" ] || { : > "$f.seen"; kill -9 "$(sh -c 'echo $PPID')"; } ;;
    killed) kill -9 "$(sh -c 'echo $PPID')" ;;
    red-once) [ -e "$f.seen" ] || { : > "$f.seen"; fail; return 1; } ;;
    red) fail; return 1 ;;
  esac
  echo "Ran 1 tests across 1 file."
}'''


def _run_suite(workspace_root, tmp_path, name):
    import os
    import subprocess
    (tmp_path / f"{name}.test.ts").write_text("")
    env = {**os.environ, "AIDE_TEST_WORKERS": "1", "BASH_FUNC_bun%%": _FAKE_BUN}
    return subprocess.run(
        ["bash", str(workspace_root / "dashboard" / "scripts" / "run-tests.sh"), str(tmp_path)],
        capture_output=True, text=True, env=env, timeout=60,
    )


class TestAWorkerStoppedFromOutside:
    def test_a_worker_killed_once_is_run_again_and_the_suite_is_green(self, workspace_root, tmp_path):
        r = _run_suite(workspace_root, tmp_path, "killed-once")
        assert r.returncode == 0, r.stdout + r.stderr
        assert "was killed (signal 9) without a failing test; running its files again" in r.stdout
        assert "is RED" not in r.stdout

    def test_a_worker_killed_twice_is_red(self, workspace_root, tmp_path):
        r = _run_suite(workspace_root, tmp_path, "killed")
        assert r.returncode == 1, r.stdout + r.stderr
        assert "red: worker(s) 0" in r.stdout

    def test_a_failing_test_is_not_the_signal_s_to_run_again(self, workspace_root, tmp_path):
        r = _run_suite(workspace_root, tmp_path, "red")
        assert "was killed" not in r.stdout


class TestAFailingTest:
    def test_a_file_is_not_retried_when_one_run_was_requested_ac_3(self, workspace_root, tmp_path):
        import os
        env = {**os.environ, "AIDE_TEST_WORKERS": "1", "AIDE_TEST_ONCE": "1", "BASH_FUNC_bun%%": _FAKE_BUN}
        (tmp_path / "red-once.test.ts").write_text("")
        result = subprocess.run(
            ["bash", str(workspace_root / "dashboard" / "scripts" / "run-tests.sh"), str(tmp_path)],
            capture_output=True, text=True, env=env, timeout=60,
        )
        assert result.returncode == 1
        assert "running its failing file(s) again" not in result.stdout


def _failing_tests(workspace_root, tmp_path, output):
    """What the board's parser of a red run reads from this output."""
    import json
    log = tmp_path / "run.log"
    log.write_text(output)
    lib = workspace_root / "core" / "scripts" / "lib" / "failing-tests.sh"
    r = subprocess.run(
        ["bash", "-c", f'source "{lib}" && failing_tests "{log}"'],
        capture_output=True, text=True, timeout=30, check=True,
    )
    return json.loads(r.stdout)


def _first_attempt_lines(output):
    return [ln for ln in output.splitlines() if "[first attempt]" in ln]


class TestBothAttemptsAreKept:
    def test_a_file_that_passes_on_its_retry_keeps_the_first_attempt_s_failure_ac_1(self, workspace_root, tmp_path):
        r = _run_suite(workspace_root, tmp_path, "red-once")
        assert r.returncode == 0, r.stdout + r.stderr
        first = "\n".join(_first_attempt_lines(r.stdout))
        assert "(fail) a test > that fails" in first, r.stdout
        assert "error: boom on attempt 1" in first, r.stdout
        assert "expect(1).toBe(2) on attempt 1" in first, r.stdout
        retry_line = r.stdout.index("run again alone: Ran 1 tests")
        assert r.stdout.index("error: boom on attempt 1") < retry_line, r.stdout

    def test_a_file_that_fails_on_its_retry_shows_both_attempts_marked_ac_2(self, workspace_root, tmp_path):
        r = _run_suite(workspace_root, tmp_path, "red")
        assert r.returncode == 1, r.stdout + r.stderr
        first = "\n".join(_first_attempt_lines(r.stdout))
        assert "(fail) a test > that fails" in first, r.stdout
        assert "error: boom on attempt 1" in first, r.stdout
        assert "expect(1).toBe(2) on attempt 1" in first, r.stdout
        retry = r.stdout[r.stdout.index("--- worker 0, retry, in full:"):]
        assert "error: boom on attempt 2" in retry, r.stdout
        assert "expect(1).toBe(2) on attempt 2" in retry, r.stdout
        assert "(fail) a test > that fails" in retry, r.stdout

    def test_the_first_attempt_is_not_read_as_a_failing_test_ac_1_ac_2(self, workspace_root, tmp_path):
        (tmp_path / "green").mkdir()
        (tmp_path / "red").mkdir()
        green = _run_suite(workspace_root, tmp_path / "green", "red-once")
        assert _failing_tests(workspace_root, tmp_path, green.stdout)["tests"] == []
        red = _run_suite(workspace_root, tmp_path / "red", "red")
        found = _failing_tests(workspace_root, tmp_path, red.stdout)
        assert len(found["tests"]) == 1, found
        assert found["errors"] == ["error: boom on attempt 2"], found

    @pytest.mark.parametrize("name", ["red-once", "red"])
    def test_one_retry_and_the_temp_folder_is_removed_ac_3(self, workspace_root, tmp_path, name):
        r = _run_suite(workspace_root, tmp_path, name)
        assert r.returncode == (0 if name == "red-once" else 1), r.stdout + r.stderr
        assert (tmp_path / f"{name}.test.ts.attempts").read_text().count("x") == 2
        run_tmp = (tmp_path / f"{name}.test.ts.tmpdir").read_text().strip()
        assert run_tmp and not os.path.exists(os.path.dirname(run_tmp))




@pytest.mark.parametrize("workers", [2, 4])
def test_the_other_files_are_spread_over_every_worker_beside_one_browser_file(workspace_root, tmp_path, workers):
    """With one browser file, the other files still use every worker: a
    worker kept for that one file alone left a two-worker run with one
    process running the whole suite."""
    (tmp_path / "browser.test.ts").write_text('import { chromium } from "playwright";\n')
    for n in range(6):
        (tmp_path / f"plain-{n}.test.ts").write_text("")
    r, calls = _run_files(workspace_root, tmp_path, {"AIDE_TEST_WORKERS": str(workers)})
    assert r.returncode == 0, r.stdout + r.stderr
    assert len([ln for ln in calls if "plain-" in ln]) == workers, calls
    assert len([ln for ln in calls if "browser.test.ts" in ln]) == 1, calls


def _run_files(workspace_root, tmp_path, env_extra):
    import os
    import subprocess
    calls = tmp_path / "calls.txt"
    fake = r'''() { [ "$1" = test ] || return 0; echo "$*" >> "$AIDE_FAKE_BUN_CALLS"; echo "Ran 1 tests across 1 file."; }'''
    env = {k: v for k, v in os.environ.items() if k != "AIDE_TEST_WORKERS"}
    env.update({"BASH_FUNC_bun%%": fake, "AIDE_FAKE_BUN_CALLS": str(calls), **env_extra})
    r = subprocess.run(
        ["bash", str(workspace_root / "dashboard" / "scripts" / "run-tests.sh"), str(tmp_path)],
        capture_output=True, text=True, env=env, timeout=60,
    )
    return r, (calls.read_text().splitlines() if calls.exists() else [])


def test_one_worker_runs_every_file_even_with_a_browser_file_ac_4(workspace_root, tmp_path):
    """A board whose cores are all spoken for gives a run one worker; the
    browser file has no worker of its own then, and the files are not
    dealt over none."""
    (tmp_path / "browser.test.ts").write_text('import { chromium } from "playwright";\n')
    (tmp_path / "plain-0.test.ts").write_text("")
    (tmp_path / "plain-1.test.ts").write_text("")
    r, calls = _run_files(workspace_root, tmp_path, {"AIDE_TEST_WORKERS": "1"})
    assert r.returncode == 0, r.stdout + r.stderr
    assert len(calls) == 1, calls
    assert all(name in calls[0] for name in ("browser.test.ts", "plain-0.test.ts", "plain-1.test.ts")), calls


def test_with_no_worker_count_the_cores_less_two_are_used_ac_5(workspace_root, tmp_path):
    for n in range(12):
        (tmp_path / f"plain-{n}.test.ts").write_text("")
    r, calls = _run_files(workspace_root, tmp_path, {"BASH_FUNC_sysctl%%": "() { echo 10; }"})
    assert r.returncode == 0, r.stdout + r.stderr
    assert len(calls) == 8, calls


def test_a_green_worker_stays_green_when_bash_has_forgotten_its_status(workspace_root, tmp_path):
    """macOS's bash 3.2 can forget a background job that ended long before
    the others, and `wait` then answers "not a child of this shell" (127)
    for a worker whose tests all passed."""
    import os
    import subprocess
    (tmp_path / "green.test.ts").write_text("")
    forgetful_wait = '() { echo "wait: pid $1 is not a child of this shell" >&2; return 127; }'
    env = {**os.environ, "AIDE_TEST_WORKERS": "1", "BASH_FUNC_bun%%": _FAKE_BUN, "BASH_FUNC_wait%%": forgetful_wait}
    r = subprocess.run(
        ["bash", str(workspace_root / "dashboard" / "scripts" / "run-tests.sh"), str(tmp_path)],
        capture_output=True, text=True, env=env, timeout=60,
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert "red: worker(s)" not in r.stdout
