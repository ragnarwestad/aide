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
