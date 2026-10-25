"""What a step may not reach: the AI tool's own sandbox, with a fixed list
of credentials and board secrets the runner denies to every step.

The sandbox confines a step's shell commands; Claude's file tools follow
permission rules instead, so the same list is written as deny rules too.
The paths are written `~/…`: a rule that starts with a single `/` is read
relative to the settings file and denies nothing (Claude Code 2.1.310).
"""

import json
import subprocess

import pytest

from ...conftest import run
from ..run_spec_results import CODEX_STREAM_OK, emits
from ..run_spec_status_files import with_status
from ..turn.test_aide_run_spec_review import _reviewing_claude


def _settings(argv):
    return json.loads(argv[argv.index("--settings") + 1])


@pytest.mark.parametrize("mode", ["bypassPermissions", "acceptEdits", "plan"])
def test_every_claude_step_runs_in_the_sandbox_with_no_way_out(runner, workspace, mode):
    rc, out, _ = run(runner, workspace, permission_mode=mode, dry_run=True)
    assert rc == 0, out
    sandbox = _settings(out["argv"])["sandbox"]
    assert sandbox["enabled"] is True
    assert sandbox["allowUnsandboxedCommands"] is False
    assert sandbox["autoAllowBashIfSandboxed"] is True


def test_commands_may_write_the_home_directory_but_not_the_denied_paths(runner, workspace):
    rc, out, _ = run(runner, workspace, dry_run=True)
    fs = _settings(out["argv"])["sandbox"]["filesystem"]
    assert "~/" in fs["allowWrite"]
    assert fs["denyRead"] == fs["denyWrite"]
    assert "~/.ssh" in fs["denyRead"]
    assert "~/.config/gh" in fs["denyRead"]


def test_the_file_tools_get_the_same_paths_as_deny_rules(runner, workspace):
    rc, out, _ = run(runner, workspace, dry_run=True)
    settings = _settings(out["argv"])
    denied = settings["sandbox"]["filesystem"]["denyRead"]
    rules = settings["permissions"]["deny"]
    for path in denied:
        assert f"Read({path}/**)" in rules and f"Edit({path}/**)" in rules, path
        assert f"Read({path})" in rules and f"Edit({path})" in rules, path
    assert not any(rule.startswith("Write(") for rule in rules), rules


def test_every_path_is_written_from_home_never_as_a_single_slash(runner, workspace):
    rc, out, _ = run(runner, workspace, dry_run=True)
    settings = _settings(out["argv"])
    for path in settings["sandbox"]["filesystem"]["denyRead"]:
        assert path.startswith("~/"), path
    for rule in settings["permissions"]["deny"]:
        assert rule.split("(", 1)[1].startswith("~/"), rule


def test_nothing_the_step_writes_in_is_denied(runner, workspace):
    """The step's worktrees sit under ~/.aide/dashboard/worktrees and point
    into their project's checkout under ~/.aide/dashboard/checkouts, and a
    scheduled run writes under ~/.aide/dashboard/schedule-output. A deny
    cannot be opened again for a folder under it, so none of them, nor a
    folder above them, is on the list."""
    rc, out, _ = run(runner, workspace, dry_run=True)
    denied = _settings(out["argv"])["sandbox"]["filesystem"]["denyRead"]
    for needed in ("~/.aide/dashboard/worktrees/p/s", "~/.aide/dashboard/checkouts/p/code",
                   "~/.aide/dashboard/schedule-output/p", "~/.aide/news-check"):
        for path in denied:
            assert not (needed == path or needed.startswith(path + "/")), (needed, path)


def test_the_review_turn_runs_in_the_sandbox_too(runner, workspace, fake_claude):
    """The review is a fresh session built from the step's own argv; it
    must not run with more reach than the step it reviews."""
    with_status(workspace, ["create", "analyze"])
    claude = _reviewing_claude(fake_claude, "review: no defects found")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 2, calls
    for call in calls:
        assert '"autoAllowBashIfSandboxed":true' in call, call


def test_codex_gets_no_claude_settings(runner, workspace, fake_codex):
    codex = fake_codex(emits(CODEX_STREAM_OK))
    run(runner, workspace, tool="codex", codex=codex)
    assert "--settings" not in fake_codex.calls.read_text()


def _note(workspace_root):
    script = workspace_root / "core/scripts/lib/run-spec/setup/sandbox.sh"
    return subprocess.run(["bash", "-c", f'source "{script}"; printf %s "$sandbox_note"'],
                          capture_output=True, text=True, check=True).stdout


def test_a_claude_step_is_told_it_cannot_run_browser_tests(runner, workspace, workspace_root):
    note = _note(workspace_root)
    assert note
    rc, out, _ = run(runner, workspace, dry_run=True)
    assert note in out["prompt"], out["prompt"]


def test_a_codex_step_is_not_told_about_a_sandbox_it_does_not_run_in(
    runner, workspace, workspace_root, fake_codex
):
    rc, out, _ = run(runner, workspace, tool="codex", codex=fake_codex("exit 1"), dry_run=True)
    assert rc == 0, out
    assert _note(workspace_root) not in out["prompt"]


def test_commands_may_write_the_temporary_directories_and_listen_on_localhost(runner, workspace):
    rc, out, _ = run(runner, workspace, dry_run=True)
    sandbox = _settings(out["argv"])["sandbox"]
    for path in ("/tmp", "/private/tmp", "/private/var/folders"):
        assert path in sandbox["filesystem"]["allowWrite"], path
    assert sandbox["network"]["allowLocalBinding"] is True

