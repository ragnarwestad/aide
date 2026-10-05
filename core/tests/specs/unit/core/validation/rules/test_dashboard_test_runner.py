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

import re

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
# its path.
_FAKE_BUN = r'''() {
  f="${@: -1}"; name="$(basename "$f" .test.ts)"
  echo "$f:"
  case "$name" in
    killed-once) [ -e "$f.seen" ] || { : > "$f.seen"; kill -9 "$(sh -c 'echo $PPID')"; } ;;
    killed) kill -9 "$(sh -c 'echo $PPID')" ;;
    red-once) [ -e "$f.seen" ] || { : > "$f.seen"; echo "(fail) a test > that fails"; echo "Ran 1 tests across 1 file."; return 1; } ;;
    red) echo "(fail) a test > that fails"; echo "Ran 1 tests across 1 file."; return 1 ;;
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
    def test_a_file_that_fails_once_is_run_again_alone_and_the_suite_is_green(self, workspace_root, tmp_path):
        r = _run_suite(workspace_root, tmp_path, "red-once")
        assert r.returncode == 0, r.stdout + r.stderr
        assert f"running its failing file(s) again alone: {tmp_path}/red-once.test.ts" in r.stdout

    def test_a_file_that_fails_twice_is_red(self, workspace_root, tmp_path):
        r = _run_suite(workspace_root, tmp_path, "red")
        assert r.returncode == 1, r.stdout + r.stderr
        assert "red: worker(s) 0" in r.stdout




def test_one_browser_file_keeps_one_worker_and_the_rest_share_the_others(workspace_root, tmp_path):
    """With four workers and one browser file, the other files are spread
    over the three workers left, not all run by one."""
    import os
    import subprocess
    (tmp_path / "browser.test.ts").write_text('import { chromium } from "playwright";\n')
    for n in range(6):
        (tmp_path / f"plain-{n}.test.ts").write_text("")
    calls = tmp_path / "calls.txt"
    fake = r'''() { echo "$*" >> "$AIDE_FAKE_BUN_CALLS"; echo "Ran 1 tests across 1 file."; }'''
    env = {**os.environ, "AIDE_TEST_WORKERS": "4", "BASH_FUNC_bun%%": fake, "AIDE_FAKE_BUN_CALLS": str(calls)}
    r = subprocess.run(
        ["bash", str(workspace_root / "dashboard" / "scripts" / "run-tests.sh"), str(tmp_path)],
        capture_output=True, text=True, env=env, timeout=60,
    )
    assert r.returncode == 0, r.stdout + r.stderr
    plain_workers = [ln for ln in calls.read_text().splitlines() if "plain-" in ln]
    assert len(plain_workers) == 3, calls.read_text()
