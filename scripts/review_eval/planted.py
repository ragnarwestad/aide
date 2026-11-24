"""Planted and clean cases: running the review and its verification on them, scoring what they answered, and the
report of a run.

A planted case is an implement commit with one defect added by its patch, applied uncommitted, and described. A clean
case is a commit promised to have none, so every finding on it is false. A figure a failed or unreadable turn decides
is NOT_MEASURED: it is listed with why, and counts in no total.
"""
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

import replies

HERE = Path(__file__).resolve().parent
NOT_MEASURED = "not measured"
# The figures each kind of case is scored on, the ones a comparison compares.
FIGURES = {"planted": ("found", "kept"), "clean": ("false_review", "false_kept")}
JUDGE_ID = "planted"


def load_cases(path=HERE / "planted.json"):
    return json.loads(Path(path).read_text())["cases"]


def structure_problems(case, base=HERE):
    """What is wrong with a case's entry, without git: [] when nothing is."""
    kind = case.get("kind")
    if kind not in FIGURES:
        return [f"kind is {kind!r}, not planted or clean"]
    if kind == "clean":
        return [f"a clean case has no {key}" for key in ("defect", "patch") if key in case]
    problems = [] if str(case.get("defect", "")).strip() else ["a planted case describes its defect"]
    if not case.get("patch") or not (Path(base) / case["patch"]).is_file():
        problems.append(f"the patch {case.get('patch')!r} does not exist")
    return problems


def digest(case, base=HERE):
    """The sha256 of a case's entry and its patch, so a comparison can tell a case that changed between runs."""
    sha = hashlib.sha256(json.dumps(case, sort_keys=True).encode())
    if case.get("patch") and (Path(base) / case["patch"]).is_file():
        sha.update((Path(base) / case["patch"]).read_bytes())
    return sha.hexdigest()


def patch_applies(code, commit, patch):
    """Whether `patch` applies to `commit` in the repository `code`, checked in a scratch index with no worktree:
    None when it does, else why not."""
    with tempfile.TemporaryDirectory() as scratch:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(scratch) / "index")}
        for args in (["read-tree", commit], ["apply", "--cached", "--check", str(Path(patch).resolve())]):
            ran = subprocess.run(["git", "-C", str(code), *args], capture_output=True, text=True, env=env)
            if ran.returncode != 0:
                return f"git {args[0]}: {(ran.stderr or ran.stdout).strip()}"
    return None


def apply_patch(tree, patch):
    """Apply `patch` to the worktree `tree`, uncommitted: None when it applied, else why not."""
    ran = subprocess.run(["git", "-C", str(tree), "apply", str(Path(patch).resolve())], capture_output=True, text=True)
    return None if ran.returncode == 0 else f"the patch does not apply: {(ran.stderr or ran.stdout).strip()}"


def _judged(answer, count):
    """The numbers of the findings the judge says describe the planted defect, or None for an answer that does not
    decide every finding: no JSON object, or a last one without an entry for each finding's number."""
    decoder = json.JSONDecoder()
    last = None
    for start in (i for i, ch in enumerate(answer or "") if ch == "{"):
        try:
            value, _ = decoder.raw_decode(answer[start:])
        except ValueError:
            continue
        if isinstance(value, dict):
            last = value
    if last is None or any(str(n) not in last for n in range(1, count + 1)):
        return None
    return {n for n, m in replies.matches(answer, count, {JUDGE_ID}).items() if m == JUDGE_ID}


def _decided(reply, count):
    """What the verification decided for findings 1..count, or None for a reply with no keep or drop line for any
    of them: an error or an empty reply decides nothing."""
    decided = replies.decisions(reply, count)
    if all(decision == replies.NO_LINE for decision in decided.values()):
        return None
    return decided


def score_case(case, review_reply, verify_reply=None, judge_answer=None):
    """A case's figures from what the review, the verification and the judge answered; `error` says why a figure is
    NOT_MEASURED, or, alone, why the case has none."""
    defects = replies.review_defects(review_reply)
    if defects is None:
        return {"error": "the review's reply has no review: line"}
    errors = []
    verified = None
    if defects:
        verified = _decided(verify_reply, len(defects))
        if verified is None:
            errors.append("the verification's reply is empty or has no keep or drop line")
    if case["kind"] == "clean":
        kept = sum(d[0] == "keep" for d in verified.values()) if verified is not None else NOT_MEASURED
        out = {"false_review": len(defects), "false_kept": kept if defects else 0}
    elif not defects:
        out = {"found": False, "kept": False, "other": 0}
    else:
        hits = _judged(judge_answer, len(defects))
        if hits is None:
            errors.append("the judge's answer has no JSON object deciding every finding")
            out = {"found": NOT_MEASURED, "kept": NOT_MEASURED, "other": NOT_MEASURED}
        elif not hits:
            out = {"found": False, "kept": False, "other": len(defects)}
        else:
            kept = any(verified[n][0] == "keep" for n in hits) if verified is not None else NOT_MEASURED
            out = {"found": True, "kept": kept, "other": len(defects) - len(hits)}
    if errors:
        out["error"] = "; ".join(errors)
    return out


def judge_prompt(template, case, defects):
    return template.format(known=f"{JUDGE_ID}: {case['defect']}", new=replies.numbered(defects))


def run_case(case, tree, fork, description, base, headless, template, build, ask):
    """One case in the detached worktree `tree` at its commit: the patch, then the review, the verification of its
    findings as the runner does, and for a planted case the judge. `build(function, *args)` builds a prompt from
    review-prompts.sh; `ask(role, text)` answers it, `role` being review, verify or judge."""
    out = {"id": case["id"], "kind": case["kind"], "spec": case["spec"]}
    if case["kind"] == "planted":
        error = apply_patch(tree, Path(base) / case["patch"])
        if error:
            return {**out, "error": error}
    review = ask("review", build("review_prompt", str(description), fork, "main", "", headless, str(tree)))
    defects = replies.review_defects(review)
    verify = judge = None
    if defects:
        verify = ask("verify", build("verify_prompt", str(description), fork, "main", replies.numbered(defects),
                                     headless, str(tree)))
        if case["kind"] == "planted":
            judge = ask("judge", judge_prompt(template, case, defects))
    return {**out, **score_case(case, review, verify, judge), "defects": defects or []}


def _measured(value):
    return isinstance(value, (bool, int)) and not isinstance(value, str)


def totals(outcomes):
    """Per figure, its sum and the number of cases it was measured on."""
    result = {}
    for kind, figures in FIGURES.items():
        for figure in figures:
            values = [int(o[figure]) for o in outcomes if o.get("kind") == kind and _measured(o.get(figure))]
            result[figure] = {"sum": sum(values), "cases": len(values)}
    return result


def summary(t):
    return (f"Planted: {t['found']['sum']} of {t['found']['cases']} found by the review, {t['kept']['sum']} kept by "
            f"the verification. Clean: {t['false_review']['sum']} false findings raised, {t['false_kept']['sum']} kept.")


def _word(value, yes, no):
    return NOT_MEASURED if not _measured(value) else (yes if value else no)


def case_line(o):
    if not any(f in o for f in FIGURES[o["kind"]]):
        return f"- {o['id']}: error: {o.get('error', 'no figures')}"
    if o["kind"] == "planted":
        line = (f"- {o['id']}: {_word(o['found'], 'found', 'not found')} by the review, "
                f"{_word(o['kept'], 'kept', 'not kept')} by the verification, {o['other']} other finding(s)")
    else:
        line = f"- {o['id']}: {o['false_review']} false finding(s) raised, {o['false_kept']} kept"
    return line + (f" ({o['error']})" if o.get("error") else "")


def write_results(out, setup, outcomes):
    """results.json (the setup, the case outcomes and the totals) and results.md in the folder `out`; the summary."""
    t = totals(outcomes)
    head = summary(t)
    Path(out).mkdir(parents=True, exist_ok=True)
    Path(out, "results.json").write_text(json.dumps({"setup": setup, "cases": outcomes, "totals": t}, indent=1) + "\n")
    Path(out, "results.md").write_text("\n".join([head, "", *map(case_line, outcomes)]) + "\n")
    return head
