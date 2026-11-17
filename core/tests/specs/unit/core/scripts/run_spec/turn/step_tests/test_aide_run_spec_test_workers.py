"""Only live test recorders share the board's test workers."""
import os
import pathlib
import subprocess

PART = pathlib.Path(__file__).resolve().parents[9] / "core/scripts/lib/run-spec/turn/test-workers.sh"


def run(snippet, mirror):
    env = {**os.environ, "AIDE_QUEUE_MIRROR": str(mirror)}
    return subprocess.run(["bash", "-c", f'set -uo pipefail; source "{PART}"; {snippet}'], capture_output=True, text=True, env=env)


def test_ai_jobs_do_not_reduce_test_workers(tmp_path):
    mirror = tmp_path / "queue.json"
    mirror.write_text('[{"state":"running"},{"state":"done","landing":true}]')
    result = run('host_cores() { echo 10; }; test_workers_begin; echo "$AIDE_TEST_WORKERS"; test_workers_end', mirror)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "10"
    assert not list(tmp_path.glob("queue.json.test-runs/run.*"))


def test_another_live_recorder_shares_cores_and_a_dead_one_does_not(tmp_path):
    mirror = tmp_path / "queue.json"
    activity = tmp_path / "queue.json.test-runs"
    activity.mkdir()
    with subprocess.Popen(["sleep", "30"]) as other:
        try:
            (activity / f"run.{other.pid}").touch()
            # Reap a child to get a known dead process rather than assume an unused PID.
            dead = subprocess.Popen(["true"])
            dead.wait()
            (activity / f"run.{dead.pid}").touch()
            result = run('host_cores() { echo 10; }; test_workers_begin; echo "$AIDE_TEST_WORKERS"; test_workers_end', mirror)
            assert result.returncode == 0, result.stderr
            assert result.stdout.strip() == "5"
            assert (activity / f"run.{other.pid}").exists()
            assert not (activity / f"run.{dead.pid}").exists()
        finally:
            other.terminate()


def test_without_a_board_the_explicit_worker_count_is_preserved():
    env = {k: v for k, v in os.environ.items() if k != "AIDE_QUEUE_MIRROR"}
    env["AIDE_TEST_WORKERS"] = "3"
    result = subprocess.run(["bash", "-c", f'source "{PART}"; test_workers_begin; echo "$AIDE_TEST_WORKERS"; test_workers_end'], capture_output=True, text=True, env=env)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "3"
