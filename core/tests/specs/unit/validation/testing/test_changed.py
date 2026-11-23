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
    assert module.selected_suites(["core/scripts/aide-run-spec"], {}) == ["python", "dashboard", "e2e"]


def test_after_a_repair_its_own_changes_choose_what_runs_beside_the_red_suites(monkeypatch):
    env = {"AIDE_TEST_ONLY_SUITES": "dashboard", "AIDE_TEST_ALSO_CHANGED_SINCE": "abc"}
    for changed, expected in [
        (["dashboard/test/serve/x.test.ts"], ["dashboard"]),
        (["dashboard/test/e2e/x.test.ts"], ["dashboard", "e2e"]),
        (["dashboard/src/serve/x.ts"], ["contracts", "dashboard", "e2e"]),
        (["core/scripts/aide-run-spec"], ["python", "dashboard", "e2e"]),
        (None, ["python", "dashboard", "e2e"]),
    ]:
        monkeypatch.setattr(module, "_changed_since", lambda base, changed=changed: changed)
        assert module.selected_suites([], env) == expected


def test_core_change_and_unknown_paths_keep_full_suite():
    assert module.commands_for(["core/scripts/aide-run-spec"]) is None
    assert module.commands_for(["pytest.ini"]) is None
    assert module.commands_for([]) is None


def test_docs_only_get_documentation_check():
    assert module.commands_for(["docs/CONFIGURATION.md"]) == ["scripts/check-docs"]


def test_contract_tests_include_the_result_field_tests_without_the_words_ac_1():
    selected = module.contract_tests(ROOT)
    run_spec = "core/tests/specs/unit/core/scripts/run_spec"
    assert f"{run_spec}/checkout/test_aide_run_spec_time_limit_and_cancel.py" in selected
    assert f"{run_spec}/turn/step_tests/test_aide_run_spec_tests_not_run.py" in selected


def test_every_test_using_the_result_field_helper_is_a_contract_test_ac_3():
    selected = set(module.contract_tests(ROOT))
    users = {str(p.relative_to(ROOT)) for p in (ROOT / "core/tests").rglob("test_*.py")
             if "run_spec_result_fields" in p.read_text()}
    assert users
    missing = sorted(users - selected)
    assert not missing, f"tests using run_spec_result_fields missing from the contract tests: {missing}"


def test_comments_and_docstrings_neither_add_nor_remove_a_contract_test_ac_2(tmp_path):
    tests = tmp_path / "core/tests"
    tests.mkdir(parents=True)
    (tests / "test_comment_only.py").write_text(
        '"""Checks what the dashboard reads from parser.ts."""\n'
        "# the dashboard's parser.ts reads this too\n"
        "def test_x():\n"
        '    """dashboard parser.ts"""\n'
        "    assert 1\n")
    (tests / "test_helper.py").write_text(
        '"""Nothing about the board here."""\n'
        "from ..run_spec_result_fields import assert_written_as_in_fixture\n")
    (tests / "test_helper_commented.py").write_text(
        '"""The dashboard reads parser.ts."""\n'
        "# dashboard\n"
        "from ..run_spec_result_fields import assert_written_as_in_fixture\n")
    (tests / "test_code.py").write_text('SOURCE = "dashboard/src/parser.ts"\n')
    assert module.contract_tests(tmp_path) == [
        "core/tests/test_code.py",
        "core/tests/test_helper.py",
        "core/tests/test_helper_commented.py",
    ]


def test_a_test_reading_a_result_field_the_dashboard_declares_is_a_contract_test(tmp_path):
    types = tmp_path / module.STEP_OUTCOME
    types.parent.mkdir(parents=True)
    types.write_text("export interface StepOutcome {\n  ok: boolean;\n  branchUrls?: BranchRef[];\n}\n")
    tests = tmp_path / "core/tests"
    tests.mkdir(parents=True)
    (tests / "test_reads_field.py").write_text('def test_x(out):\n    assert out["branchUrls"]\n')
    (tests / "test_reads_with_get.py").write_text('def test_x(out):\n    assert out.get("branchUrls")\n')
    (tests / "test_reads_only_ok.py").write_text('def test_x(out):\n    assert out["ok"]\n')
    assert module.contract_tests(tmp_path) == [
        "core/tests/test_reads_field.py",
        "core/tests/test_reads_with_get.py",
    ]
    selected = module.contract_tests(ROOT)
    assert "core/tests/specs/unit/core/scripts/run_spec/publish/test_aide_run_spec_pushing.py" in selected
