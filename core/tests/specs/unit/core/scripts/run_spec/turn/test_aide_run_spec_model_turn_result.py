"""The internal result of one model turn is a complete, isolated value."""

import json
import subprocess
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[8] / "core" / "scripts"
RESULT = SCRIPTS / "lib" / "run-spec" / "turn" / "model-turn" / "result.sh"


def test_one_contract_captures_and_restores_every_turn_field_ac_1_ac_2_ac_3_ac_6():
    fields = {
        "session_out": "session-one",
        "subtype": "success",
        "cost": "1.25",
        "cost_measured": "true",
        "cost_known": "true",
        "terminal_reason": "completed",
        "error_msg": "message",
        "error_solution": "advice",
        "error_log": "provider words",
        "provider_limit_out": '{"window":"weekly"}',
        "at_capacity_out": "at capacity",
        "provider_error_out": '{"kind":"server"}',
        "time_limit_json": '{"seconds":60}',
        "tokens_json": '{"input":1,"output":2,"cacheRead":3,"cacheCreation":4,"total":10}',
        "model_id_out": "model-one",
        "exit_code": "7",
        "duration": "42",
        "turn_message": "done",
        "turn_from": "11",
        "turn_to": "99",
    }
    assignments = "\n".join(f"{name}={json.dumps(value)}" for name, value in fields.items())
    clear = "\n".join(f'{name}="changed"' for name in fields)
    reads = "\n".join(f"printf '%s\\0' \"${{{name}}}\"" for name in fields)
    command = f"""
set -u
source {RESULT!s}
{assignments}
turn_result_capture result
{clear}
turn_result_apply "$result"
{reads}
"""

    completed = subprocess.run(
        ["/bin/bash", "-c", command], capture_output=True, check=False
    )

    assert completed.returncode == 0, completed.stderr.decode()
    assert completed.stdout.decode().split("\0")[:-1] == list(fields.values())


def test_missing_optional_measurements_stay_missing_ac_3_ac_6():
    command = f"""
set -u
source {RESULT!s}
session_out=session-two subtype=success cost=0 cost_measured=false cost_known=false
terminal_reason=completed error_msg= error_solution= error_log=
provider_limit_out= at_capacity_out= provider_error_out= time_limit_json=
tokens_json= model_id_out= exit_code=0 duration=1 turn_message=done turn_from=0 turn_to=1
turn_result_capture result
printf '%s' "$result"
"""

    completed = subprocess.run(
        ["/bin/bash", "-c", command], capture_output=True, check=False
    )

    assert completed.returncode == 0, completed.stderr.decode()
    result = json.loads(completed.stdout)
    assert "tokens" not in result
    assert "providerLimit" not in result
    assert "modelId" not in result
    assert result["costKnown"] is False
