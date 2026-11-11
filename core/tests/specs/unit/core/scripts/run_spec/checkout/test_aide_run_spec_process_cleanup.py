"""The runner owns one cleanup contract for model and test processes."""

import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[8]
CHECKOUTS = ROOT / "core/scripts/lib/run-spec/checkout/checkouts.sh"
MODEL_TURN = ROOT / "core/scripts/lib/run-spec/turn/model-turn/index.sh"
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


def test_model_tests_and_cancellation_share_the_cleanup_contract_ac_1_ac_5_ac_6_ac_9():
    model = MODEL_TURN.read_text()
    tests = STEP_TESTS.read_text()
    checkouts = CHECKOUTS.read_text()

    assert "cleanup_owned_process \"$child\" terminate" in model
    assert "cleanup_owned_process \"$child\" reap" in model
    assert tests.count("cleanup_owned_process") >= 4
    assert "cleanup_owned_process \"$child\" terminate" in checkouts
    assert "sleep 2" not in tests


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
