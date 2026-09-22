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


@pytest.fixture
def runner_script(workspace_root):
    path = workspace_root / "dashboard" / "scripts" / "run-tests.sh"
    assert path.exists(), \
        "dashboard/scripts/run-tests.sh is gone — `make test` names it"
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

    def test_it_hands_the_tests_to_the_runner_script(self, makefile):
        recipe = _target(makefile, "test")
        assert "scripts/run-tests.sh" in recipe, \
            "`make test` must run dashboard/scripts/run-tests.sh, which is " \
            "where the groups and the per-test limit live"

    def test_the_browser_and_board_suites_keep_targets_of_their_own(self, makefile):
        """Both can still be run alone; only the round's is left out of `test`."""
        assert "test/e2e" in _target(makefile, "test-e2e")
        assert "test/round" in _target(makefile, "test-slow")


class TestTheRunnerScript:
    def test_it_leaves_the_round_s_own_tests_out(self, runner_script):
        assert "-not -path 'test/round/*'" in runner_script, \
            "test/round must stay out of the command a landing runs"

    def test_it_runs_the_browser_tests(self, runner_script):
        assert "-not -path 'test/e2e/*'" not in runner_script, \
            "the browser tests belong to the command a landing runs: they " \
            "are 19 s over the workers, and a spec that lands with its own " \
            "browser test red is what leaving them out allowed"

    def test_it_collects_the_tests_under_src_as_well(self, runner_script):
        assert re.search(r"find src test ", runner_script), \
            "tests live under src/ too (the message catalogues'), so both " \
            "trees are collected"

    def test_the_per_test_limit_is_twenty_seconds(self, runner_script):
        assert "LIMIT=20000" in runner_script, \
            "a git-backed test beside another job's suite loses to load at " \
            "bun's own 5 s"

    def test_it_says_something_while_it_runs(self, runner_script):
        assert "still running" in runner_script, \
            "one process per core printing into files says nothing for a " \
            "minute — each worker must report as it finishes, with how " \
            "many are left"

    def test_a_failing_test_is_printed_while_the_run_is_still_going(self, runner_script):
        assert "grep -h '^(fail)'" in runner_script, \
            "a failing test must reach the reader when it fails, not only " \
            "in the summary at the end"

    def test_it_says_how_long_the_whole_run_took(self, runner_script):
        assert "in $took" in runner_script and "started=$(date +%s)" in runner_script, \
            "the last line must carry the wall-clock time, in minutes and " \
            "seconds"

    def test_the_run_keeps_its_temp_directories_inside_its_own(self, runner_script):
        assert 'export TMPDIR="$OUT/tmp"' in runner_script, \
            "a test's own temp directory must land inside the run's, which " \
            "is removed on exit — otherwise what a test leaves behind stays " \
            "in the machine's shared temp directory for good"
        assert re.search(r"trap 'rm -rf \"\$OUT\"' EXIT", runner_script), \
            "the run's directory — which now holds every test's temp files " \
            "— must still be removed when the run ends"

    def test_a_red_worker_prints_its_output(self, runner_script):
        assert 'cat "$OUT/out.$w"' in runner_script, \
            "CI reads the failing lines out of this output — a red worker " \
            "that only reported a count would name no test"
