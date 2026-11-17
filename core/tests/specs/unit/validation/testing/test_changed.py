import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[6]
spec = importlib.util.spec_from_file_location("changed", ROOT / "scripts/testing/changed.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_dashboard_change_does_not_run_python_but_keeps_contract_checks():
    commands = module.commands_for(["dashboard/src/queue/test-workers.ts"])
    assert "scripts/test-python" not in commands
    assert "cd dashboard && make test && make test-e2e" in commands
    assert module.CONTRACT_CHECK in commands


def test_core_change_and_unknown_paths_keep_full_suite():
    assert module.commands_for(["core/scripts/aide-run-spec"]) is None
    assert module.commands_for(["pytest.ini"]) is None
    assert module.commands_for([]) is None


def test_docs_only_get_documentation_check():
    assert module.commands_for(["docs/CONFIGURATION.md"]) == ["scripts/check-docs"]
