"""A side turn's own invocation settings stay its own: building and running a
review or verification leaves the step's settings as they were
(run-spec/turn/side-turn.sh beside run-spec/setup/invocation.sh)."""

import re
import subprocess
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[9] / "core" / "scripts"


def _function(source: str, name: str) -> str:
    """The definition of `name` in a bash source: from its header to the first
    closing brace at column 0."""
    match = re.search(rf"^{re.escape(name)}\(\) \{{.*?^\}}$", source, re.S | re.M)
    assert match, name
    return match.group(0)


def _bash(body: str) -> str:
    invocation = (SCRIPTS / "lib/run-spec/setup/invocation.sh").read_text()
    side = (SCRIPTS / "lib/run-spec/turn/side-turn.sh").read_text()
    functions = "\n".join(
        [_function(invocation, n) for n in ("opencode_safety_flags", "codex_safety_flags", "invocation_build")]
        + [_function(side, n) for n in ("side_argv_for", "side_turn")]
    )
    stubs = """
turn_result_capture() { printf -v "$1" '%s' '{}'; }
turn_result_apply() { :; }
turn_result_field() { :; }
run_model_turn() { seen_config="${opencode_config:-}"; seen_argv="${argv[*]}"; printf -v "$2" '%s' '{}'; }
transcript=/dev/null; sandbox=no; invocation_add_dirs=(); srt_bin=/bin/echo
"""
    done = subprocess.run(
        ["/bin/bash", "-c", stubs + functions + body],
        capture_output=True, text=True, check=False,
    )
    assert done.returncode == 0, done.stderr
    return done.stdout


def test_an_opencode_review_runs_on_its_own_config_and_leaves_the_steps_config_as_it_was():
    out = _bash("""
tool=opencode; argv=(main-argv); opencode_config=STEP; safety_flags=(--agent build --auto)
side_argv_for opencode some/model "a review" /bin/echo
printf 'after-build=%s\\n' "$opencode_config"
side_turn opencode /dev/null "" ""
printf 'seen=%s\\nafter-turn=%s\\nargv=%s\\nflags=%s\\n' "$seen_config" "$opencode_config" "${argv[*]}" "${safety_flags[*]}"
""")
    lines = dict(line.split("=", 1) for line in out.splitlines())
    assert lines["after-build"] == "STEP"
    assert '"edit":"deny"' in lines["seen"]
    assert lines["after-turn"] == "STEP"
    assert lines["argv"] == "main-argv"
    assert lines["flags"] == "--agent build --auto"


def test_a_codex_review_runs_without_the_steps_opencode_config():
    out = _bash("""
tool=opencode; argv=(main-argv); opencode_config=STEP
side_argv_for codex some-model "a review" /bin/echo
side_turn codex /dev/null "" ""
printf 'seen=%s\\nafter-turn=%s\\n' "$seen_config" "$opencode_config"
""")
    lines = dict(line.split("=", 1) for line in out.splitlines())
    assert lines["seen"] == ""
    assert lines["after-turn"] == "STEP"
