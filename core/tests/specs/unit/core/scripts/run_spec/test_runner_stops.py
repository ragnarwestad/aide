"""The runner stops a step through one helper and calls loaded functions directly."""

import json
import re
import subprocess
from pathlib import Path

from .test_runner_error_solutions import SCRIPTS, sources

ROOT = Path(__file__).resolve().parents[7]
RUNNER = SCRIPTS / "aide-run-spec"


def stopped(call: str, *, model_suffix: str | None = None, error_log: str = "") -> tuple[subprocess.CompletedProcess, dict]:
    setup = ["set -u", 'terminal_reason="completed"', 'ok="true"', 'suffix=""', 'error_msg=""', 'error_solution=""']
    if model_suffix is not None:
        setup.append(f"model_suffix={model_suffix!r}")
    setup.append(f"error_log={error_log!r}")
    script = "; ".join(setup) + "; " + (
        f'eval "$(sed -n \'/^stop_suffix() {{/,/^}}/p;/^stop_step() {{/,/^}}/p\' {RUNNER})"; '
        f"{call}; jq -cn --arg terminal_reason \"$terminal_reason\" --arg ok \"$ok\" "
        '--arg suffix "$suffix" --arg amend_note "${amend_note-}" --arg error_msg "$error_msg" '
        '--arg error_solution "$error_solution" --arg error_log "$error_log" '
        "'{terminal_reason:$terminal_reason,ok:$ok,suffix:$suffix,amend_note:$amend_note,error_msg:$error_msg,error_solution:$error_solution,error_log:$error_log}'"
    )
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
    line = json.loads(done.stdout.strip().splitlines()[-1]) if done.stdout.strip() else {}
    return done, line


def test_stop_step_sets_every_stop_field_and_the_amend_note_ac_1():
    done, line = stopped('stop_step tests-red "tests failed" "fix them"', model_suffix=" (model: claude opus)")
    assert done.returncode == 0, done.stderr
    assert line == {
        "terminal_reason": "tests-red", "ok": "false", "suffix": " (stopped: tests-red)",
        "amend_note": " (model: claude opus) (stopped: tests-red)", "error_msg": "tests failed",
        "error_solution": "fix them", "error_log": "",
    }


def test_stop_step_works_before_model_suffix_exists_under_set_u_ac_1():
    done, line = stopped('stop_step no-progress "nothing changed" "try again"')
    assert done.returncode == 0, done.stderr
    assert line["amend_note"] == " (stopped: no-progress)"


def test_stop_step_writes_nothing_and_keeps_error_log_ac_1_ac_4():
    done, line = stopped('stop_step tests-red "tests failed" "fix them"', error_log="earlier")
    assert done.returncode == 0, done.stderr
    assert done.stderr == ""
    assert len(done.stdout.strip().splitlines()) == 1
    assert line["error_log"] == "earlier"


def test_stop_suffix_changes_only_the_commit_mark_ac_2():
    done, line = stopped("stop_suffix cancelled")
    assert done.returncode == 0, done.stderr
    assert line["suffix"] == " (stopped: cancelled)"
    assert line["terminal_reason"] == "completed"
    assert line["ok"] == "true"
    assert line["error_msg"] == ""


def located(pattern: str) -> list[str]:
    found = []
    for path in sources():
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if pattern in line:
                found.append(f"{path.relative_to(ROOT)}:{number}: {line.strip()}")
    return found


def test_stop_suffix_is_the_only_assignment_of_the_stop_mark_ac_2():
    found = located('suffix=" (stopped: ')
    assert len(found) == 1, "stop marks:\n" + "\n".join(found)
    assert found[0].startswith("core/scripts/aide-run-spec:")


def test_ok_false_is_set_only_by_the_helper_and_two_derivations_ac_2():
    allowed = []
    unexpected = []
    for path in sources():
        lines = path.read_text().splitlines()
        for index, line in enumerate(lines):
            if 'ok="false"' not in line:
                continue
            before = lines[index - 1] if index else ""
            after = lines[index + 1] if index + 1 < len(lines) else ""
            location = f"{path.relative_to(ROOT)}:{index + 1}: {line.strip()}"
            if path == RUNNER and any("stop_step()" in item for item in lines[max(0, index - 3):index + 1]):
                allowed.append(location)
            elif '[ "$terminal_reason" = "completed" ] && ok="true"' in after:
                allowed.append(location)
            elif 'command_name" = "implement"' in before and 'terminal_reason" != "completed"' in before:
                allowed.append(location)
            else:
                unexpected.append(location)
    assert not unexpected, "hand-written ok=false:\n" + "\n".join(unexpected)
    assert len(allowed) == 3, "allowed ok=false sites:\n" + "\n".join(allowed)


def test_no_always_loaded_function_is_guarded_before_it_is_called_ac_3():
    runner = RUNNER.read_text()
    parts = re.search(r"for _part in (.*); do need_part", runner).group(1).split()
    definitions = set()
    for path in [SCRIPTS / "_aide-spec-lib.sh", *(SCRIPTS / "lib" / part for part in parts)]:
        for line in path.read_text().splitlines():
            match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\(\) \{", line)
            if match:
                definitions.add(match.group(1))
    guarded = []
    for path in sources():
        lines = path.read_text().splitlines()
        for index, line in enumerate(lines):
            match = re.search(r"declare -f ([A-Za-z_][A-Za-z0-9_]*)", line)
            if not match or match.group(1) not in definitions:
                continue
            next_line = lines[index + 1] if index + 1 < len(lines) else ""
            if "|| source" not in line and "|| source" not in next_line:
                guarded.append(f"{path.relative_to(ROOT)}:{index + 1}: {line.strip()}")
    assert not guarded, "always-loaded functions guarded:\n" + "\n".join(guarded)
