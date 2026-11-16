"""The rubric a judge scores an analysis or a plan by, the prompt it is sent, how its answer is read, and the
verdict, which is computed here and never left to the model.

Four dimensions, each scored 1 to 5 against anchors at 1, 3 and 5, with a reason and evidence written before the
score. The approved expected assessment is the reference; the original document is supporting material only.
A serious omission the judge finds missed fails the document whatever its scores; otherwise it passes when the mean
reaches PASS_MEAN and no dimension is under MIN_DIMENSION. An answer that cannot be read whole is invalid, never a
pass and never a score.
"""
import hashlib
import json
from typing import NamedTuple, Optional

DIMENSIONS = ("requirements", "code", "tests", "approach")
DOCUMENTS = {"analysis": "2-analysis.md", "plan": "3-solution.md"}
PASS_MEAN = 3.5
MIN_DIMENSION = 3
STATUSES = ("covered", "missed")

NAMES = {
    "requirements": "Requirements coverage",
    "code": "Affected code and interactions",
    "tests": "Test adequacy",
    "approach": "Soundness and simplicity",
}

ANCHORS = {
    "requirements": {
        1: "Several requirements of the description are missing or misread, so the work would build something else.",
        3: "Every requirement is addressed, but at least one is read loosely or left vague where it matters.",
        5: "Every requirement is addressed as the description means it, including its failure cases.",
    },
    "code": {
        1: "The places that must change, or the code they interact with, are mostly not found or are wrong.",
        3: "The main places are found, but an interaction that changes the outcome is missed or misjudged.",
        5: "Every place that must change and every interaction that decides the behaviour is found and read right.",
    },
    "tests": {
        1: "No test would catch the change failing, or the tests named prove only that the code was written.",
        3: "The main behaviour is tested, but a failure case a requirement names has no test.",
        5: "Each requirement, including its failure cases, has a test at the right place that would fail without it.",
    },
    "approach": {
        1: "The approach does not work, or it is far heavier than the change needs.",
        3: "The approach works, with a weakness or extra weight a careful reviewer would remove.",
        5: "The approach is sound and as simple as the change allows.",
    },
}

QUESTIONS = {
    "analysis": {
        "requirements": "Does the analysis read every requirement of the description, and read it right?",
        "code": "Does it find the code that must change and the code it interacts with, with correct findings?",
        "tests": "Does it map the existing tests and the places the new tests belong?",
        "approach": "Are its findings sound and to the point, without reaching past what the description asks?",
    },
    "plan": {
        "requirements": "Does the plan cover every requirement of the description?",
        "code": "Does it change the right code, and does it account for the interactions that decide the behaviour?",
        "tests": "Do its tests prove each requirement, including the failure cases, at the right places?",
        "approach": "Is the approach sound, and no heavier than the change needs?",
    },
}

TEMPLATE = """You judge one document Aide's analyze step wrote for a spec: its {document_name} ({file}). The spec's
description comes first, then the expected assessment a person approved for this spec, then the original
{document_name} written for the same spec when it ran, and last the {document_name} under evaluation.

The approved expected assessment is the reference. The original {document_name} is supporting material and may itself
be wrong: never treat it as the answer. Judge substance: a different wording, name, order or file layout for the same
thing is no gap. Read the code the expected assessment cites as it is described there; you cannot open files.

Score the {document_name} under evaluation on four dimensions, each from 1 to 5. The anchors say what 1, 3 and 5 mean;
2 and 4 lie between them.

{dimensions}

For each serious omission listed below, say whether the {document_name} under evaluation covers it (names the problem
and deals with it) or misses it, with the evidence from the document.

For each dimension, write the reason first, then the evidence (quotes or places in the document under evaluation, and
the ids of the expected items they concern), then the score. Answer with one JSON object and nothing else:

{{"dimensions": {{{answer_dimensions}}}, "omissions": {{{answer_omissions}}}}}

<description>
{description}
</description>

<expected_assessment>
{expected}
</expected_assessment>

<original_{document}>
{original}
</original_{document}>

<new_{document}>
{new}
</new_{document}>
"""

IDENTITY = hashlib.sha256(json.dumps(
    {"anchors": ANCHORS, "questions": QUESTIONS, "pass_mean": PASS_MEAN, "min_dimension": MIN_DIMENSION, "template": TEMPLATE},
    sort_keys=True).encode()).hexdigest()


class Dimension(NamedTuple):
    score: int
    reason: str
    evidence: tuple


class Omission(NamedTuple):
    status: str
    evidence: str


class Judgment(NamedTuple):
    dimensions: dict  # name -> Dimension
    omissions: dict  # id -> Omission


class Verdict(NamedTuple):
    outcome: str  # pass, fail or invalid
    why: str
    mean: Optional[float]
    judgment: Optional[Judgment]


def _dimensions_text(document):
    blocks = []
    for name in DIMENSIONS:
        anchors = "\n".join(f"  {score}: {ANCHORS[name][score]}" for score in (1, 3, 5))
        blocks.append(f"- {name} ({NAMES[name]}): {QUESTIONS[document][name]}\n{anchors}")
    return "\n".join(blocks)


def _expected(case, document):
    lines = []
    for letter, title in (("R", "Requirements"), ("C", "Code and interactions"), ("T", "Tests")):
        lines += [f"## {title}", *(f"- {i.id}: {i.text} Evidence: {i.evidence}" for i in case.items[letter]), ""]
    omissions = [f"- {i.id}: {i.text} Evidence: {i.evidence}" for i in case.omissions(document)]
    lines += ["## Serious omissions for this document", *(omissions or ["- none"])]
    return "\n".join(lines)


def prompt(document, description, case, original, new):
    """The judge's prompt for `document` (analysis or plan): the rubric, the expected assessment with only the
    serious omissions that apply to this document, the original document and the one under evaluation."""
    ids = [i.id for i in case.omissions(document)]
    return TEMPLATE.format(
        document=document, document_name="analysis" if document == "analysis" else "plan", file=DOCUMENTS[document],
        dimensions=_dimensions_text(document),
        answer_dimensions=", ".join(f'"{d}": {{"reason": "...", "evidence": ["..."], "score": <1-5>}}' for d in DIMENSIONS),
        answer_omissions=", ".join(f'"{i}": {{"status": "covered|missed", "evidence": "..."}}' for i in ids),
        description=description.strip(), expected=_expected(case, document),
        original=(original or "(none was archived)").strip(), new=new.strip())


def _last_answer(text):
    """The last JSON object in the judge's words that holds "dimensions", or None."""
    decoder, found = json.JSONDecoder(), None
    for start in (i for i, ch in enumerate(text) if ch == "{"):
        try:
            value, _ = decoder.raw_decode(text[start:])
        except ValueError:
            continue
        if isinstance(value, dict) and "dimensions" in value:
            found = value
    return found


def _evidence(value):
    items = [value] if isinstance(value, str) else value if isinstance(value, list) else []
    return tuple(str(v).strip() for v in items if isinstance(v, str) and v.strip())


def read(text, omission_ids):
    """(Judgment, None) for an answer that can be read whole, else (None, why it is invalid)."""
    answer = _last_answer(text or "")
    if not answer or not isinstance(answer.get("dimensions"), dict):
        return None, "the answer holds no JSON object with \"dimensions\""
    dimensions = {}
    for name in DIMENSIONS:
        given = answer["dimensions"].get(name)
        if not isinstance(given, dict):
            return None, f"\"{name}\" is missing"
        score = given.get("score")
        if isinstance(score, bool) or not isinstance(score, int) or not 1 <= score <= 5:
            return None, f"\"{name}\" has the score {score!r}, not a whole number from 1 to 5"
        reason = given.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            return None, f"\"{name}\" has no reason"
        evidence = _evidence(given.get("evidence"))
        if not evidence:
            return None, f"\"{name}\" has no evidence"
        dimensions[name] = Dimension(score, reason.strip(), evidence)
    given_omissions = answer.get("omissions") if isinstance(answer.get("omissions"), dict) else {}
    omissions = {}
    for oid in omission_ids:
        given = given_omissions.get(oid)
        if not isinstance(given, dict):
            return None, f"the serious omission {oid} is not answered"
        status, evidence = given.get("status"), given.get("evidence")
        if status not in STATUSES:
            return None, f"the serious omission {oid} has the status {status!r}, not covered or missed"
        if not isinstance(evidence, str) or not evidence.strip():
            return None, f"the serious omission {oid} has no evidence"
        omissions[oid] = Omission(status, evidence.strip())
    return Judgment(dimensions, omissions), None


def verdict(judgment):
    """pass or fail, with why it failed, for a judgment that was read whole."""
    scores = [judgment.dimensions[d].score for d in DIMENSIONS]
    mean = sum(scores) / len(scores)
    missed = [oid for oid, o in judgment.omissions.items() if o.status == "missed"]
    low = [f"{d} {judgment.dimensions[d].score} under {MIN_DIMENSION}" for d in DIMENSIONS if judgment.dimensions[d].score < MIN_DIMENSION]
    if missed:
        would = "would pass" if mean >= PASS_MEAN and not low else "would fail too"
        return Verdict("fail", f"serious omission {', '.join(missed)} missed (mean {mean:.2f} {would})", mean, judgment)
    reasons = ([f"mean {mean:.2f} under {PASS_MEAN}"] if mean < PASS_MEAN else []) + low
    return Verdict("fail" if reasons else "pass", "; ".join(reasons), mean, judgment)


def judge(text, omission_ids):
    """The verdict on a judge's answer: invalid with why, or verdict()'s pass or fail."""
    judgment, why = read(text, omission_ids)
    if judgment is None:
        return Verdict("invalid", why, None, None)
    return verdict(judgment)
