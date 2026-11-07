"""board_words_ending (run-spec/publish/result.sh) decides which endings the
result leaves without a sentence; core/tests/fixtures/board-worded-endings.json
is the list the dashboard reads too."""

import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[8]
RESULT_SH = ROOT / "core" / "scripts" / "lib" / "run-spec" / "publish" / "result.sh"
CASES = json.loads((ROOT / "core" / "tests" / "fixtures" / "board-worded-endings.json").read_text())["cases"]


def board_words(case: dict) -> bool:
    """Runs the function alone, with the variables the runner holds when it builds the result."""
    result = case["result"]

    def field(name: str, empty: str) -> str:
        return json.dumps(result[name]) if name in result else empty

    script = "\n".join(
        [
            f"eval \"$(sed -n '/^board_words_ending() {{/,/^}}/p' {RESULT_SH})\"",
            f"terminal_reason={json.dumps(case['result']['terminalReason'])}",
            f"command_name={json.dumps(case['step'])}",
            f"time_limit_json={json.dumps(field('timeLimit', ''))}",
            f"shared_files_json={json.dumps(field('sharedFiles', ''))}",
            f"criteria_faults_json={json.dumps(field('criteriaFaults', ''))}",
            f"push_failures_json={json.dumps(field('pushFailures', '[]'))}",
            "board_words_ending",
        ]
    )
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
    assert done.returncode in (0, 1), done.stderr
    return done.returncode == 0


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_runner_leaves_the_sentence_out_exactly_for_the_endings_the_board_words_AC_1(case):
    """One answer per case in the list both sides read."""
    assert board_words(case) is case["boardWords"], case["name"]
