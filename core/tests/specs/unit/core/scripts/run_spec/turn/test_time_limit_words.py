"""A step's time limit as its stop sentence says it: in minutes, the unit the
Settings page sets it in, or in seconds when it is not whole minutes.
"""

import subprocess
from pathlib import Path

import pytest

LIB = Path(__file__).resolve().parents[8] / "core" / "scripts" / "lib" / "run-spec" / "turn" / "time-limit.sh"


def words(seconds: int) -> str:
    out = subprocess.run(
        ["bash", "-c", f'source "{LIB}"; time_limit_words {seconds}'], capture_output=True, text=True, check=True
    )
    return out.stdout.strip()


@pytest.mark.parametrize(("seconds", "said"), [(2400, "40-minute"), (60, "1-minute"), (5400, "90-minute")])
def test_a_limit_of_whole_minutes_is_said_in_minutes(seconds, said):
    assert words(seconds) == said


@pytest.mark.parametrize(("seconds", "said"), [(90, "90-second"), (5, "5-second")])
def test_a_limit_that_is_not_whole_minutes_is_said_in_seconds(seconds, said):
    assert words(seconds) == said
