"""The function and repeated-block checks over the repository's own Python
and bash: everything outside dashboard/ that the size limits read, and the
bash scripts under dashboard/, whose TypeScript has its own check
(dashboard/test/design/complexity/). Code over a threshold is held at the
level recorded in held.json, and fails only when it gets worse."""
from functools import lru_cache
from pathlib import Path

from ..repo_files import repo_files
from ..test_code_health import _is_source
from .duplicates import duplicates
from .functions import bash_functions, python_functions
from .held import duplicate_failures, function_failures, load

HELD = Path(__file__).with_name("held.json")
MEASURE = {"python": python_functions, "bash": bash_functions}


def _kind(root, rel):
    """"python", "bash", or None for a file neither check reads."""
    if not _is_source(root, rel):
        return None
    path = Path(root, rel)
    if path.suffix in (".py", ".sh"):
        return "python" if path.suffix == ".py" else "bash"
    if path.suffix:
        return None
    return "python" if b"python" in path.open("rb").readline() else "bash"


def scanned(root):
    """Every file the checks read, by kind: {kind: {path: text}}."""
    files = {"python": {}, "bash": {}}
    for rel in repo_files(root):
        kind = _kind(root, rel)
        if kind and not (rel.startswith("dashboard/") and kind != "bash"):
            files[kind][rel] = Path(root, rel).read_text(encoding="utf-8", errors="replace")
    return files


@lru_cache(maxsize=1)
def measured(root):
    functions, repeats = {}, {}
    for kind, files in scanned(root).items():
        for rel, text in files.items():
            for name, value in MEASURE[kind](text).items():
                functions[f"{rel}::{name}"] = value
        repeats.update(duplicates(files))
    return functions, repeats


def test_the_scan_sees_the_dashboards_bash_and_the_tests_AC_3(workspace_root):
    files = scanned(workspace_root)
    assert "dashboard/serve.sh" in files["bash"]
    assert "core/scripts/aide-run-spec" in files["bash"]
    assert any(rel.startswith("core/tests/") for rel in files["python"])
    assert not any(rel.startswith("dashboard/") for rel in files["python"])


def test_no_function_is_longer_or_deeper_than_its_limit_or_held_level_AC_3(workspace_root):
    functions, _ = measured(str(workspace_root))
    assert function_failures(functions, load(HELD)["functions"]) == []


def test_no_file_repeats_more_blocks_than_its_held_level_AC_3(workspace_root):
    _, repeats = measured(str(workspace_root))
    assert duplicate_failures(repeats, load(HELD)["duplicates"]) == []
