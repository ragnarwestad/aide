"""A side turn's own invocation settings stay its own: building and running a
review or verification leaves the step's settings as they were, and the
program it runs on comes from the same policy as the step's, `tool_bin`
(run-spec/turn/side-turn.sh beside run-spec/setup/invocation.sh)."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[9] / "core" / "scripts"


def _function(source: str, name: str, required: bool = True) -> str:
    """The definition of `name` in a bash source: from its header to the first
    closing brace at column 0, or nothing for a name not `required`."""
    match = re.search(rf"^{re.escape(name)}\(\) \{{.*?^\}}$", source, re.S | re.M)
    assert match or not required, name
    return match.group(0) if match else ""


def _bash(body: str, env: dict | None = None, project_root: str = "/nonexistent-project", check: bool = True):
    """Run `body` after the side turn's functions and their stubs. `env` replaces
    the environment, so no program of the machine's own is found by accident."""
    invocation = (SCRIPTS / "lib/run-spec/setup/invocation.sh").read_text()
    side = (SCRIPTS / "lib/run-spec/turn/side-turn.sh").read_text()
    spec_lib = (SCRIPTS / "_aide-spec-lib.sh").read_text()
    functions = "\n".join(
        [_function(invocation, n) for n in ("opencode_safety_flags", "codex_safety_flags", "invocation_build", "find_bin")]
        + [_function(invocation, "tool_bin", required=False), _function(spec_lib, "aide_config_get")]
        + [_function(side, n) for n in ("side_argv_for", "side_turn")]
    )
    stubs = f"""
turn_result_capture() {{ printf -v "$1" '%s' '{{}}'; }}
turn_result_apply() {{ :; }}
turn_result_field() {{ :; }}
step_settings_json() {{ printf '{{}}'; }}
run_model_turn() {{ seen_config="${{opencode_config:-}}"; seen_argv="${{argv[*]}}"; printf -v "$2" '%s' '{{}}'; }}
transcript=/dev/null; sandbox=no; invocation_add_dirs=(); srt_bin=/bin/echo; project_root='{project_root}'
claude_bin=""; codex_bin=""; opencode_bin=""
"""
    done = subprocess.run(
        ["/bin/bash", "-c", stubs + functions + "\n" + body],
        capture_output=True, text=True, check=False, env=env,
    )
    if check:
        assert done.returncode == 0, done.stderr
        return done.stdout
    return done


def _program(folder: Path, name: str) -> str:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_text("#!/bin/sh\nexit 0\n")
    path.chmod(0o755)
    return str(path)


@pytest.fixture
def machine(tmp_path):
    """A machine of its own: a HOME, a PATH folder, a project root, and an
    environment holding only what a test sets. jq comes along for the opencode
    turn's config."""
    home, on_path, project = tmp_path / "home", tmp_path / "path", tmp_path / "project"
    tools = tmp_path / "tools"
    tools.mkdir()
    (tools / "jq").symlink_to(shutil.which("jq"))
    for folder in (home, on_path, project / ".aide"):
        folder.mkdir(parents=True)
    env = {"HOME": str(home), "PATH": f"{on_path}:{tools}:/usr/bin:/bin"}

    def config(**keys):
        (project / ".aide" / "config").write_text("".join(f"{k}={v}\n" for k, v in keys.items()))

    return {"tmp": tmp_path, "home": home, "path": on_path, "project": str(project), "env": env, "config": config}


def _first(out: str) -> str:
    """The program side_argv_for put first, as the body prints it."""
    return out.strip().split(" ", 1)[0]


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


@pytest.mark.parametrize("which_tool,key", [
    ("claude", "AIDE_CLAUDE_BIN"), ("fake-claude", "AIDE_CLAUDE_BIN"),
    ("codex", "AIDE_CODEX_BIN"), ("opencode", "AIDE_OPENCODE_BIN"),
])
def test_an_explicit_program_wins_over_the_environment_and_the_project_config_AC_1(machine, which_tool, key):
    explicit = _program(machine["tmp"] / "explicit", "chosen")
    machine["config"](AIDE_CLAUDE_BIN=_program(machine["tmp"] / "config", "configured"))
    env = {**machine["env"], key: _program(machine["tmp"] / "env", "from-env")}
    out = _bash(f'tool_bin {which_tool} "{explicit}"', env=env, project_root=machine["project"])
    assert out == explicit


def test_a_stand_in_side_turn_runs_on_its_own_program_AC_1(machine):
    own = _program(machine["tmp"] / "own", "own-stand-in")
    env = {**machine["env"], "AIDE_CLAUDE_BIN": _program(machine["tmp"] / "env", "env-stand-in")}
    out = _bash(f'side_argv_for fake-claude fake-review "a review" "{own}"; echo "${{side_argv[*]}}"',
                env=env, project_root=machine["project"])
    assert _first(out) == own


def test_a_claude_side_turn_after_a_codex_step_runs_on_the_projects_claude_AC_2(machine):
    configured = _program(machine["tmp"] / "config", "configured-claude")
    machine["config"](AIDE_CLAUDE_BIN=configured)
    _program(machine["home"] / ".local" / "bin", "claude")
    _program(machine["path"], "claude")
    out = _bash('codex_bin=/bin/echo; side_argv_for claude some-model "a review"; echo "${side_argv[*]}"',
                env=machine["env"], project_root=machine["project"])
    assert _first(out) == configured


def test_a_stand_in_with_none_named_is_never_the_real_claude_AC_3(machine):
    _program(machine["home"] / ".local" / "bin", "claude")
    _program(machine["path"], "claude")
    done = _bash('tool_bin fake-claude ""', env=machine["env"], project_root=machine["project"], check=False)
    assert done.returncode != 0 and done.stdout == "", done
    done = _bash('side_argv_for fake-claude fake-review "a review" || echo refused',
                 env=machine["env"], project_root=machine["project"])
    assert done.strip() == "refused"


@pytest.mark.parametrize("which_tool", ["claude", "codex", "opencode"])
def test_with_no_override_local_bin_comes_before_path_and_nothing_found_prints_nothing_AC_4(machine, which_tool):
    run = lambda: _bash(f'tool_bin {which_tool} ""', env=machine["env"], project_root=machine["project"], check=False)
    assert run().stdout == ""
    on_path = _program(machine["path"], which_tool)
    assert run().stdout == on_path
    local = _program(machine["home"] / ".local" / "bin", which_tool)
    assert run().stdout == local


@pytest.mark.parametrize("which_tool", ["claude", "codex", "opencode"])
def test_a_side_turn_with_no_program_found_fails_for_its_caller_to_report_AC_5(machine, which_tool):
    out = _bash(f'side_argv_for {which_tool} some-model "a review" || echo failed; echo "argv=${{side_argv[*]}}"',
                env=machine["env"], project_root=machine["project"])
    assert out.splitlines() == ["failed", "argv="]


def test_a_side_turn_without_its_own_program_never_runs_on_the_steps_bin_AC_6(machine):
    step = _program(machine["tmp"] / "step", "step-program")
    env = {**machine["env"], "AIDE_CLAUDE_BIN": _program(machine["tmp"] / "env", "env-claude"),
           "AIDE_CODEX_BIN": _program(machine["tmp"] / "env", "env-codex")}
    for which_tool, step_global in [("claude", "claude_bin"), ("codex", "codex_bin"), ("opencode", "claude_bin")]:
        if which_tool == "opencode":
            _program(machine["path"], "opencode")
        out = _bash(f'{step_global}="{step}"; side_argv_for {which_tool} some/model "a review"; '
                    f'echo "${{side_argv[*]}}"', env=env, project_root=machine["project"])
        assert _first(out) != step, (which_tool, out)
        assert _first(out) == {"claude": env["AIDE_CLAUDE_BIN"], "codex": env["AIDE_CODEX_BIN"],
                               "opencode": str(machine["path"] / "opencode")}[which_tool]


def test_a_claude_side_turn_after_a_stand_in_step_runs_on_its_own_claude_AC_6(machine):
    stand_in = _program(machine["tmp"] / "stand-in", "stand-in")
    local = _program(machine["home"] / ".local" / "bin", "claude")
    out = _bash(f'claude_bin="{stand_in}"; side_argv_for claude some-model "a review"; echo "${{side_argv[*]}}"',
                env=machine["env"], project_root=machine["project"])
    assert _first(out) == local
