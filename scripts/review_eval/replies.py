"""Reading what a review and a verification answered, by the runner's own rule, and scoring them against the labelled
findings."""
import json
import subprocess
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "core" / "scripts"
# What the runner's verify_reply_decision gives a defect the reply has no keep or drop line for.
NO_LINE = ("keep", "no line for it")


def _runner(body, *args):
    """Run `body` in bash with the runner's review-prompts.sh sourced, as prompt() in __main__.py does."""
    script = f'source "$1/_aide-spec-lib.sh"; source "$1/lib/run-spec/turn/review-prompts.sh"; shift; {body}'
    return subprocess.run(["bash", "-c", script, "bash", str(SCRIPTS), *args], capture_output=True, text=True,
                          check=True).stdout


def review_defects(text):
    """The numbered defects after the last `review:` line, read by the runner's own rule; [] for no defects and None
    for a reply without the line."""
    part = _runner('review_reply_part "$1"', text or "").splitlines()
    if not part:
        return None
    if "no defects found" in part[0].lower():
        return []
    found = _runner('review_reply_findings "$1"', "\n".join(part[1:]))
    return [line.split("\t", 1)[1] for line in found.splitlines()]


def numbered(texts):
    return "\n".join(f"{n}. {text}" for n, text in enumerate(texts, 1))


def decisions(text, count):
    """What a verification decided for defects 1..count, read by the runner's own rule: {n: ("keep"|"drop", why)}. A
    defect it gives no line for is kept, as the runner keeps it."""
    body = 'reply="$1"; shift; for n in "$@"; do printf \'%s\\t\' "$n"; verify_reply_decision "$reply" "$n"; done'
    found = _runner(body, text or "", *(str(n) for n in range(1, count + 1)))
    decided = {}
    for line in found.splitlines():
        n, action, why = line.split("\t", 2)
        decided[int(n)] = (action, why)
    return decided


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
