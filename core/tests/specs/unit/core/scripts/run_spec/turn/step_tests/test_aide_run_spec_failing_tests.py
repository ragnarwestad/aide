"""The failing tests a red run names (run-spec/turn/failing-tests.sh).

Read from the run's own output, for Playwright, vitest, bun, pytest and
turbo, without colour codes, and never pnpm's error box or the recorder's
JSON line. The landing reads the same output in TypeScript
(dashboard/src/format/failing-tests.ts), and
core/tests/fixtures/failing-tests.json pins both.
"""

import json
import pathlib
import subprocess

import pytest

CASES = json.loads(
    (pathlib.Path(__file__).resolve().parents[7] / "fixtures" / "failing-tests.json").read_text()
)["cases"]
PART = pathlib.Path(__file__).resolve().parents[9] / "core" / "scripts" / "lib" / "run-spec" / "turn" / "failing-tests.sh"


def _bash(snippet):
    r = subprocess.run(
        ["bash", "-c", f'set -uo pipefail; source "{PART}"; {snippet}'],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    return r.stdout


def _read(tmp_path, lines):
    log = tmp_path / "tests.log"
    log.write_text("\n".join(lines) + "\n")
    return json.loads(_bash(f'failing_tests "{log}"'))


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_failing_tests_counts_and_errors_are_read_from_the_output_ac_1_ac_4(case, tmp_path):
    got = _read(tmp_path, case["log"])
    assert got["tests"] == case["tests"]
    assert got["files"] == case["files"]
    assert got["errors"] == case["errors"]
    assert got.get("failed") == case.get("failed")
    assert got.get("total") == case.get("total")


def test_a_missing_log_names_nothing_ac_1(tmp_path):
    assert json.loads(_bash(f'failing_tests "{tmp_path}/none.log"')) == {"tests": [], "files": [], "errors": []}


def test_failing_files_are_distinct_and_keep_their_order_ac_3(tmp_path):
    path = tmp_path / "failing.json"
    path.write_text(json.dumps({"tests": ["a", "b", "c"], "files": ["x.py", "y.py", "x.py"]}))
    assert _bash(f'failing_tests_files "{path}"').splitlines() == ["x.py", "y.py"]


def test_summary_keeps_each_error_with_its_test_ac_1(tmp_path):
    failing = tmp_path / "failing.json"
    again = tmp_path / "again.json"
    failing.write_text(json.dumps({
        "tests": ["test/a.test.ts › passes", "test/b.test.ts › stays red"],
        "files": ["test/a.test.ts", "test/b.test.ts"],
        "errors": ["error: passes alone", "error: remains red"], "failed": 2, "total": 12,
    }))
    again.write_text(json.dumps([
        {"file": "test/a.test.ts", "passed": True},
        {"file": "test/b.test.ts", "passed": False},
    ]))
    got = json.loads(_bash(f'failing_tests_summary "{failing}" "{again}"'))
    assert got == {
        "tests": ["test/b.test.ts › stays red"], "errors": ["error: remains red"], "failed": 1, "total": 12,
        "passedAlone": ["test/a.test.ts › passes"], "passedAloneErrors": ["error: passes alone"], "passedAloneCount": 1,
    }


def test_an_explicit_pass_is_kept_when_another_test_in_the_file_stays_red_ac_1(tmp_path):
    failing = tmp_path / "failing.json"
    again = tmp_path / "again.json"
    failing.write_text(json.dumps({
        "tests": ["test/a.test.ts › passes", "test/a.test.ts › stays red"],
        "files": ["test/a.test.ts", "test/a.test.ts"], "failed": 2,
    }))
    again.write_text(json.dumps([{
        "file": "test/a.test.ts", "passed": False,
        "passedTests": ["test/a.test.ts › passes"],
        "failedTests": ["test/a.test.ts › stays red"],
    }]))
    got = json.loads(_bash(f'failing_tests_summary "{failing}" "{again}"'))
    assert got["tests"] == ["test/a.test.ts › stays red"]
    assert got["passedAlone"] == ["test/a.test.ts › passes"]


def test_pytest_passes_are_read_from_plain_and_xdist_output_ac_1_ac_5(tmp_path):
    log = tmp_path / "again.log"
    log.write_text(
        "tests/test_one.py::test_plain PASSED [ 50%]\n"
        "[gw1] [100%] PASSED tests/test_one.py::test_xdist\n"
        "[gw0] [100%] FAILED tests/test_one.py::test_red\n"
    )
    assert json.loads(_bash(f'test_results "{log}"')) == {
        "passedTests": ["tests/test_one.py::test_plain", "tests/test_one.py::test_xdist"],
        "failedTests": ["tests/test_one.py::test_red"],
    }
