"""The create -> analyze workflow every tool's e2e test runs.

Each test file hands in one thing: how its CLI runs a skill with an
argument. The rest is the same for every tool — the specs root, the two
steps, where the spec lands and what a real analysis leaves in it — so a
change to the workflow is made here once.

The skills come from what is installed on this machine (./install-all.sh),
the way a person's own run finds them.
"""
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import pytest

# The analysis template's own placeholders: still there means the AI
# never filled the template in.
TEMPLATE_PLACEHOLDERS = [
    "[filled in by analysis]",
    "[How the analysis was performed",
    "[description of change]",
    "[Detailed findings from",
]

REQUIRED_SECTIONS = ["## Mapping", "## Findings"]

FOLDER_NAME = "e2e-greeting"
DESCRIPTION = "Create a simple greeting function with greet(name)"

# (skill, argument, timeout in seconds) -> the finished process
Invoke = Callable[[str, str, int], subprocess.CompletedProcess]


def mise_path() -> str:
    """PATH with mise's shims in front, where the CLIs are usually found."""
    shims = Path.home() / ".local" / "share" / "mise" / "shims"
    current = os.environ.get("PATH", "")
    return current if str(shims) in current else f"{shims}:{current}"


def available(cli: str) -> bool:
    return shutil.which(cli, path=mise_path()) is not None


def _assert_filled(content: str) -> None:
    left = [p for p in TEMPLATE_PLACEHOLDERS if p in content]
    assert not left, f"2-analysis.md still holds template placeholders: {left}"
    for section in REQUIRED_SECTIONS:
        assert section in content, f"2-analysis.md is missing {section}"
        after = content[content.find(section) + len(section):]
        end = after.find("\n## ")
        body = re.sub(r"[\s\-#*`]", "", (after[:end] if end != -1 else after).strip())
        assert len(body) > 20, f"2-analysis.md's {section} is empty"


@pytest.fixture
def e2e_env(e2e_workspace):
    """The workspace with its specs root configured, and the environment
    a CLI runs in there."""
    specs = e2e_workspace / "specs"
    (e2e_workspace / ".aide").mkdir(exist_ok=True)
    (e2e_workspace / ".aide" / "config").write_text(f"AIDE_SPECS_PATH={specs}\n")
    env = {**os.environ, "PATH": mise_path(), "AIDE_INSTALLATION_PATH": str(e2e_workspace)}
    return e2e_workspace, specs, env


def run_workflow(invoke: Invoke, specs: Path) -> None:
    """/aide-create a spec, find its folder, /aide-analyze it, and check
    the analysis and the plan were really written."""
    created = invoke("aide-create", f"TODO-{FOLDER_NAME} {DESCRIPTION}", 180)
    assert created.returncode == 0, f"aide-create failed: {created.stderr}"

    folders = sorted(specs.glob(f"[0-9]*-{FOLDER_NAME}"))
    assert folders, f"aide-create made no <NN>-{FOLDER_NAME} folder in {specs}"
    folder = folders[0]
    for name in ["1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"]:
        assert (folder / name).exists(), f"aide-create left out {name}"
    analysis_before = (folder / "2-analysis.md").read_text()
    solution_before = (folder / "3-solution.md").read_text()

    analyzed = invoke("aide-analyze", folder.name, 300)
    assert analyzed.returncode == 0, f"aide-analyze failed: {analyzed.stderr}"

    analysis = (folder / "2-analysis.md").read_text()
    solution = (folder / "3-solution.md").read_text()
    assert analysis != analysis_before, "aide-analyze did not change 2-analysis.md"
    _assert_filled(analysis)
    assert "greet" in analysis.lower(), "2-analysis.md does not mention the greeting function"
    assert solution != solution_before, "aide-analyze did not change 3-solution.md"
    assert any(w in solution.lower() for w in ["step", "phase", "implementation plan"]), \
        "3-solution.md holds no implementation steps"
