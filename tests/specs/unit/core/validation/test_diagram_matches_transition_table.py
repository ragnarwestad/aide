"""Spec 356 (REQ-7): the mermaid diagram in dashboard/docs/spec-lifecycle.md
and core/scripts/lib/transitions.json describe the same moves. A test
fails if either names an edge the other does not have, so the diagram
can no longer drift from the table the way the description says it
always could ("nothing checks that it still matches").

The `[*] --> created` entry edge is excluded: it precedes any table row
(there is no phase before `created`), and every reformatted-but-
equivalent diagram fixture below proves the parser tolerates cosmetic
variation (spacing, comments) rather than being brittle about mermaid's
own syntax.
"""
import json
import re
from pathlib import Path

import pytest

DIAGRAM_EDGE_RE = re.compile(r"^\s*(\w+)\s*-->\s*(\w+)\s*:\s*(.+?)\s*$")

# The diagram's own prose names the event a transition is triggered by
# in free text ("archive completes and lands"), not the table's event
# name — this maps the diagram's wording to the table's event vocabulary
# for the specific six edges the diagram draws today.
DIAGRAM_LABEL_TO_EVENT = {
    "create lands, job renamed to the folder": None,  # the entry edge, excluded
    "analyze completes and lands": "analyze",
    "implement completes; code stays on its branch": "implement",
    "archive moves the folder and lands every repo": "archive",
    "reopen (a new work round)": "reopen",
    "reset (same round discarded)": "reset",
    "reset": "reset",
}


def _diagram_edges(text):
    """(fromPhase, toPhase, event) triples, the entry edge excluded."""
    edges = []
    in_block = False
    for line in text.splitlines():
        if "stateDiagram-v2" in line:
            in_block = True
            continue
        if not in_block:
            continue
        if line.strip() == "```":
            break
        m = DIAGRAM_EDGE_RE.match(line)
        if not m:
            continue
        src, dst, label = m.groups()
        if src == "[*]":
            continue
        event = DIAGRAM_LABEL_TO_EVENT.get(label)
        assert event is not None, f"unrecognized diagram edge label: {label!r}"
        edges.append((src, dst, event))
    return set(edges)


def _table_edges(rows):
    # A same-phase legal rerun (analyzed --analyze--> analyzed) is not a
    # move BETWEEN phases — the diagram draws phase transitions, and a
    # row whose `next` equals its own `phase` has nothing to draw.
    return {
        (row["phase"], row["next"], row["event"])
        for row in rows
        if row["refusal"] is None and row["next"] != row["phase"]
    }


@pytest.fixture
def table_rows(workspace_root):
    path = workspace_root / "core/scripts/lib/transitions.json"
    return json.loads(path.read_text())["rows"]


@pytest.fixture
def diagram_text(workspace_root):
    return (workspace_root / "dashboard/docs/spec-lifecycle.md").read_text()


def test_every_legal_table_row_is_drawn_in_the_diagram(table_rows, diagram_text):
    diagram = _diagram_edges(diagram_text)
    table = _table_edges(table_rows)
    missing = table - diagram
    assert not missing, f"transitions.json has legal move(s) the diagram does not draw: {missing}"


def test_every_diagram_edge_is_a_legal_table_row(table_rows, diagram_text):
    diagram = _diagram_edges(diagram_text)
    table = _table_edges(table_rows)
    extra = diagram - table
    assert not extra, f"the diagram draws move(s) transitions.json does not have: {extra}"


def test_the_parser_tolerates_a_reformatted_but_equivalent_diagram():
    reformatted = """
```mermaid
stateDiagram-v2
    [*]     -->     created: create lands, job renamed to the folder
    created --> analyzed: analyze completes and lands

    analyzed --> implemented: implement completes; code stays on its branch
    implemented --> archived: archive moves the folder and lands every repo
    archived --> created: reopen (a new work round)
    analyzed --> created: reset (same round discarded)
    implemented --> created: reset
```
"""
    edges = _diagram_edges(reformatted)
    assert ("created", "analyzed", "analyze") in edges
    assert ("implemented", "archived", "archive") in edges
    assert len(edges) == 6
