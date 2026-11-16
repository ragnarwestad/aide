"""results.md for one run, whether two runs can be compared, and comparison.md for a baseline and one alternative.

A run's identity is run.json; its records are results.json, one per case and attempt. A figure that was not
measured reads "not measured", never 0 or $0.00, and a total says how many of its parts were measured. An invalid
judgment and an attempt with no result are listed with why, and count neither as a pass nor in a score's range.
"""
import statistics
from collections import OrderedDict

from rubric import DIMENSIONS
from table import Stats, count, duration, money, step_cell

DOCUMENTS = ("analysis", "plan")
OUTCOMES = ("pass", "fail", "invalid", "no result")
SETUP = (("Aide commit", "aide_commit"), ("analyze", "analyze"), ("advisor", "advisor"))
COLUMNS = ("Case", "Document", "Run", "Outcome", *(d.capitalize() for d in DIMENSIONS), "Mean", "Missed",
           "Generation time/tokens/cost", "Judge time/tokens/cost", "Why")
COMPARISON_COLUMNS = ("Case", "Document", "Setup", "Pass", *(d.capitalize() for d in DIMENSIONS), "Missed", "Invalid",
                      "No result")


def _stats(value):
    return Stats(value.get("seconds"), value.get("tokens"), value.get("cost")) if value else None


def stats_cell(value):
    return step_cell(_stats(value))


def total_cell(values):
    """Summed time, tokens and cost of the parts that ran, each with how many of them measured it."""
    ran = [v for v in values if v]
    if not ran:
        return "–"
    tokens = [v["tokens"] for v in ran if v.get("tokens") is not None]
    costs = [v["cost"] for v in ran if v.get("cost") is not None]
    n = len(ran)
    return (f"{duration(sum(v.get('seconds') or 0 for v in ran))} · "
            f"{count(sum(tokens)) if tokens else 'not measured'} ({len(tokens)} of {n} measured) · "
            f"{money(sum(costs)) if costs else 'not measured'} ({len(costs)} of {n} measured)")


def step_name(step):
    if not step:
        return "none"
    return " ".join(v for v in (step.get("tool"), step.get("model"), step.get("effort")) if v)


def _line(values):
    return "| " + " | ".join(str(v).replace("|", "/").replace("\n", " ") for v in values) + " |"


def _table(columns, rows):
    return [_line(columns), _line(["---"] * len(columns)), *(_line(r) for r in rows)]


def document_of(record, document):
    """The record's judgment of `document`, with an attempt that has no result read as one."""
    found = (record.get("documents") or {}).get(document)
    if found:
        return found
    return {"outcome": "no result", "why": record.get("problem") or "no result", "mean": None, "dimensions": {},
            "omissions": {}, "judge": None}


def _valid(judged):
    return judged["outcome"] in ("pass", "fail")


def _missed(judged):
    return [oid for oid, o in (judged.get("omissions") or {}).items() if o.get("status") == "missed"]


def _score(judged, dimension):
    return (judged.get("dimensions") or {}).get(dimension, {}).get("score")


def _groups(records):
    """(case, document) -> the judgments of that document, one per attempt, in the order the cases were run."""
    groups = OrderedDict()
    for record in records:
        for document in DOCUMENTS:
            groups.setdefault((record["case"], document), []).append(document_of(record, document))
    return groups


def _summary(judgments):
    valid = [j for j in judgments if _valid(j)]
    outcomes = {o: sum(j["outcome"] == o for j in judgments) for o in OUTCOMES}
    scores = {d: sorted(_score(j, d) for j in valid if _score(j, d) is not None) for d in DIMENSIONS}
    ids = sorted({oid for j in valid for oid in (j.get("omissions") or {})})
    missed = {oid: sum(oid in _missed(j) for j in valid) for oid in ids}
    return {"n": len(judgments), "valid": len(valid), "outcomes": outcomes, "scores": scores, "missed": missed}


def _spread(values):
    if not values:
        return "–"
    return str(values[0]) if values[0] == values[-1] else f"{values[0]}–{values[-1]}"


def _median_spread(values):
    if not values:
        return "–"
    median = statistics.median(values)
    shown = str(int(median)) if median == int(median) else f"{median:.1f}"
    return f"{values[0]}–{shown}–{values[-1]}"


def identity_lines(identity):
    lines = [f"- Aide commit `{identity['aide_commit']}`", f"- analyze {step_name(identity.get('analyze'))}",
             f"- advisor {identity['advisor']}" if identity.get("advisor") else "- no advisor",
             f"- judge {step_name(identity.get('judge'))}", f"- rubric `{identity['rubric']}`",
             f"- repeat {identity['repeat']}", f"- evaluator `{identity.get('evaluator')}`",
             f"- project {identity.get('project')}"]
    for number, case in identity.get("cases", {}).items():
        lines.append(f"- case {number}: file `{case['file_sha256']}` · description `{case['description_sha256']}` · "
                     f"before `{case['before']}` · landed `{case['landed']}`")
    return lines


def _row(record, document, repeat):
    judged = document_of(record, document)
    mean = judged.get("mean")
    return [record["case"], document, f"{record['attempt']}/{repeat}", judged["outcome"],
            *(_score(judged, d) if _score(judged, d) is not None else "–" for d in DIMENSIONS),
            f"{mean:.2f}" if isinstance(mean, (int, float)) else "–", ", ".join(_missed(judged)) or "–",
            stats_cell(record.get("generation")), stats_cell(judged.get("judge")), judged.get("why") or ""]


def _summary_line(case, document, summary):
    counts = summary["outcomes"]
    head = (f"- {case} · {document}: pass {counts['pass']} of {summary['n']} · fail {counts['fail']} · "
            f"invalid {counts['invalid']} · no result {counts['no result']}")
    if not summary["valid"]:
        return head + "; no valid judgment"
    ranges = ", ".join(f"{d} {_spread(summary['scores'][d])}" for d in DIMENSIONS)
    missed = ", ".join(f"{oid} missed {k} of {summary['valid']}" for oid, k in summary["missed"].items())
    return f"{head}; {ranges}" + (f"; {missed}" if missed else "")


def _problems(records, repeat):
    lines = []
    for record in records:
        run = f"run {record['attempt']}/{repeat}"
        if record.get("problem"):
            lines.append(f"- {record['case']} · {run}: no result — {record['problem']}")
            continue
        for document in DOCUMENTS:
            judged = document_of(record, document)
            if not _valid(judged):
                lines.append(f"- {record['case']} · {document} · {run}: {judged['outcome']} — {judged.get('why')}")
    return lines or ["- none"]


def _reasons(records, repeat):
    lines = []
    for record in records:
        for document in DOCUMENTS:
            judged = document_of(record, document)
            if not judged.get("dimensions"):
                continue
            lines += ["", f"### {record['case']} · {document} · run {record['attempt']}/{repeat}", ""]
            for d in DIMENSIONS:
                given = judged["dimensions"].get(d) or {}
                lines.append(f"- {d} ({given.get('score')}): {given.get('reason')} — evidence: {'; '.join(given.get('evidence') or [])}")
            for oid, o in (judged.get("omissions") or {}).items():
                lines.append(f"- {oid} {o.get('status')}: {o.get('evidence')}")
    return lines


def _outcome_line(records):
    judged = [document_of(r, d) for r in records if not r.get("problem") for d in DOCUMENTS]
    counts = ", ".join(f"{o} {sum(j['outcome'] == o for j in judged)}" for o in ("pass", "fail", "invalid"))
    return (f"{counts}; attempts with no result {sum(bool(r.get('problem')) for r in records)}, "
            f"judge turns with no result {sum(j['outcome'] == 'no result' for j in judged)}")


def render_run(identity, records):
    """The whole of results.md."""
    repeat = identity["repeat"]
    out = ["# Analysis and plan evaluation", "", *identity_lines(identity), ""]
    out += _table(COLUMNS, [_row(r, d, repeat) for r in records for d in DOCUMENTS])
    out += ["", "## Per case and document", ""]
    out += [_summary_line(case, document, _summary(js)) for (case, document), js in _groups(records).items()]
    judged = [document_of(r, d) for r in records for d in DOCUMENTS]
    out += ["", "## Totals", "",
            f"- Generation: {total_cell([r.get('generation') for r in records])}",
            f"- Judge: {total_cell([j.get('judge') for j in judged])}",
            f"- Outcomes: {_outcome_line(records)}"]
    out += ["", "## Invalid judgments and attempts with no result", "", *_problems(records, repeat)]
    out += ["", "## The judge's reasons and evidence", *_reasons(records, repeat)]
    return "\n".join(out) + "\n"


def _held(identity):
    """What two compared runs must share, by name."""
    held = [("the project", identity.get("project")), ("the cases", sorted(identity.get("cases", {}))),
            ("the rubric", identity.get("rubric")), ("the judge", identity.get("judge")),
            ("the repeat count", identity.get("repeat"))]
    for number, case in sorted(identity.get("cases", {}).items()):
        held += [(f"case {number}'s case file", case.get("file_sha256")),
                 (f"case {number}'s description", case.get("description_sha256")),
                 (f"case {number}'s pinned commit", (case.get("before"), case.get("landed")))]
    return held


def comparable(base, alt):
    """(why the two runs cannot be compared, None), or (None, the one part of the setup they differ in)."""
    for (name, a), (_, b) in zip(_held(base), _held(alt)):
        if a != b:
            return f"the two runs differ in {name}: {a} against {b}; a comparison holds everything but the setup fixed", None
    if len(_held(base)) != len(_held(alt)):
        return "the two runs differ in the cases", None
    differing = [name for name, key in SETUP if base.get(key) != alt.get(key)]
    if not differing:
        return ("the two runs differ in none of the Aide commit, the analyze step and the advisor: "
                "there is nothing to compare"), None
    if len(differing) > 1:
        return (f"the two runs differ in more than one of the Aide commit, the analyze step and the advisor: "
                f"{' and '.join(differing)}; change one at a time"), None
    return None, differing[0]


def _setup_value(identity, name):
    key = dict(SETUP)[name]
    value = identity.get(key)
    return step_name(value) if key == "analyze" else (value or "none")


def _comparison_row(case, document, setup, summary):
    counts = summary["outcomes"]
    missed = ", ".join(f"{oid} {k} of {summary['valid']}" for oid, k in summary["missed"].items()) or "–"
    return [case, document, setup, f"{counts['pass']} of {summary['n']}",
            *(_median_spread(summary["scores"][d]) for d in DIMENSIONS), missed, counts["invalid"], counts["no result"]]


def render_comparison(base, alt):
    """The whole of comparison.md. `base` and `alt` are {"identity": run.json, "records": results.json}."""
    _, difference = comparable(base["identity"], alt["identity"])
    shared = base["identity"]
    out = ["# Analysis and plan evaluation: baseline against alternative", "",
           f"- {difference}: {_setup_value(shared, difference)} → {_setup_value(alt['identity'], difference)}" if difference
           else "- the two runs are not comparable", "", "Shared by both runs:", "",
           *(line for line in identity_lines(shared) if not line.startswith(("- Aide commit", "- analyze", "- advisor", "- no advisor", "- evaluator"))),
           "", "Each dimension reads min–median–max over the valid judgments.", ""]
    groups = {"baseline": _groups(base["records"]), "alternative": _groups(alt["records"])}
    rows = []
    for key in OrderedDict.fromkeys([*groups["baseline"], *groups["alternative"]]):
        for setup in ("baseline", "alternative"):
            rows.append(_comparison_row(*key, setup, _summary(groups[setup].get(key, []))))
    out += _table(COMPARISON_COLUMNS, rows)
    out += ["", "## Totals", ""]
    for setup, run in (("baseline", base), ("alternative", alt)):
        judged = [document_of(r, d) for r in run["records"] for d in DOCUMENTS]
        out += [f"- {setup}, generation: {total_cell([r.get('generation') for r in run['records']])}",
                f"- {setup}, judge: {total_cell([j.get('judge') for j in judged])}",
                f"- {setup}: {_outcome_line(run['records'])}"]
    return "\n".join(out) + "\n"
