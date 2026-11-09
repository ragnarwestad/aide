"""A running step keeps its scripts when the installation changes."""

import json

from ...conftest import run
from ..run_spec_invoking import _standalone_runner_copy
from ..run_spec_results import RESULT_OK


def test_survives_late_libraries_being_replaced_mid_run(runner, workspace, fake_claude, tmp_path):
    copy = _standalone_runner_copy(runner, tmp_path)
    publish = tmp_path / "lib/run-spec/publish/publish.sh"
    claude = fake_claude(
        "cat > /dev/null\n"
        f"printf 'exit 71\\n' > {publish}\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, runner_path=copy)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert publish.read_text() == "exit 71\n"


def test_missing_commit_subject_function_is_reported(runner, workspace, fake_claude, tmp_path):
    copy = _standalone_runner_copy(runner, tmp_path)
    reference = tmp_path / "lib/spec-reference.sh"
    reference.write_text(reference.read_text().replace("aide_step_subject()", "unused_subject()"))
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, runner_path=copy)
    assert not out["ok"], out
    assert "aide_step_subject: command not found" in out["error"], out
    assert "aide_step_subject: command not found" in out["errorLog"], out


def test_the_script_snapshot_is_removed_on_exit(runner, workspace, tmp_path, monkeypatch):
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    monkeypatch.setenv("TMPDIR", str(scratch))
    rc, out, _ = run(runner, workspace, dry_run=True)
    assert rc == 0, out
    assert not list(scratch.glob("aide-run-spec.*"))
