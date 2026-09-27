"""A workflow skill's steps read "Step N of X", and the model repeats
those headings in the run's log to say how far it has come. Inserting
or removing a step must renumber every heading, or the log counts
wrong: X is the number of steps, and N runs 1..X in order."""

import re
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[5] / "core" / "skills"
STEP = re.compile(r"^#+ Step (\d+) of (\d+):", re.M)


def _numbered_skills():
    return sorted(p for p in SKILLS.glob("aide-*/SKILL.md") if STEP.search(p.read_text()))


def test_the_workflow_skills_number_their_steps():
    names = {p.parent.name for p in _numbered_skills()}
    assert {"aide-analyze", "aide-archive", "aide-create"} <= names


@pytest.mark.parametrize("skill", _numbered_skills(), ids=lambda p: p.parent.name)
def test_every_step_counts_the_same_total_in_order(skill):
    steps = [(int(n), int(x)) for n, x in STEP.findall(skill.read_text())]
    total = len(steps)
    assert steps == [(i, total) for i in range(1, total + 1)]


@pytest.mark.parametrize("skill", _numbered_skills(), ids=lambda p: p.parent.name)
def test_every_step_opens_with_its_own_log_lines(skill):
    """The line under a heading is what the model writes to the log; a
    renumbered heading with its old line under it logs the wrong step."""
    for m in re.finditer(r"^#+ Step (\d+ of \d+):.*\n\n(.*)$", skill.read_text(), re.M):
        if m.group(2).startswith("Aide writes"):  # the merge after the session, marked by the landing
            assert m.group(2).startswith(f"Aide writes `--- Step {m.group(1)}: Merge into main"), m.group(0)
            continue
        assert m.group(2).startswith(f"First write `--- Step {m.group(1)}:"), m.group(0)
        assert f"`--- Step {m.group(1)}:" in m.group(2).split("and when this step ends")[1], m.group(0)
