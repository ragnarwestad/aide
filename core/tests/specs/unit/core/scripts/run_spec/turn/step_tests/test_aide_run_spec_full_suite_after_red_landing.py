"""An implement handed the tests the spec's last landing failed runs the
project's whole test command, even when its change touches Markdown files
only: those tests are what the step is to make pass, and the documentation
check alone would never run them (run-spec/turn/step-tests.sh).
"""

import json

from ....conftest import git, run
from ...run_spec_results import RESULT_OK
from ...run_spec_status_files import with_status

BRANCH = "aide/81-queue-and-runner"
EVIDENCE = {"jobId": "archive-job", "failedTests": [{"name": "renders the row", "file": "test/row.test.ts", "error": "TypeError"}]}


def test_a_markdown_only_implement_after_a_red_landing_runs_the_whole_suite_ac_4(
    runner, workspace, fake_claude, monkeypatch
):
    with_status(workspace, ["create", "analyze"])
    project = workspace["project"]
    manifest = project / ".aide" / "project.yaml"
    manifest.write_text(manifest.read_text().replace("AIDE_TEST_CMD: true", "AIDE_TEST_CMD: echo whole-suite"))
    (project / "scripts").mkdir()
    (project / "scripts" / "check-docs").write_text("#!/bin/sh\nexit 0\n")
    (project / "scripts" / "check-docs").chmod(0o755)
    git(project, "add", "scripts/check-docs")
    git(project, "commit", "-q", "-m", "docs check")
    monkeypatch.setenv("AIDE_ARCHIVE_FAILURE_CONTEXT", json.dumps(EVIDENCE))
    claude = fake_claude(
        "cat > /dev/null\n"
        "printf 'reworded\\n' > NOTES.md\n"
        "git add -A && git commit -q -m 'the step'\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    _, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "completed", out
    record = json.loads(git(workspace["specs"], "show", f"{BRANCH}:{workspace['folder']}/test-run.json"))
    assert record["exitCode"] == 0 and record["command"] == "echo whole-suite", record
