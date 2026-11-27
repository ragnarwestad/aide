"""What a Codex or OpenCode turn may reach: it starts inside srt, with the
same denied paths a Claude step's sandbox has, its own login left readable,
and what it may write set by its permission mode."""

import json
import os
import re

import pytest

from ....conftest import run
from ...run_spec_results import CODEX_STREAM_OK, OPENCODE_STREAM_OK, RESULT_OK, emits
from ...run_spec_status_files import with_status
from ...turn.test_aide_run_spec_review_models import _claude, _codex_says


def _rule(path):
    """A path the way srt reads it: `~/…` under the home directory."""
    home = os.path.expanduser("~") + "/"
    return "~/" + path[len(home):] if path.startswith(home) else path


def _turns(workspace):
    """Each srt call's arguments and the settings it was handed, in order."""
    beside = workspace["project"].parent
    calls = (beside / "srt-calls.txt").read_text().splitlines() if (beside / "srt-calls.txt").exists() else []
    return [(call.split(), json.loads((beside / f"srt-settings-{n}.json").read_text()))
            for n, call in enumerate(calls)]


def _codex(runner, workspace, fake_codex, mode="bypassPermissions"):
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, permission_mode=mode)
    assert rc == 0, out
    ((argv, settings),) = _turns(workspace)
    return argv, settings


def test_a_codex_step_starts_inside_srt_with_its_own_sandbox_off(runner, workspace, fake_codex):
    argv, _ = _codex(runner, workspace, fake_codex)
    assert argv[0] == "--settings" and argv[2] == "--", argv
    assert argv[3].endswith("fake-codex"), argv
    codex = fake_codex.calls.read_text()
    assert "--dangerously-bypass-approvals-and-sandbox" in codex and "--sandbox" not in codex, codex


def test_a_codex_turn_cannot_read_keys_or_the_board_but_reads_its_own_login(runner, workspace, fake_codex):
    _, settings = _codex(runner, workspace, fake_codex)
    fs = settings["filesystem"]
    for path in ("~/.ssh", "~/.config/gh", "~/.aide/dashboard/queue-token", "~/Library/Keychains",
                 "~/.local/share/opencode/auth.json"):
        assert path in fs["denyRead"], path
    assert "~/.codex/auth.json" not in fs["denyRead"] + fs["denyWrite"]
    assert set(fs["denyRead"]) <= set(fs["denyWrite"])


def test_a_codex_login_that_is_a_link_stays_readable_where_it_points(runner, workspace, fake_codex, tmp_path, monkeypatch):
    """A Codex folder whose `auth.json` links to the one in `~/.codex`, as a
    replay's copy does: srt follows the link, so the file it points at is the
    login the turn reads."""
    home = tmp_path / "codex-home"
    home.mkdir()
    (home / "auth.json").symlink_to(os.path.expanduser("~/.codex/auth.json"))
    monkeypatch.setenv("CODEX_HOME", str(home))
    _, settings = _codex(runner, workspace, fake_codex)
    fs = settings["filesystem"]
    assert "~/.codex/auth.json" not in fs["denyRead"], fs["denyRead"]
    assert "~/.ssh" in fs["denyRead"]


@pytest.mark.parametrize("target", ["~/.ssh", "~/.aide/dashboard/queue-token", "~/.config/gh"])
def test_a_codex_login_linked_anywhere_else_opens_nothing(runner, workspace, fake_codex, tmp_path, monkeypatch, target):
    """A turn may write its own Codex folder, so it could leave `auth.json` as
    a link to a key for the next turn: only a link to a known login counts."""
    home = tmp_path / "codex-home"
    home.mkdir()
    (home / "auth.json").symlink_to(os.path.expanduser(target))
    monkeypatch.setenv("CODEX_HOME", str(home))
    _, settings = _codex(runner, workspace, fake_codex)
    assert target in settings["filesystem"]["denyRead"], settings["filesystem"]["denyRead"]


@pytest.mark.parametrize("listed", ["as-is", "trailing-slash", "through-a-link"])
@pytest.mark.parametrize("target", ["~/.codex/auth.json", "other-account/auth.json"])
def test_a_link_in_a_board_codex_account_opens_no_other_login(runner, workspace, fake_codex, tmp_path, monkeypatch,
                                                               target, listed):
    """A turn in one of the board's Codex accounts may write that folder, so a
    link it leaves there to another account's login is not followed, however
    the board writes the folder's path."""
    home, other = tmp_path / "account", tmp_path / "other-account"
    home.mkdir()
    other.mkdir()
    (other / "auth.json").write_text("{}")
    (tmp_path / "alias").symlink_to(home)
    login = os.path.expanduser(target) if target.startswith("~") else str(tmp_path / target)
    (home / "auth.json").symlink_to(login)
    monkeypatch.setenv("CODEX_HOME", str(home))
    account = {"as-is": str(home), "trailing-slash": f"{home}/", "through-a-link": str(tmp_path / "alias")}[listed]
    monkeypatch.setenv("AIDE_CODEX_HOMES", f"{account}\n{other}")
    _, settings = _codex(runner, workspace, fake_codex)
    assert _rule(login) in settings["filesystem"]["denyRead"], settings["filesystem"]["denyRead"]


def test_a_codex_turn_writes_its_sessions_but_not_its_settings(runner, workspace, fake_codex):
    _, settings = _codex(runner, workspace, fake_codex)
    denied = settings["filesystem"]["denyWrite"]
    assert "~/.codex" not in denied
    for name in ("config.toml", "AGENTS.md", "AGENTS.override.md", "hooks", "skills", "rules", "prompts"):
        assert f"~/.codex/{name}" in denied, name
    for path in ("~/.zshrc", "~/.local/bin", "~/.gitconfig", "~/.claude/settings.json"):
        assert path in denied, path


def test_only_codex_gets_the_macos_certificate_service(runner, workspace, fake_codex, fake_opencode):
    _, settings = _codex(runner, workspace, fake_codex)
    assert settings["enableWeakerNetworkIsolation"] is True
    rc, out, _ = run(runner, workspace, tool="opencode", opencode=fake_opencode(emits(OPENCODE_STREAM_OK)),
                     permission_mode="bypassPermissions")
    assert rc == 0, out
    assert "enableWeakerNetworkIsolation" not in _turns(workspace)[-1][1]


def test_an_opencode_turn_reads_its_own_login_and_not_codex_s(runner, workspace, fake_opencode):
    rc, out, _ = run(runner, workspace, tool="opencode", opencode=fake_opencode(emits(OPENCODE_STREAM_OK)),
                     permission_mode="bypassPermissions")
    assert rc == 0, out
    ((argv, settings),) = _turns(workspace)
    assert argv[3].endswith("fake-opencode"), argv
    denied = settings["filesystem"]["denyRead"]
    assert "~/.local/share/opencode/auth.json" not in denied
    assert "~/.codex/auth.json" in denied and "~/.ssh" in denied
    assert "~/.codex" in settings["filesystem"]["denyWrite"]
    # The programs OpenCode runs, also when a person uses it outside srt.
    for path in ("~/.cache/opencode/bin", "~/.cache/opencode/node_modules"):
        assert path in settings["filesystem"]["denyWrite"], path


def test_a_turn_reaches_only_the_listed_hosts(runner, workspace, fake_codex):
    _, settings = _codex(runner, workspace, fake_codex)
    network = settings["network"]
    assert network["deniedDomains"] == []
    assert "chatgpt.com" in network["allowedDomains"]
    assert all(re.fullmatch(r"(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+", d) for d in network["allowedDomains"])


@pytest.mark.parametrize("mode, home, writes", [("bypassPermissions", True, True), ("acceptEdits", False, True),
                                               ("plan", False, False)])
def test_the_permission_mode_decides_what_the_turn_may_write_and_reach(runner, workspace, fake_codex, mode, home, writes):
    """A read-only turn reaches the AI providers alone; a turn that may
    write also reaches GitHub and the package registries."""
    _, settings = _codex(runner, workspace, fake_codex, mode)
    allowed = settings["filesystem"]["allowWrite"]
    assert ("~/" in allowed) is home, allowed
    assert "/tmp" in allowed and "~/.codex" in allowed
    hosts = settings["network"]["allowedDomains"]
    assert "chatgpt.com" in hosts
    assert ("registry.npmjs.org" in hosts and "github.com" in hosts) is writes, hosts


def test_accept_edits_may_write_the_worktree_and_plan_may_not(runner, workspace, fake_codex):
    _, settings = _codex(runner, workspace, fake_codex, "acceptEdits")
    (worktree,) = set(fake_codex.cwd_log.read_text().split())
    assert _rule(worktree) in settings["filesystem"]["allowWrite"], settings["filesystem"]["allowWrite"]


def test_no_turn_may_rewrite_the_settings_the_next_one_starts_with(runner, workspace, fake_codex):
    argv, settings = _codex(runner, workspace, fake_codex)
    assert _rule(argv[1]) in settings["filesystem"]["denyWrite"], argv[1]


def test_a_claude_step_does_not_start_inside_srt(runner, workspace, fake_claude):
    rc, out, _ = run(runner, workspace, fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'"))
    assert rc == 0, out
    assert _turns(workspace) == []


def test_a_codex_step_without_srt_does_not_start(runner, workspace, fake_codex, monkeypatch):
    monkeypatch.setenv("AIDE_SRT_BIN", str(workspace["project"].parent / "no-srt-here"))
    rc, out, _ = run(runner, workspace, tool="codex", codex=fake_codex(emits(CODEX_STREAM_OK)))
    assert rc != 0
    assert "cannot find srt" in out["error"], out
    assert "mise use -g npm:@anthropic-ai/sandbox-runtime@" in out["errorSolution"], out
    assert not fake_codex.calls.exists()


def test_a_review_on_codex_beside_a_claude_step_runs_inside_srt_read_only(
    runner, workspace, fake_claude, fake_codex
):
    with_status(workspace, ["create", "analyze"])
    claude = _claude(fake_claude, "review: no defects found")
    codex = fake_codex(emits(_codex_says("review: no defects found")))
    rc, out, _ = run(runner, workspace, claude, codex=codex, command="implement",
                     review_tool="codex", review_model="gpt-6.1-sol")
    assert out["terminalReason"] == "completed", out
    ((argv, settings),) = _turns(workspace)
    assert argv[3].endswith("fake-codex"), argv
    assert "~/" not in settings["filesystem"]["allowWrite"]


def test_a_review_on_codex_without_srt_stops_the_step_and_says_why(
    runner, workspace, fake_claude, fake_codex, monkeypatch
):
    with_status(workspace, ["create", "analyze"])
    monkeypatch.setenv("AIDE_SRT_BIN", str(workspace["project"].parent / "no-srt-here"))
    claude = _claude(fake_claude, "review: no defects found")
    codex = fake_codex(emits(_codex_says("review: no defects found")))
    rc, out, _, err = run(runner, workspace, claude, codex=codex, command="implement",
                          review_tool="codex", review_model="gpt-6.1-sol", return_stderr=True)
    assert out["terminalReason"] == "cli-error", out
    assert not fake_codex.calls.exists()
    assert "Review on gpt-6.1-sol could not run: cannot find srt" in err, err


def test_the_runner_and_the_installer_name_the_same_srt(workspace_root):
    runner_side = re.search(r'^SRT_PACKAGE="([^"]+)"', (workspace_root / "core/scripts/lib/run-spec/setup/srt.sh").read_text(), re.M)
    installer = re.search(r'^MISE_PINNED_TOOLS="([^"]*)"', (workspace_root / "core/scripts/_install-bin.sh").read_text(), re.M)
    assert runner_side and installer
    assert f"{runner_side.group(1)}=srt" in installer.group(1).split()
