"""How many test workers a run may use (run-spec/turn/test-workers.sh).

The host's cores divided among the steps and landings running on the board,
rounded down and at least one. The landing makes the same decision in
TypeScript (dashboard/src/queue/test-workers.ts), and
core/tests/fixtures/test-workers.json pins both.
"""

import json
import pathlib
import subprocess

import pytest

CASES = json.loads(
    (pathlib.Path(__file__).resolve().parents[6] / "fixtures" / "test-workers.json").read_text()
)["cases"]
PART = pathlib.Path(__file__).resolve().parents[8] / "core" / "scripts" / "lib" / "run-spec" / "turn" / "test-workers.sh"


def _bash(snippet, env=None):
    return subprocess.run(
        ["bash", "-c", f'set -uo pipefail; source "{PART}"; {snippet}'],
        capture_output=True, text=True, env=env,
    )


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_share_is_the_cores_divided_by_the_jobs_running_or_landing_ac_1(case, tmp_path):
    mirror = tmp_path / "aide-queue.json"
    mirror.write_text(json.dumps(case["jobs"]))
    r = _bash(f'test_workers_share {case["cores"]} "{mirror}"')
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == str(case["workers"])


def test_a_mirror_that_is_not_json_counts_as_this_run_alone_ac_1(tmp_path):
    mirror = tmp_path / "aide-queue.json"
    mirror.write_text("{ not json")
    r = _bash(f'test_workers_share 10 "{mirror}"')
    assert r.stdout.strip() == "10", r.stderr


def test_a_mirror_that_is_gone_counts_as_this_run_alone_ac_1(tmp_path):
    r = _bash(f'test_workers_share 10 "{tmp_path}/missing.json"')
    assert r.stdout.strip() == "10", r.stderr


def test_without_a_queue_mirror_the_runner_works_out_no_share_ac_2():
    import os
    env = {k: v for k, v in os.environ.items() if k != "AIDE_QUEUE_MIRROR"}
    r = _bash("test_workers_now", env=env)
    assert r.returncode == 0, r.stderr
    assert r.stdout == ""
