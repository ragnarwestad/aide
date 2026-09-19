"""A completed implement records which test covers which requirement,
read off the names of the tests the branch ADDED (run-spec-ac-coverage.sh):
the dashboard shows them on the row the user ticks.
"""

import json
from ..conftest import git, run
from .run_spec_results import RESULT_OK
from .run_spec_status_files import with_status

BRANCH = "aide/81-queue-and-runner"
DESCRIPTION = (
    "# Queue - Description\n\n## Acceptance criteria\n\n"
    "- **AC-1:** The total SHALL show.\n"
    "- **AC-2:** It SHALL keep counting.\n"
    "- **AC-3:** It SHALL fit a phone.\n"
)


def _spec_with_criteria(workspace):
    specs = workspace["specs"]
    (specs / workspace["folder"] / "1-description.md").write_text(DESCRIPTION)
    git(specs, "add", "-A")
    git(specs, "commit", "-q", "-m", "criteria")


def _project_with_another_specs_test(workspace):
    """main already holds a test naming AC-2 — another spec's."""
    project = workspace["project"]
    (project / "test").mkdir(exist_ok=True)
    (project / "test" / "old.test.ts").write_text('test("an older spec\'s check (AC-2)", () => {});\n')
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "older spec")


def _claude_writing_named_tests(fake_claude):
    return fake_claude(
        "cat > /dev/null\n"
        "mkdir -p test tests src\n"
        "printf 'test(\"the total keeps its place (AC-1)\", () => {});\\n' >> test/old.test.ts\n"
        "printf 'test(\"the total shows on a phone (AC-1)\", () => {});\\n' > test/new.test.ts\n"
        "printf 'def test_it_fits_a_phone_ac_3():\\n    pass\\n' > tests/test_fit.py\n"
        "printf '// AC-2 is handled here\\n' > src/total.ts\n"
        "printf '// The counter on the Totals tab (AC-2), run against fakes\\n' >> test/new.test.ts\n"
        "printf '    # keeps counting after a restart (AC-2)\\n' >> tests/test_fit.py\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )


def test_a_completed_implement_records_the_tests_that_name_each_requirement(
    runner, workspace, fake_claude
):
    with_status(workspace, ["create", "analyze"])
    _spec_with_criteria(workspace)
    _project_with_another_specs_test(workspace)
    rc, out, _ = run(runner, workspace, _claude_writing_named_tests(fake_claude), command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    record = json.loads(git(workspace["specs"], "show", f"{BRANCH}:{workspace['folder']}/ac-coverage.json"))
    acs = record["acs"]
    assert sorted(t["name"] for t in acs["AC-1"]) == [
        "the total keeps its place (AC-1)",
        "the total shows on a phone (AC-1)",
    ]
    # Only lines the branch added: main's own AC-2 test is another
    # spec's, and a comment is not a test — in a test file either: 501's
    # row read "Tests: // The control on the Notifications tab (AC-1, AC-6)".
    assert acs["AC-2"] == []
    assert [t["file"] for t in acs["AC-3"]] == ["tests/test_fit.py"]


def test_a_spec_without_criteria_gets_no_record(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    rc, out, _ = run(runner, workspace, _claude_writing_named_tests(fake_claude), command="implement")
    assert out["terminalReason"] == "completed", out
    shown = git(workspace["specs"], "ls-tree", "--name-only", BRANCH, f"{workspace['folder']}/")
    assert "ac-coverage.json" not in shown


def test_the_record_is_written_when_the_step_committed_its_own_tests(runner, workspace, fake_claude):
    """498 (2026-09-19): the session committed its tests itself, so the
    only files git did not know were the worktree's links — a link to a
    directory, not a file. The reading ended on that, and under the
    runner's pipefail the record was thrown away instead of written."""
    with_status(workspace, ["create", "analyze"])
    _spec_with_criteria(workspace)
    claude = fake_claude(
        "cat > /dev/null\n"
        "mkdir -p test\n"
        "printf 'test(\"the total shows on a phone (AC-1)\", () => {});\\n' > test/new.test.ts\n"
        "git add test && git commit -q -m 'the step'\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "completed", out
    record = json.loads(git(workspace["specs"], "show", f"{BRANCH}:{workspace['folder']}/ac-coverage.json"))
    assert [t["name"] for t in record["acs"]["AC-1"]] == ["the total shows on a phone (AC-1)"]
