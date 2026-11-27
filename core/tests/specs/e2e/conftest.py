"""What the e2e tests share: where the CLIs are found, and the analyze
step every runnable tool's test runs through the real runner.

The board runs a spec's steps through core/scripts/aide-run-spec, which
tells the tool to read the step's instructions from
core/scripts/lib/steps/<step>/SKILL.md; no AI CLI offers the steps as
skills of its own. So a tool's e2e test creates a spec with
aide-create-spec (no AI), runs `analyze` on it through the runner with
the real CLI on a cheap model, and checks what a real analysis leaves
behind. The project and specs repos, and the call to the runner, are
the ones the runner's unit tests use (core/tests/specs/unit/core/scripts/
conftest.py), with the real CLI where those put a stand-in.
"""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from ..unit.core.scripts.conftest import run, runner, workspace  # noqa: F401
from ..unit.core.scripts.spec.spec_repos import git

# The templates' own placeholders (core/scripts/lib/create-spec/
# placeholder-files.sh): still there means the AI never filled them in.
TEMPLATE_PLACEHOLDERS = ["(Filled in by /aide-analyze", "[not analyzed yet]"]

TITLE = "E2E greeting"
DESCRIPTION = "Create a simple greeting function with greet(name)"

# The time the board gives an analyze is far longer; a cheap model on an
# empty project needs minutes, not an hour.
ANALYZE_TIMEOUT_SEC = 900


def mise_path() -> str:
    """PATH with mise's shims in front, where the CLIs are usually found."""
    shims = Path.home() / ".local" / "share" / "mise" / "shims"
    current = os.environ.get("PATH", "")
    return current if str(shims) in current else f"{shims}:{current}"


def available(cli: str) -> bool:
    return shutil.which(cli, path=mise_path()) is not None


def _section(content: str, heading: str) -> str:
    """The text under <heading>, up to the next heading of its level or above."""
    level = heading.split(" ", 1)[0]
    start = content.find(f"\n{heading}\n")
    assert start != -1, f"missing {heading}"
    after = content[start + len(heading) + 2:]
    ends = [i for i in (after.find(f"\n{'#' * n} ") for n in range(1, len(level) + 1)) if i != -1]
    return after[:min(ends)] if ends else after


def _assert_written(file: str, content: str, heading: str) -> None:
    body = re.sub(r"[\s\-#*`]", "", _section(content, heading))
    assert len(body) > 20, f"{file}'s {heading} is empty"


def assert_analyzed(analysis: str, solution: str) -> None:
    """What the analyze step's instructions (core/scripts/lib/steps/
    aide-analyze) make it write, short analysis or full."""
    for file, content in (("2-analysis.md", analysis), ("3-solution.md", solution)):
        left = [p for p in TEMPLATE_PLACEHOLDERS if p in content]
        assert not left, f"{file} still holds template placeholders: {left}"
    _assert_written("2-analysis.md", analysis, "## Findings")
    files = _section(analysis, "### Files to change")
    assert re.search(r"^- `[^`]+`", files, re.M), "2-analysis.md lists no file under Files to change"
    assert "greet" in analysis.lower(), "2-analysis.md does not mention the greeting function"
    assert re.search(r"^- \*\*Grade:\*\* (LOW|MEDIUM|HIGH)", solution, re.M), "3-solution.md records no grade"
    if re.search(r"^- \*\*Analysis:\*\* short", analysis, re.M):
        _assert_written("3-solution.md", solution, "## Short analysis")
        _assert_written("3-solution.md", solution, "## Testing")
    else:
        _assert_written("2-analysis.md", analysis, "## Mapping")
        _assert_written("3-solution.md", solution, "## Implementation plan")


@pytest.fixture
def e2e_env(e2e_workspace):
    """The workspace with its specs root configured, and the environment
    a CLI runs in there."""
    specs = e2e_workspace / "specs"
    (e2e_workspace / ".aide").mkdir(exist_ok=True)
    (e2e_workspace / ".aide" / "config").write_text(f"AIDE_SPECS_PATH={specs}\n")
    env = {**os.environ, "PATH": mise_path(), "AIDE_INSTALLATION_PATH": str(e2e_workspace)}
    return e2e_workspace, specs, env


@pytest.fixture
def real_cli(monkeypatch):
    """The environment the runner starts the real CLI in: mise's shims on
    PATH, and the real srt for the Codex and OpenCode turns that run
    inside it (the runner helper puts a stand-in there otherwise)."""
    monkeypatch.setenv("PATH", mise_path())
    srt = shutil.which("srt", path=mise_path())
    if srt:
        monkeypatch.setenv("AIDE_SRT_BIN", srt)
    else:
        monkeypatch.delenv("AIDE_SRT_BIN", raising=False)


def create_spec(workspace_root: Path, specs: Path) -> str:
    """Make the spec with aide-create-spec and commit it, as the board's
    create without AI does. Returns the folder's name."""
    created = subprocess.run(
        [str(workspace_root / "core" / "scripts" / "aide-create-spec"),
         "--specs-root", str(specs), "--title", TITLE, "--description", DESCRIPTION],
        capture_output=True, text=True,
    )
    lines = created.stdout.strip().splitlines()
    result = json.loads(lines[-1]) if lines else {}
    assert created.returncode == 0 and result.get("ok"), \
        f"aide-create-spec failed: {created.stdout}{created.stderr}"
    folder = result["specFolder"]
    git(specs, "add", "-A")
    git(specs, "commit", "-qm", f"Create {folder}")
    return folder


def analyze_with(tool: str, model: str, runner_path: Path, ws: dict, workspace_root: Path) -> None:
    """Create a spec, run `analyze` on it through the runner with <tool>
    on <model>, and check the analysis and the plan were really written
    on the spec's branch."""
    specs = ws["specs"]
    folder = create_spec(workspace_root, specs)
    analysis_before = (specs / folder / "2-analysis.md").read_text()
    solution_before = (specs / folder / "3-solution.md").read_text()

    code, result, _stdout, stderr = run(
        runner_path, ws, return_stderr=True,
        spec=folder, tool=tool, model=model, project_name="e2e",
        timeout_sec=ANALYZE_TIMEOUT_SEC, permission_mode="bypassPermissions",
    )
    assert code == 0 and result.get("ok") is True, \
        f"the runner's analyze on {tool} failed: {json.dumps(result)}\n{stderr[-4000:]}"

    branch = result.get("branch") or f"aide/{folder}"
    analysis = git(specs, "show", f"{branch}:{folder}/2-analysis.md")
    solution = git(specs, "show", f"{branch}:{folder}/3-solution.md")
    assert analysis.strip() != analysis_before.strip(), "analyze did not change 2-analysis.md"
    assert solution.strip() != solution_before.strip(), "analyze did not change 3-solution.md"
    assert_analyzed(analysis, solution)
