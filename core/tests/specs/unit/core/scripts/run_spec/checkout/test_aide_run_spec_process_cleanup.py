"""The runner owns one cleanup contract for model and test processes."""

import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[8]
CHECKOUTS = ROOT / "core/scripts/lib/run-spec/checkout/checkouts.sh"
STEP_TESTS = ROOT / "core/scripts/lib/run-spec/turn/step-tests.sh"


def _function(source: str, name: str) -> str:
    match = re.search(rf"^{name}\(\) \{{[^\n]*\n.*?^\}}\n", source, re.MULTILINE | re.DOTALL)
    assert match, f"{name} is not defined"
    return match.group(0)


def _cleanup_harness(body: str) -> subprocess.CompletedProcess[str]:
    source = CHECKOUTS.read_text()
    script = "set -u\n" + _function(source, "kill_group") + _function(source, "cleanup_owned_process") + body
    return subprocess.run(["bash", "-c", script], text=True, capture_output=True, timeout=10)


def test_responsive_owned_process_is_reaped_without_waiting_through_grace_ac_2_ac_3_ac_4_ac_7_ac_8():
    result = _cleanup_harness(
        """
kill_grace_sec=30
child=""
set -m
( trap 'exit 0' TERM; while :; do sleep 0.1; done ) &
owned=$!
set +m
child=$owned
started=$(date +%s)
cleanup_owned_process "$owned" terminate
elapsed=$(( $(date +%s) - started ))
[ "$elapsed" -lt 5 ] && [ -z "$child" ] && ! kill -0 "$owned" 2>/dev/null
"""
    )
    assert result.returncode == 0, result.stderr


def test_ignoring_owned_group_is_forced_down_without_touching_unrelated_process_ac_2_ac_4_ac_7_ac_8():
    result = _cleanup_harness(
        """
kill_grace_sec=1
child=""
sleep 30 & unrelated=$!
set -m
( trap '' TERM; while :; do sleep 0.1; done ) &
owned=$!
set +m
child=$owned
cleanup_owned_process "$owned" terminate
! kill -0 "$owned" 2>/dev/null
kill -0 "$unrelated" 2>/dev/null
ok=$?
kill "$unrelated" 2>/dev/null || true
wait "$unrelated" 2>/dev/null || true
exit "$ok"
"""
    )
    assert result.returncode == 0, result.stderr


def test_reaping_a_finished_model_turn_stops_descendants_before_bookkeeping_is_cleared_ac_4_ac_7():
    result = _cleanup_harness(
        """
kill_grace_sec=1
child=""
descendant_file=$(mktemp)
set -m
( sleep 30 & echo $! > "$descendant_file" ) &
owned=$!
set +m
child=$owned
cleanup_owned_process "$owned" reap
descendant=$(cat "$descendant_file")
! kill -0 "$descendant" 2>/dev/null && [ -z "$child" ]
"""
    )
    assert result.returncode == 0, result.stderr


def test_only_the_runner_handles_cancellation_and_saves_its_work():
    script = _function(CHECKOUTS.read_text(), "on_signal") + """
child=""
roots=(project)
work_roots=(worktree)
take_signal_lock() { echo "lock $1"; }
stop_suffix() { :; }
abort_unfinished_merges() { :; }
commit_and_push_roots() { echo "save" >&3; }
aide_part_close() { :; }
preserve_step_test_log() { :; }
spec_label=example
exec 3>&1

# Model a signal handler entered by a fork during group cancellation.
( on_signal )
[ "$?" -eq 143 ] || exit 1

trap on_signal TERM
kill -TERM "$$"
"""
    result = subprocess.run(["bash", "-c", script], text=True, capture_output=True, timeout=10)

    assert result.returncode == 143, result.stderr
    assert result.stdout.splitlines() == ["lock project", "save"]


def test_interrupted_named_tests_cannot_be_recorded_as_passed_ac_5_ac_6():
    tests = STEP_TESTS.read_text()

    assert 'interrupted="false"' in tests
    assert 'interrupted="true"' in tests
    assert '[ "$interrupted" = "true" ] && rc=1' in tests


def test_test_output_is_preserved_before_timeout_or_cancellation_removes_the_workdir_ac_5():
    tests = STEP_TESTS.read_text()
    checkouts = CHECKOUTS.read_text()

    assert "preserve_step_test_log" in tests
    assert "preserve_step_test_log" in checkouts
