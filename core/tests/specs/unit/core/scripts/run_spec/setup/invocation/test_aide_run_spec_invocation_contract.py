"""The shared provider invocation contract and its public runner boundary."""

import os

from ....conftest import run


def test_the_claude_binary_can_be_named_in_the_projects_own_config(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    cfg = workspace["project"] / ".aide" / "config"
    cfg.write_text(cfg.read_text() + f"AIDE_CLAUDE_BIN={claude}\n")
    env_before = os.environ.pop("AIDE_CLAUDE_BIN", None)
    try:
        rc, out, _ = run(runner, workspace, dry_run=True)
    finally:
        if env_before is not None:
            os.environ["AIDE_CLAUDE_BIN"] = env_before
    assert rc == 0, out
    assert out["argv"][0] == str(claude)
    assert not fake_claude.calls.exists()


def test_the_environment_outranks_the_projects_config_for_the_claude_binary(runner, workspace, fake_claude):
    from_env = fake_claude("exit 1")
    cfg = workspace["project"] / ".aide" / "config"
    cfg.write_text(cfg.read_text() + "AIDE_CLAUDE_BIN=/nowhere/from-config\n")
    rc, out, _ = run(runner, workspace, from_env, dry_run=True)
    assert rc == 0, out
    assert out["argv"][0] == str(from_env)


def test_fresh_and_resumed_turns_use_one_contract_for_every_provider_ac_1_ac_2_ac_4(
    runner, workspace, fake_claude, fake_codex, fake_opencode
):
    scripts = runner.parent
    invocation_source = (scripts / "lib/run-spec/setup/invocation.sh").read_text()
    side_source = (scripts / "lib/run-spec/turn/side-turn.sh").read_text()
    assert "invocation_build()" in invocation_source
    assert 'invocation_build "$tool"' in invocation_source
    assert 'invocation_build "$side_tool"' in side_source

    cases = [
        ("claude", {"claude": fake_claude("exit 1")}, "model with spaces"),
        ("codex", {"codex": fake_codex("exit 1")}, "model with spaces"),
        ("opencode", {"opencode": fake_opencode("exit 1")}, "provider/model with spaces"),
    ]
    for tool, binary, model in cases:
        rc, out, _ = run(runner, workspace, tool=tool, model=model, dry_run=True, **binary)
        assert rc == 0, out
        assert out["argv"][out["argv"].index("--model") + 1] == model


def test_invalid_permission_data_refuses_before_a_provider_runs_ac_6_ac_7(
    runner, workspace, fake_codex
):
    codex = fake_codex("exit 41")
    rc, out, _ = run(
        runner, workspace, tool="codex", codex=codex,
        permission_mode="not-a-mode", dry_run=True,
    )
    assert rc == 2, out
    assert "permission" in out["error"].lower()
    assert not fake_codex.calls.exists()
