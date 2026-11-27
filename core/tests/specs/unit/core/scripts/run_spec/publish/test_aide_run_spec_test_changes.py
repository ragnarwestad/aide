"""A step's result counts the tests its own commits added and removed, per
directory of test files, so the board can show them before the spec merges."""

import json
from ...conftest import git, run
from ..run_spec_result_fields import assert_written_as_in_fixture
from ..run_spec_results import RESULT_OK
from ..run_spec_status_files import status_with_phase


def _commit_in_project(workspace, files):
    for path, text in files.items():
        target = workspace["project"] / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    git(workspace["project"], "add", "-A")
    git(workspace["project"], "commit", "-qm", "existing tests")


def _writing_claude(fake_claude, script):
    return fake_claude("cat > /dev/null\n" + script + f"echo '{json.dumps(RESULT_OK)}'")


def test_tests_added_and_removed_are_counted_per_directory(runner, workspace, fake_claude):
    _commit_in_project(workspace, {
        "web/test/old.test.ts": 'test("one", () => {});\ntest("two", () => {});\n',
        "py/tests/test_old.py": "def test_kept():\n    pass\n",
    })
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    claude = _writing_claude(fake_claude, (
        "mkdir -p web/test/e2e py/tests\n"
        "printf 'test(\"kept\", () => {});\\n' > web/test/old.test.ts\n"
        "printf 'describe(\"x\", () => {\\n  it(\"a\", () => {});\\n  test.each([1, 2])(\"b %%d\", () => {});\\n});\\n'"
        " > web/test/e2e/new.test.ts\n"
        "printf 'def test_kept():\\n    pass\\n\\n\\nasync def test_new():\\n    pass\\n' > py/tests/test_old.py\n"
        "printf 'const helper = () => test;\\n' > web/test/helper.ts\n"
    ))
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert_written_as_in_fixture("testChanges", out["testChanges"])
    by_dir = {c["dir"]: (c["added"], c["removed"]) for c in out["testChanges"]}
    assert by_dir == {"web/test": (1, 2), "web/test/e2e": (2, 0), "py/tests": (1, 0)}, out["testChanges"]


def test_a_step_that_touches_no_test_file_writes_no_test_changes(runner, workspace, fake_claude):
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    claude = _writing_claude(fake_claude, 'echo "code" > "$PWD/new-code.txt"\n')
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert "testChanges" not in out, out
