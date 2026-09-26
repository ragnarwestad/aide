"""scripts/plan-hit-rate.py: which files a plan names, and how the two sets compare."""
import importlib.util

import pytest


@pytest.fixture
def hit_rate(workspace_root):
    path = workspace_root / "scripts" / "plan-hit-rate.py"
    spec = importlib.util.spec_from_file_location("plan_hit_rate", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_plan_names_repo_paths_with_or_without_a_line(hit_rate):
    text = "Change `core/scripts/aide-run-spec:171-173` and `dashboard/src/a.ts`; not `README`, `foo` or `dashboard/src/`."
    assert hit_rate.named_files(text) == {"core/scripts/aide-run-spec", "dashboard/src/a.ts"}


def test_a_dashboard_path_written_from_inside_it_counts_as_the_repo_s(hit_rate):
    assert hit_rate.named_files("`src/render/x.ts:4` and `test/y.test.ts`") == {
        "dashboard/src/render/x.ts",
        "dashboard/test/y.test.ts",
    }


def test_recall_is_the_changed_files_named_and_precision_the_named_files_changed(hit_rate):
    r = hit_rate.compare({"a.ts", "b.ts", "c.ts", "d.ts"}, {"a.ts", "b.ts", "x.ts"})
    assert (r["recall"], r["precision"], r["missed"]) == (0.5, 2 / 3, ["c.ts", "d.ts"])


def test_nothing_to_divide_by_is_no_share(hit_rate):
    assert hit_rate.compare(set(), set())["recall"] is None
