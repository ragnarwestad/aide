"""scripts/normalize-specs.py: a code block with no language gets `text`."""
import importlib.util

import pytest


@pytest.fixture
def normalize(workspace_root):
    path = workspace_root / "scripts" / "normalize-specs.py"
    spec = importlib.util.spec_from_file_location("normalize_specs", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_bare_fence_gets_the_text_language(normalize):
    assert normalize.fix_code_blocks("intro\n```\ncode\n") == "intro\n```text\ncode\n"


def test_a_fence_with_a_language_is_left_alone(normalize):
    assert normalize.fix_code_blocks("```bash\nls\n") == "```bash\nls\n"
