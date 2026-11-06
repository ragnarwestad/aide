"""A provider's own program and Claude Code's auto-compact threshold, as the
board hands them to the runner: --bin, --autocompact, --review-bin and
--verify-bin (run-spec/setup/arguments.sh, run-spec/setup/invocation.sh,
run-spec/turn/side-turn.sh).
"""

import json

from ...conftest import run
from ..run_spec_results import CODEX_STREAM_OK, RESULT_OK, emits


def _decoy(tmp_path, name):
    """A program that must never run: it leaves a file behind if it does."""
    path = tmp_path / name
    path.write_text(f"#!/bin/sh\ntouch {tmp_path / (name + '-ran')}\nexit 9\n")
    path.chmod(0o755)
    return path


def test_bin_runs_the_step_on_that_program_and_not_the_one_in_the_environment(runner, workspace, fake_claude, tmp_path):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    decoy = _decoy(tmp_path, "decoy-claude")
    run(runner, workspace, decoy, bin=claude)
    assert fake_claude.calls.read_text().strip(), "the program --bin named did not run"
    assert not (tmp_path / "decoy-claude-ran").exists()


def test_bin_runs_a_codex_step_on_that_program(runner, workspace, fake_codex, tmp_path):
    codex = fake_codex("cat > /dev/null; " + emits(CODEX_STREAM_OK))
    decoy = _decoy(tmp_path, "decoy-codex")
    run(runner, workspace, codex=decoy, tool="codex", bin=codex)
    assert fake_codex.calls.read_text().strip(), "the program --bin named did not run"
    assert not (tmp_path / "decoy-codex-ran").exists()


def test_a_bin_that_is_not_a_program_is_refused_naming_it(runner, workspace, fake_claude, tmp_path):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    missing = tmp_path / "no-such-claude"
    rc, out, _ = run(runner, workspace, claude, bin=missing)
    assert rc != 0 and str(missing) in out["error"], out
    assert not fake_claude.calls.exists()


def test_autocompact_is_handed_to_claude(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    run(runner, workspace, claude, autocompact="300000")
    (call,) = fake_claude.calls.read_text().splitlines()
    assert "--autocompact 300000" in call, call


def test_autocompact_outside_the_range_or_on_codex_is_refused(runner, workspace, fake_claude, fake_codex):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    for tokens in ["99999", "1000001", "lots"]:
        rc, out, _ = run(runner, workspace, claude, autocompact=tokens)
        assert rc != 0 and "100000" in out["error"], out
    codex = fake_codex("cat > /dev/null; " + emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, codex=codex, tool="codex", autocompact="300000")
    assert rc != 0 and "--autocompact" in out["error"], out
    assert not fake_claude.calls.exists() and not fake_codex.calls.exists()
