"""aide-run-spec: the manifest's `worktreeSetup` command, run in the step's
project worktree after its links are made and before the AI session."""

import json
from ...conftest import READ_SPECS, run
from ..run_spec_results import RESULT_OK


def manifest(workspace, setup=None):
    text = "AIDE_TEST_CMD: true\nworktreeLinks: deps\n"
    if setup is not None:
        text += f"worktreeSetup: {setup}\n"
    (workspace["project"] / ".aide" / "project.yaml").write_text(text)


def observing_claude(fake_claude, workspace, setup_log):
    """A claude that records whether the setup had already run when it
    started — the only moment the question can be asked."""
    seen = workspace["project"].parent / "claude-saw-setup.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'if [ -f "{setup_log}" ]; then echo yes > "{seen}"; else echo no > "{seen}"; fi\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    return claude, seen


def test_the_setup_runs_in_the_project_worktree_after_the_links_and_before_the_session_ac_1_ac_4(
    runner, workspace, fake_claude,
):
    setup_log = workspace["project"].parent / "setup-ran.txt"
    manifest(workspace, f'echo "$PWD" >> {setup_log}; if [ -L deps ]; then echo linked >> {setup_log}; fi; echo installing-deps')
    claude, seen = observing_claude(fake_claude, workspace, setup_log)
    rc, out, _, err = run(runner, workspace, claude, return_stderr=True)
    assert rc == 0, out
    assert seen.read_text().strip() == "yes"
    ran = setup_log.read_text().split("\n")
    project_wt = fake_claude.cwd_log.read_text().split("\n")[0]
    # Once, in the project's worktree alone: the specs worktree gets none.
    assert ran[0] == project_wt
    assert ran[1] == "linked"
    assert ran.count(project_wt) == 1 and len([line for line in ran if line.startswith("/")]) == 1
    assert "installing-deps" in err
    assert "worktree setup: done in " in err


def test_a_failing_setup_stops_the_step_before_the_session_with_the_command_and_its_output_ac_5(
    runner, workspace, fake_claude,
):
    manifest(workspace, "echo broken-lockfile; exit 3")
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "echo broken-lockfile; exit 3" in out["error"]
    assert "broken-lockfile\n" in out["error"] or out["error"].endswith("broken-lockfile")
    assert out["error"].startswith("the worktree setup failed: ")
    assert out["errorSolution"]
    assert not fake_claude.calls.exists()


def test_without_the_key_the_worktree_is_prepared_as_before_ac_8(runner, workspace, fake_claude):
    manifest(workspace)
    claude, _ = observing_claude(fake_claude, workspace, workspace["project"].parent / "never")
    rc, out, _, err = run(runner, workspace, claude, return_stderr=True)
    assert rc == 0, out
    assert "worktree setup" not in err
