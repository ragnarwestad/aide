"""What git said when a push failed, sorted for the board (lib/git-error.sh).

`auth` when GitHub does not take the machine's key or login, `github` when
GitHub or the network failed, `refused` when origin turned the push down,
with origin's own first line, `other` with git's own first line, and
`none` when git said nothing. The detail behind the (?) is git's text in
whole lines, without colour codes or carriage returns. The landing sorts
its own pushes in TypeScript (dashboard/src/format/git-error.ts), and
core/tests/fixtures/git-errors.json pins both.
"""

import json
import pathlib
import subprocess

import pytest

HERE = pathlib.Path(__file__).resolve()
CASES = json.loads((HERE.parents[4] / "fixtures" / "git-errors.json").read_text())["cases"]
LIB = HERE.parents[6] / "core" / "scripts" / "lib" / "git-error.sh"


def _bash(snippet, *args):
    r = subprocess.run(
        ["bash", "-c", f'set -uo pipefail; source "{LIB}"; {snippet}', "_", *args],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    return r.stdout


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_a_failed_push_is_sorted_by_what_git_said(case):
    got = json.loads(_bash('git_error_json "$1"', case["said"]))
    assert got["kind"] == case["kind"]
    assert got.get("message") == case.get("message")


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_detail_is_whole_lines_without_carriage_returns(case):
    assert _bash('git_error_detail "$1"', case["said"]) == case["detail"]


def test_the_repo_and_the_branch_are_named():
    got = json.loads(_bash('git_error_json "$1" code aide/49-x', "remote: Internal Server Error"))
    assert got == {"kind": "github", "repo": "code", "branch": "aide/49-x"}
