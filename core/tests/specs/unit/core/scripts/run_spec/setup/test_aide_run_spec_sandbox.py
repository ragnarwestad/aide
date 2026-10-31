"""What a step may not reach: the AI tool's own sandbox, with a fixed list
of credentials and board secrets the runner denies to every step.

The sandbox confines a step's shell commands; Claude's file tools follow
permission rules instead, so the same list is written as deny rules too.
The paths are written `~/…`: a rule that starts with a single `/` is read
relative to the settings file and denies nothing (Claude Code 2.1.310).
"""

import json
import os
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
    assert sandbox["failIfUnavailable"] is True
    assert sandbox["allowUnsandboxedCommands"] is False
    assert sandbox["autoAllowBashIfSandboxed"] is True


def test_commands_may_write_the_home_directory_but_not_the_denied_paths(runner, workspace):
    rc, out, _ = run(runner, workspace, dry_run=True)
    fs = _settings(out["argv"])["sandbox"]["filesystem"]
    assert "~/" in fs["allowWrite"]
    assert set(fs["denyRead"]) <= set(fs["denyWrite"])
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


def test_every_path_is_written_from_home_or_from_the_root_never_as_a_single_slash(runner, workspace):
    rc, out, _ = run(runner, workspace, dry_run=True)
    settings = _settings(out["argv"])
    for path in settings["sandbox"]["filesystem"]["denyWrite"]:
        assert path.startswith(("~/", "//")), path
    for rule in settings["permissions"]["deny"]:
        assert rule.split("(", 1)[1].startswith(("~/", "//")), rule


@pytest.mark.parametrize("path", ["~/.zshrc", "~/.zshenv", "~/.bashrc", "~/Library/LaunchAgents",
                                  "~/.local/bin", "~/.gitconfig", "~/.claude/settings.json",
                                  "~/.claude/hooks", "~/.claude/skills", "~/.agents",
                                  "~/.aide/dashboard/queue-config.json"])
def test_what_runs_outside_the_sandbox_may_be_read_but_not_written(runner, workspace, path):
    """A login shell, launchd, PATH, git and the AI tools run these outside
    the sandbox, and the board's queue settings may turn it off for a
    schedule entry; a step that wrote them would get out."""
    rc, out, _ = run(runner, workspace, dry_run=True)
    settings = _settings(out["argv"])
    fs = settings["sandbox"]["filesystem"]
    rules = settings["permissions"]["deny"]
    assert path in fs["denyWrite"] and path not in fs["denyRead"]
    assert f"Edit({path})" in rules and f"Edit({path}/**)" in rules
    assert f"Read({path})" not in rules


def test_the_steps_own_checkouts_keep_their_git_hooks_and_settings(runner, workspace):
    rc, out, _ = run(runner, workspace, dry_run=True)
    settings = _settings(out["argv"])
    project = subprocess.run(["git", "-C", str(workspace["project"]), "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, check=True).stdout.strip()
    for name in ("hooks", "config"):
        path = f"/{project}/.git/{name}"
        assert path in settings["sandbox"]["filesystem"]["denyWrite"], path
        assert f"Edit({path})" in settings["permissions"]["deny"], path


def test_every_dashboard_checkout_keeps_its_git_hooks_and_its_settings_file(workspace_root, tmp_path):
    """The board runs git in every checkout and a project's test command
    from its settings.yaml, outside the sandbox, so a step may write none
    of them, the step's own project or not. A settings.yaml that is not
    there is denied too, so none can be made."""
    home = tmp_path / "home"
    for project in ("alpha", "beta"):
        for repo in ("code", "specs"):
            subprocess.run(["git", "init", "-q", str(home / f".aide/dashboard/checkouts/{project}/{repo}")],
                           check=True)
    (home / ".aide/dashboard/checkouts/alpha/settings.yaml").write_text("test: x\n")
    script = workspace_root / "core/scripts/lib/run-spec/setup/sandbox.sh"
    out = subprocess.run(["bash", "-c", f'source "{script}"; sandbox_settings_json'],
                         capture_output=True, text=True, check=True,
                         env={**os.environ, "HOME": str(home)}).stdout
    denied = json.loads(out)["sandbox"]["filesystem"]["denyWrite"]
    for project in ("alpha", "beta"):
        assert f"~/.aide/dashboard/checkouts/{project}/settings.yaml" in denied, denied
        for repo in ("code", "specs"):
            for name in ("hooks", "config"):
                assert f"~/.aide/dashboard/checkouts/{project}/{repo}/.git/{name}" in denied, denied


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



def test_a_schedule_entry_may_run_claude_without_the_sandbox(runner, workspace, workspace_root, fake_claude):
    """A scheduled job whose commands start a browser runs without it
    (`--no-sandbox`, its entry's own `sandbox: false`), and is not told
    about a sandbox it does not run in."""
    from ..turn.test_aide_run_spec_schedule import FINISHED, job, schedule, with_prompt

    with_prompt(workspace)
    rc, out, _ = schedule(runner, workspace, job(fake_claude, FINISHED), no_sandbox=True)
    assert rc == 0, out
    call = fake_claude.calls.read_text()
    assert "--settings" not in call.split()
    assert _note(workspace_root) not in call


@pytest.mark.parametrize("asked, why", [({"command": "analyze"}, "--command schedule"), ({"tool": "codex"}, "--tool claude")])
def test_no_sandbox_is_refused_outside_a_scheduled_claude_job(runner, workspace, fake_claude, asked, why):
    from ..turn.test_aide_run_spec_schedule import FINISHED, job, schedule, with_prompt

    with_prompt(workspace)
    rc, out, _ = schedule(runner, workspace, job(fake_claude, FINISHED), no_sandbox=True, **asked)
    assert rc == 2, out
    assert "--no-sandbox" in out["error"] and why in out["error"], out["error"]
    assert not fake_claude.calls.exists()


def test_a_schedule_prompt_is_read_as_committed_never_off_the_disk(runner, workspace, fake_claude):
    """A step's shell may write the main checkout, and a schedule entry may
    run without the sandbox: what such a run is told must be what was
    committed, not what a step left in the file."""
    from ..turn.test_aide_run_spec_schedule import FINISHED, job, schedule, with_prompt

    with_prompt(workspace)
    (workspace["project"] / "docs" / "nightly-report.md").write_text("Planted by a step.\n")
    rc, out, _ = schedule(runner, workspace, job(fake_claude, FINISHED), dry_run=True)
    assert rc == 0, out
    assert "Write the report." in out["prompt"]
    assert "Planted by a step." not in out["prompt"]


def test_a_worktree_git_file_the_step_rewrote_is_put_back_before_the_runner_runs_git(
    runner, workspace, fake_claude, tmp_path
):
    """A `.git` file pointed at a git directory of the step's own would hand
    the runner's git, outside the sandbox, hooks of the step's choosing."""
    from ..turn.test_aide_run_spec_schedule import FINISHED, job, schedule, with_prompt

    with_prompt(workspace)
    planted = tmp_path / "planted-gitdir"
    claude = job(fake_claude, f"cp .git {tmp_path}/seen; printf 'gitdir: {planted}\\n' > .git\n" + FINISHED)
    rc, out, _, err = schedule(runner, workspace, claude, return_stderr=True)
    assert rc == 0, (out, err)
    assert "the step rewrote" in err and "/.git; it is put back" in err, err


def test_the_boards_own_queue_settings_and_checkouts_are_denied_where_it_says_they_are(workspace_root, tmp_path):
    """The board hands over where its files are (AIDE_QUEUE_CONFIG,
    AIDE_CHECKOUT_ROOT); a board set up anywhere else is covered too."""
    board = tmp_path / "board"
    subprocess.run(["git", "init", "-q", str(board / "checkouts/alpha/code")], check=True)
    script = workspace_root / "core/scripts/lib/run-spec/setup/sandbox.sh"
    out = subprocess.run(["bash", "-c", f'source "{script}"; sandbox_settings_json'],
                         capture_output=True, text=True, check=True,
                         env={**os.environ, "HOME": str(tmp_path / "home"),
                              "AIDE_QUEUE_CONFIG": str(board / "queue-config.json"),
                              "AIDE_CHECKOUT_ROOT": str(board / "checkouts")}).stdout
    denied = json.loads(out)["sandbox"]["filesystem"]["denyWrite"]
    for path in ("queue-config.json", "checkouts/alpha/settings.yaml", "checkouts/alpha/code/.git/hooks"):
        assert f"/{board}/{path}" in denied, (path, denied)
