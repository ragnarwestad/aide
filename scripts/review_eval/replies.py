"""Reading what a review and a verification answered, and scoring them against the labelled findings."""
import json
import re

REVIEW_LINE = re.compile(r"^review: ", re.I | re.M)
NUMBERED = re.compile(r"^\s*(\d+)\.\s+(.*\S)")
DECISION = re.compile(r"^\s*(keep|drop)\s+(\d+)\b\.?\s*(.*)$", re.I)


def review_defects(text):
    """The numbered defects after the last `review:` line, as the runner reads them; [] for no defects and None for
    a reply without the line."""
    lines = (text or "").splitlines()
    marks = [i for i, line in enumerate(lines) if REVIEW_LINE.match(line)]
    if not marks:
        return None
    verdict = lines[marks[-1]]
    if "no defects found" in verdict.lower():
        return []
    defects = []
    for line in lines[marks[-1] + 1:]:
        found = NUMBERED.match(line)
        if found:
            defects.append(found.group(2))
        elif defects and line.strip():
            defects[-1] += " " + line.strip()
    return defects


def numbered(texts):
    return "\n".join(f"{n}. {text}" for n, text in enumerate(texts, 1))


def decisions(text, count):
    """What a verification decided for defects 1..count: {n: ("keep"|"drop", why)}. A defect it gives no line for is
    kept, as the runner keeps it."""
    found = {}
    for line in (text or "").splitlines():
        match = DECISION.match(line)
        if match and 1 <= int(match.group(2)) <= count:
            found[int(match.group(2))] = (match.group(1).lower(), match.group(3).strip())
    return {n: found.get(n, ("keep", "no line for it")) for n in range(1, count + 1)}


def verify_score(findings, decided):
    """Counts of what a verification did with labelled findings: real kept, false dropped, and the rest."""
    score = {"real": 0, "real kept": 0, "false": 0, "false dropped": 0, "unclear": 0, "unclear kept": 0}
    for finding in findings:
        verdict = finding["verdict"]
        action = decided[finding["id"]][0]
        score[verdict] += 1
        if verdict == "real" and action == "keep":
            score["real kept"] += 1
        elif verdict == "false" and action == "drop":
            score["false dropped"] += 1
        elif verdict == "unclear" and action == "keep":
            score["unclear kept"] += 1
    return score


def matches(text, count, known_ids):
    """The judge's answer: for each new finding 1..count, the id of the labelled finding it describes, or "new"."""
    answer = None
    for start in (i for i, ch in enumerate(text or "") if ch == "{"):
        try:
            value, _ = json.JSONDecoder().raw_decode(text[start:])
        except ValueError:
            continue
        if isinstance(value, dict):
            answer = value
    answer = answer or {}
    return {n: (answer.get(str(n)) if answer.get(str(n)) in known_ids else "new") for n in range(1, count + 1)}


def review_score(labelled, matched):
    """Counts for one review run: the labelled real ones it found, the labelled false and unclear ones it reported,
    and the new ones that still need a verdict."""
    by_id = {f["id"]: f for f in labelled}
    hit = {m for m in matched if m != "new"}
    return {
        "real": sum(f["verdict"] == "real" for f in labelled),
        "real found": sum(by_id[i]["verdict"] == "real" for i in hit),
        "false reported": sum(by_id[i]["verdict"] == "false" for i in hit),
        "unclear reported": sum(by_id[i]["verdict"] == "unclear" for i in hit),
        "new": sum(m == "new" for m in matched),
    }
