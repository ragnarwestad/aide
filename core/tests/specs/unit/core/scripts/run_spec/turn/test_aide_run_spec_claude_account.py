"""A step on another Claude account (--claude-config-dir): every Claude turn
of the step runs with that account's CLAUDE_CONFIG_DIR — the step's own, the
review, the verification and both kinds of fix turn — and a Codex turn beside
it does not (run-spec/turn/model-turn.sh).
"""

import re

import pytest

from ...conftest import run
from ..run_spec_results import emits
from ..run_spec_status_files import with_status
from .test_aide_run_spec_review_models import TWO_DEFECTS, _claude, _codex_says
from .step_tests.test_aide_run_spec_step_tests import _fixing_claude, _project_with_test_cmd

SESSION = "analysis-session-1"


@pytest.fixture
def account(tmp_path):
    path = tmp_path / "claude-2"
    path.mkdir()
    return str(path)


def _config_dirs(env_log):
    return re.findall(r"^CLAUDE_CONFIG_DIR=(.*)$", env_log.read_text(), re.M)


def test_every_claude_turn_of_the_step_runs_with_the_accounts_directory(
    runner, workspace, fake_claude, tmp_path, account
):
    """The implement, its review, the verification of the defects and the
    fix turn that follows: four Claude turns, one account."""
    with_status(workspace, ["create", "analyze"])
    claude = _claude(fake_claude, TWO_DEFECTS, "keep 1\nkeep 2", keep_in=tmp_path)
    rc, out, _ = run(runner, workspace, claude, command="implement", model="claude-sonnet-4",
                     review_model="claude-sonnet-4", verify_model="claude-opus-4", claude_config_dir=account)
    assert out["terminalReason"] == "completed", out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 4, calls
    assert _config_dirs(fake_claude.env_log) == [account] * 4


def test_the_fix_turn_after_red_tests_runs_with_the_accounts_directory(
    runner, workspace, fake_claude, account
):
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "test -f fixed.txt")
    rc, out, _ = run(runner, workspace, _fixing_claude(fake_claude), command="implement", claude_config_dir=account)
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 2
    assert _config_dirs(fake_claude.env_log) == [account] * 2


def test_a_step_with_no_account_is_given_no_directory_of_the_boards(runner, workspace, fake_claude, account):
    with_status(workspace, ["create", "analyze"])
    claude = _claude(fake_claude, "review: no defects found")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "completed", out
    assert account not in fake_claude.env_log.read_text()


def test_a_codex_review_beside_the_step_is_not_given_the_directory(
    runner, workspace, fake_claude, fake_codex, tmp_path, account
):
    with_status(workspace, ["create", "analyze"])
    claude = _claude(fake_claude, "review: no defects found")
    codex_env = tmp_path / "codex-env.txt"
    codex = fake_codex(f"env > {codex_env}\n" + emits(_codex_says("review: no defects found")))
    rc, out, _ = run(runner, workspace, claude, codex=codex, command="implement",
                     review_tool="codex", review_model="gpt-6.1-sol", claude_config_dir=account)
    assert out["terminalReason"] == "completed", out
    assert codex_env.exists() and "CLAUDE_CONFIG_DIR" not in codex_env.read_text()
    assert _config_dirs(fake_claude.env_log) == [account]


def test_a_codex_review_uses_its_own_account_directory(
    runner, workspace, fake_claude, fake_codex, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    codex_home = tmp_path / "codex-b"
    codex_home.mkdir()
    codex_env = tmp_path / "codex-review-env.txt"
    codex = fake_codex(f"env > {codex_env}\n" + emits(_codex_says("review: no defects found")))
    rc, out, _ = run(
        runner, workspace, _claude(fake_claude, "review: no defects found"), codex=codex,
        command="implement", review_tool="codex", review_model="gpt-6.1-sol",
        review_codex_home=str(codex_home),
    )
    assert out["terminalReason"] == "completed", out
    assert f"CODEX_HOME={codex_home}" in codex_env.read_text()


def test_a_directory_that_is_not_there_is_refused_before_any_turn_starts(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    missing = str(tmp_path / "gone")
    rc, out, _ = run(runner, workspace, _claude(fake_claude, "review: no defects found"), command="implement",
                     claude_config_dir=missing)
    assert rc != 0, out
    assert missing in out["error"] and "not there" in out["error"], out["error"]
    assert not fake_claude.calls.exists()


def test_a_step_that_continues_a_session_continues_it_on_the_accounts_directory(
    runner, workspace, fake_claude, account
):
    """The session is found under $CLAUDE_CONFIG_DIR/projects, so the resume
    and the directory travel together, and a fix turn after red tests resumes
    the step's own session with the same directory."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "test -f fixed.txt")
    rc, out, _ = run(runner, workspace, _fixing_claude(fake_claude), command="implement",
                     resume_session=SESSION, claude_config_dir=account)
    assert out["terminalReason"] == "completed", out
    calls = fake_claude.calls.read_text().splitlines()
    assert f"--resume {SESSION}" in calls[0], calls[0]
    assert "--resume" in calls[-1], calls[-1]
    assert _config_dirs(fake_claude.env_log) == [account] * len(calls)
