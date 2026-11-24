"""The difference between two planted runs: per case and in total, planted defects found and kept, false findings
raised and kept.

A case in one run only, one whose entry or patch changed between the runs, and one with a figure not measured in
either run is listed apart and left out of the totals. Runs with different setups are compared all the same: telling
a prompt or a model apart is what the comparison is for.
"""
import json
from pathlib import Path

from planted import FIGURES


def load(folder):
    return json.loads(Path(folder, "results.json").read_text())


def _value(case, figure):
    value = case.get(figure)
    return int(value) if isinstance(value, (bool, int)) and not isinstance(value, str) else None


def compare(a, b):
    """{"cases": {id: {figure: (a, b, change)}}, "apart": {id: why}, "totals": {figure: (a, b, change)}}."""
    in_a = {c["id"]: c for c in a["cases"]}
    in_b = {c["id"]: c for c in b["cases"]}
    cases, apart = {}, {}
    for case_id in sorted(in_a.keys() | in_b.keys()):
        ca, cb = in_a.get(case_id), in_b.get(case_id)
        if ca is None or cb is None:
            apart[case_id] = "only in A" if cb is None else "only in B"
            continue
        if ca.get("sha256") != cb.get("sha256") or ca.get("kind") != cb.get("kind"):
            apart[case_id] = "changed, not compared"
            continue
        figures = FIGURES.get(ca.get("kind"), ())
        missing = [f"{figure} in {side}" for side, case in (("A", ca), ("B", cb)) for figure in figures
                   if _value(case, figure) is None]
        if missing:
            apart[case_id] = "not measured: " + ", ".join(missing)
            continue
        cases[case_id] = {f: (_value(ca, f), _value(cb, f), _value(cb, f) - _value(ca, f)) for f in figures}
    totals = {}
    for figures in FIGURES.values():
        for figure in figures:
            sa = sum(c[figure][0] for c in cases.values() if figure in c)
            sb = sum(c[figure][1] for c in cases.values() if figure in c)
            totals[figure] = (sa, sb, sb - sa)
    return {"cases": cases, "apart": apart, "totals": totals}


def _setup(run):
    return ", ".join(f"{k} {v}" for k, v in sorted(run.get("setup", {}).items()) if not isinstance(v, (dict, list)))


def render(diff, a, b):
    change = lambda t: f"{t[0]} → {t[1]} ({t[2]:+d})"
    lines = ["# Comparison of two planted runs", "", f"- A: {_setup(a)}", f"- B: {_setup(b)}", "", "## Totals", ""]
    lines += [f"- {figure}: {change(t)}" for figure, t in diff["totals"].items()]
    lines += ["", "## Per case", ""]
    lines += [f"- {case_id}: " + ", ".join(f"{f} {change(t)}" for f, t in figs.items())
              for case_id, figs in diff["cases"].items()]
    if diff["apart"]:
        lines += ["", "## Left out of the totals", ""]
        lines += [f"- {case_id}: {why}" for case_id, why in diff["apart"].items()]
    return "\n".join(lines) + "\n"


def main(folder_a, folder_b):
    """Compare run A with run B, write comparison.md into B's folder, and return its text."""
    a, b = load(folder_a), load(folder_b)
    text = render(compare(a, b), a, b)
    Path(folder_b, "comparison.md").write_text(text)
    return text
