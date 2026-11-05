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
def test_the_failing_tests_and_counts_are_read_from_the_output(case, tmp_path):
    got = _read(tmp_path, case["log"])
    assert got["tests"] == case["tests"]
    assert got["files"] == case["files"]
    assert got.get("failed") == case.get("failed")
    assert got.get("total") == case.get("total")


def test_a_missing_log_names_nothing(tmp_path):
    assert json.loads(_bash(f'failing_tests "{tmp_path}/none.log"')) == {"tests": [], "files": []}


def _against(tmp_path, failing, changed):
    (tmp_path / "failing.json").write_text(json.dumps(failing))
    (tmp_path / "changed.txt").write_text("".join(f"{c}\n" for c in changed))
    return json.loads(_bash(f'failing_tests_against_change "{tmp_path}/failing.json" "{tmp_path}/changed.txt"'))


def test_a_failing_file_the_change_touched_is_found_by_the_end_of_its_path(tmp_path):
    """Playwright names a file from its own config's folder, git from the
    repository's root: packages/web/e2e/x.spec.ts is e2e/x.spec.ts."""
    got = _against(
        tmp_path,
        {"tests": ["e2e/x.spec.ts:5 › a", "e2e/y.spec.ts:9 › b", "@x/email#test"],
         "files": ["e2e/x.spec.ts", "e2e/y.spec.ts", ""]},
        ["packages/web/e2e/x.spec.ts", "packages/web/src/app.ts"],
    )
    assert got == {"touched": True, "untouched": 1}


def test_a_name_that_only_ends_like_a_changed_file_is_not_that_file(tmp_path):
    got = _against(tmp_path, {"tests": ["x.spec.ts:5 › a"], "files": ["x.spec.ts"]}, ["e2e/max.spec.ts"])
    assert got == {"touched": False, "untouched": 1}


def test_tests_with_no_file_are_neither_touched_nor_untouched(tmp_path):
    got = _against(tmp_path, {"tests": ["@x/email#test"], "files": [""]}, ["a.ts"])
    assert got == {"touched": False, "untouched": 0}


def _varied(tmp_path, before, after):
    (tmp_path / "before.json").write_text(json.dumps({"tests": before, "files": [""] * len(before)}))
    (tmp_path / "after.json").write_text(json.dumps({"tests": after, "files": [""] * len(after)}))
    r = subprocess.run(
        ["bash", "-c", f'source "{PART}"; failing_tests_varied "{tmp_path}/before.json" "{tmp_path}/after.json"'],
        capture_output=True, text=True,
    )
    return r.returncode == 0


def test_a_test_that_fails_now_and_did_not_before_is_a_varied_run(tmp_path):
    assert _varied(tmp_path, ["a", "b"], ["b", "c"])


def test_a_fix_round_that_mended_some_of_the_tests_is_not_a_varied_run(tmp_path):
    """Run one fails A and B, the session mends A, run two fails B: that is
    progress on the change, not tests that fail at random."""
    assert not _varied(tmp_path, ["a", "b"], ["b"])
    assert not _varied(tmp_path, ["a", "b"], ["a", "b"])
