import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[6]
spec = importlib.util.spec_from_file_location("changed", ROOT / "scripts/testing/changed.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_dashboard_change_does_not_run_python_but_keeps_contract_checks():
    assert module.suites_for(["dashboard/src/queue/test-workers.ts"]) == ["contracts", "dashboard", "e2e"]


def test_the_landing_names_the_suites_to_run_again():
    env = {"AIDE_TEST_ONLY_SUITES": "dashboard"}
    assert module.selected_suites(["core/scripts/aide-run-spec"], env) == ["dashboard"]
    assert module.selected_suites(["core/scripts/aide-run-spec"], {}) == ["python", "runner", "dashboard", "e2e"]


def test_after_a_repair_its_own_changes_choose_what_runs_beside_the_red_suites(monkeypatch):
    env = {"AIDE_TEST_ONLY_SUITES": "dashboard", "AIDE_TEST_ALSO_CHANGED_SINCE": "abc"}
    for changed, expected in [
        (["dashboard/test/serve/x.test.ts"], ["dashboard"]),
        (["dashboard/test/e2e/x.test.ts"], ["dashboard", "e2e"]),
        (["dashboard/src/serve/x.ts"], ["contracts", "dashboard", "e2e"]),
        (["core/scripts/aide-run-spec"], ["python", "runner", "dashboard", "e2e"]),
        (None, ["python", "runner", "dashboard", "e2e"]),
    ]:
        monkeypatch.setattr(module, "_changed_since", lambda base, changed=changed: changed)
        assert module.selected_suites([], env) == expected


def test_pytest_is_two_suites_that_together_run_every_test_once():
    assert module.SUITES["runner"] == f"scripts/test-python {module.RUNNER_TESTS}"
    assert module.SUITES["python"] == f"scripts/test-python --ignore={module.RUNNER_TESTS}"
    assert (ROOT / module.RUNNER_TESTS).is_dir()


def test_core_change_and_unknown_paths_keep_full_suite():
    assert module.commands_for(["core/scripts/aide-run-spec"]) is None
    assert module.commands_for(["pytest.ini"]) is None
    assert module.commands_for([]) is None


def test_docs_only_get_documentation_check():
    assert module.commands_for(["docs/CONFIGURATION.md"]) == ["scripts/check-docs"]


def test_a_test_is_a_contract_test_when_its_code_names_the_dashboard_folder(tmp_path):
    tests = tmp_path / "core/tests"
    tests.mkdir(parents=True)
    (tests / "test_joined.py").write_text('def test_x(root):\n    (root / "dashboard" / "src" / "a.ts").read_text()\n')
    (tests / "test_path.py").write_text('SOURCE = "dashboard/src/parser.ts"\n')
    (tests / "test_made_up_names.py").write_text('CHANGES = ["src/a.ts", "x.ts:10"]\n')
    (tests / "test_result_field.py").write_text('def test_x(out):\n    assert out["branchUrls"]\n')
    (tests / "test_board_home.py").write_text('HOME = "~/.aide/dashboard/worktrees"\n')
    assert module.contract_tests(tmp_path) == ["core/tests/test_joined.py", "core/tests/test_path.py"]


def test_the_runner_test_that_names_the_dashboard_folder_is_a_contract_test():
    selected = module.contract_tests(ROOT)
    assert "core/tests/specs/unit/core/scripts/run_spec/turn/test_aide_run_spec_screenshots.py" in selected
    assert "core/tests/specs/unit/core/scripts/run_spec/checkout/test_aide_run_spec_time_limit_and_cancel.py" not in selected


def test_comments_and_docstrings_neither_add_nor_remove_a_contract_test_ac_2(tmp_path):
    tests = tmp_path / "core/tests"
    tests.mkdir(parents=True)
    (tests / "test_comment_only.py").write_text(
        '"""Checks what the dashboard reads from parser.ts."""\n'
        "# the dashboard's parser.ts reads this too\n"
        "def test_x():\n"
        '    """dashboard/src/parser.ts"""\n'
        "    assert 1\n")
    (tests / "test_code_commented.py").write_text(
        '"""Nothing about the board here."""\n'
        "# nothing here either\n"
        'SOURCE = "dashboard/src/parser.ts"\n')
    assert module.contract_tests(tmp_path) == ["core/tests/test_code_commented.py"]


def test_the_links_a_merge_puts_in_its_tree_are_no_change(tmp_path, monkeypatch):
    # A merge's tree carries the manifest's worktreeLinks as symlinks, and an
    # ignore pattern ending in `/` matches a directory, never a link. Seen as
    # a new file, `.venv` lies outside dashboard/ and a dashboard-only change
    # would run the whole of pytest.
    import re
    import shutil
    import subprocess

    manifest = (ROOT / ".aide/project.yaml").read_text()
    links = re.search(r"^worktreeLinks:\s*(.+)$", manifest, re.M).group(1).split()
    assert links
    git = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
    subprocess.run(git + ["init", "-q"], cwd=tmp_path, check=True)
    for ignore in [".gitignore", "dashboard/.gitignore"]:
        (tmp_path / ignore).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / ignore, tmp_path / ignore)
    subprocess.run(git + ["add", "-A"], cwd=tmp_path, check=True)
    subprocess.run(git + ["commit", "-q", "-m", "base"], cwd=tmp_path, check=True)
    (tmp_path / "target").mkdir()
    for link in links:
        (tmp_path / link).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / link).symlink_to(tmp_path / "target")
    monkeypatch.chdir(tmp_path)
    assert module._changed_since("HEAD") == []
