"""The runner gives an error's problem and its fix apart, and every error it
writes has a fix or a reason it has none."""

import json
import re
import subprocess
from pathlib import Path

from .run_spec_error_registry import RUNNER_ERROR_REGISTRY

ROOT = Path(__file__).resolve().parents[7]
SCRIPTS = ROOT / "core" / "scripts"
SITE = re.compile(r'^\s*(?:[A-Za-z_][A-Za-z_ ]*\|\|\s*)?(?:.*\b(refuse_fix|refuse)\s+"|.*\berror_msg=(?!"")|.*"error":)')


def sources() -> list[Path]:
    return [SCRIPTS / "aide-run-spec", *sorted((SCRIPTS / "lib" / "run-spec").rglob("*.sh"))]


def sites() -> list[tuple[str, str, str]]:
    """(file:line, kind, text) for every refuse, refuse_fix, stop_step, error_msg= and
    hand-written "error": line, definitions, comments and resets left out."""
    found = []
    for path in sources():
        lines = path.read_text().splitlines()
        for number, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped.startswith("#") or re.match(r"(refuse|refuse_fix)\(\)", stripped) or 'refuse_fix "$1" ""' in line:
                continue
            if 'error_msg="$saved_error"' in line or "error_msg=\"\"" in line or 'error_msg="$2"' in line:
                continue
            kind = None
            if re.search(r'^\s*stop_step\s+', line):
                kind = "stop_step"
            elif re.search(r'\brefuse_fix\s+"', line):
                kind = "refuse_fix"
            elif re.search(r'\brefuse\s+"', line):
                kind = "refuse"
            elif re.search(r"\berror_msg=", line):
                kind = "error_msg"
            elif '"error":' in line:
                kind = "json"
            if kind:
                text = "\n".join(lines[number - 1 : number + 2])
                found.append((f"{path.relative_to(ROOT)}:{number}", kind, text))
    return found


def entry_for(text: str) -> dict | None:
    return next((e for e in RUNNER_ERROR_REGISTRY if re.search(e["pattern"], text)), None)


def test_every_error_the_runner_writes_has_a_fix_or_a_named_reason():
    """A site no entry covers fails, and the failure names it."""
    uncovered = [f"{where} {text.splitlines()[0].strip()[:90]}" for where, _, text in sites() if not entry_for(text)]
    assert not uncovered, "no registry entry covers:\n" + "\n".join(uncovered)


def test_a_site_with_a_fix_gives_it_apart_and_a_refuse_has_none():
    """An entry with a `solution` covers a site that writes it
    apart; a plain `refuse` is only ever covered by an `exempt` entry."""
    wrong = []
    for where, kind, text in sites():
        entry = entry_for(text)
        if not entry:
            continue
        if "solution" in entry:
            if kind == "refuse" or entry["solution"] not in text:
                wrong.append(f"{where} should give {entry['solution']!r} apart")
        elif kind == "refuse_fix":
            wrong.append(f"{where} gives a fix but its entry says there is none")
    assert not wrong, "\n".join(wrong)


def refusal(call: str) -> tuple[int, dict]:
    """Runs `call` with `refuse` and `refuse_fix` taken out of the runner's
    own source, and reads the one JSON line it prints."""
    source = SCRIPTS / "lib" / "run-spec" / "setup" / "arguments.sh"
    script = (
        "stage_error() { :; }; aide_part_close() { :; }; result_file=; "
        f'eval "$(sed -n \'/^refuse() {{/,/^}}/p;/^refuse_fix() {{/,/^}}/p\' {source})"; {call}'
    )
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
    return done.returncode, json.loads(done.stdout.strip().splitlines()[-1])


def test_a_refusal_with_a_fix_gives_the_problem_and_the_fix_apart():
    """`error` is the problem alone, `errorSolution` the fix."""
    code, line = refusal('refuse_fix "cannot fast-forward b" "merge it by hand"')
    assert code == 2
    assert line["error"] == "cannot fast-forward b"
    assert line["errorSolution"] == "merge it by hand"


def test_a_refusal_keeps_its_reason_and_extra_fields_beside_the_fix():
    code, line = refusal('refuse_fix "cannot bring b up to date" "merge it by hand" conflict \'{"conflict":{"files":["a"]}}\'')
    assert code == 2
    assert line["errorReason"] == "conflict"
    assert line["conflict"] == {"files": ["a"]}
    assert line["errorSolution"] == "merge it by hand"


def test_a_refusal_with_nothing_to_resolve_has_no_error_solution():
    """A refusal the board never makes gives no fix."""
    code, line = refusal('refuse "missing --project-dir"')
    assert code == 2
    assert line["error"] == "missing --project-dir"
    assert "errorSolution" not in line
