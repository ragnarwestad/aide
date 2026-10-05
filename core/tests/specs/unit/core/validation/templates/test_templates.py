"""The spec templates `aide-create-spec` fills: the placeholders it
replaces, and no record a fresh spec has not earned — the runner writes
`Workflow steps completed` and each phase's outcome once it has run."""
import re

import pytest

PLACEHOLDER = re.compile(r"\{\{[A-Z_]+\}\}")


@pytest.fixture
def templates_dir(workspace_root):
    path = workspace_root / "core" / "templates" / "todo"
    assert path.is_dir(), "core/templates/todo is gone"
    return path


@pytest.mark.validation
def test_every_template_but_the_readme_carries_placeholders(templates_dir):
    templates = [p for p in templates_dir.glob("*.template") if not p.name.startswith("0-README")]
    assert templates
    for path in templates:
        assert PLACEHOLDER.search(path.read_text()), f"{path.name} has no placeholder"


@pytest.mark.validation
def test_the_description_template_has_the_placeholders_the_script_fills(templates_dir):
    content = (templates_dir / "1-description.md.template").read_text()
    for placeholder in ("{{TITLE_FORMATTED}}", "{{DESCRIPTION}}", "{{FOLDER_NAME}}"):
        assert placeholder in content, placeholder


@pytest.mark.validation
def test_the_status_template_claims_no_steps(templates_dir):
    content = (templates_dir / "4-status.md.template").read_text()
    assert "**Workflow steps completed:**" not in content


@pytest.mark.validation
def test_no_template_claims_a_phase_outcome(templates_dir):
    for name in ("1-description.md.template", "2-analysis.md.template",
                 "3-solution.md.template", "4-status.md.template"):
        content = (templates_dir / name).read_text()
        for field in ("Repo", "Model", "Result", "Time spent", "Cost"):
            assert f"**{field}:**" not in content, f"{name} claims {field!r}"
