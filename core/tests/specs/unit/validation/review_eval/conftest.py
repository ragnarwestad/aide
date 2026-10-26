"""scripts/review_eval imports its modules by plain name, as it does when run."""
import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT_DIR = Path(__file__).resolve().parents[6] / "scripts" / "review_eval"
sys.path.insert(0, str(SCRIPT_DIR))


@pytest.fixture
def review_eval():
    spec = importlib.util.spec_from_file_location("review_eval_main", SCRIPT_DIR / "__main__.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
