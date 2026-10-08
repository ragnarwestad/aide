"""The judge: one `claude -p` turn that scores the new plan against the original."""
import json
import os
import subprocess
import tempfile
import time
from collections import namedtuple

from measure import claude_event_tokens
from table import Stats

JudgeResult = namedtuple("JudgeResult", "score reasons stats")

PROMPT = """You compare two plans written for the same spec. The spec's description is first, then the original plan (its
3-solution.md), then a new plan written from the same description. Judge the new plan against the original: does it
name the right files and the right tests, does it cover every acceptance criterion, is the approach sound and as simple?

Score the new plan from 1 (clearly worse than the original) to 5 (clearly better); 3 means as good. Answer with one JSON
object and nothing else: {{"score": <1-5>, "reasons": "<a few sentences>"}}

<description>
{description}
</description>

<original_plan>
{original}
</original_plan>

<new_plan>
{new}
</new_plan>
"""


def last_score(text):
    """The last JSON object with a "score" in the model's words, or None."""
    decoder, found = json.JSONDecoder(), None
    for start in (i for i, ch in enumerate(text) if ch == "{"):
        try:
            value, _ = decoder.raw_decode(text[start:])
        except ValueError:
            continue
        if isinstance(value, dict) and "score" in value:
            found = value
    return found


def read_answer(text):
    answer = last_score(text)
    score = answer.get("score") if answer else None
    if isinstance(score, int) and not isinstance(score, bool) and 1 <= score <= 5:
        return score, str(answer.get("reasons", "")).strip()
    return None, (text.strip().splitlines() or [""])[0]


def ask(model, description, original, new, scratch):
    """Score `new` against `original`. The judge runs no skill, so it uses the user's own Claude configuration."""
    binary = os.environ.get("AIDE_CLAUDE_BIN") or "claude"
    prompt = PROMPT.format(description=description, original=original, new=new)
    started = time.monotonic()
    with tempfile.TemporaryDirectory(dir=scratch) as folder:
        try:
            ran = subprocess.run([binary, "-p", "--output-format", "json", "--model", model], input=prompt, text=True,
                                 capture_output=True, cwd=folder, timeout=900)
        except (OSError, subprocess.TimeoutExpired) as error:
            return JudgeResult(None, f"the judge could not run: {error}", None)
    wall = time.monotonic() - started
    try:
        answer = json.loads(ran.stdout)
        text = answer.get("result") or ""
    except (ValueError, AttributeError):
        return JudgeResult(None, f"the judge answered no JSON: {(ran.stdout or ran.stderr).strip()[:200]}", Stats(wall, None, None, False))
    score, reasons = read_answer(text)
    seconds = answer["duration_ms"] / 1000 if isinstance(answer.get("duration_ms"), (int, float)) else wall
    return JudgeResult(score, reasons, Stats(seconds, claude_event_tokens(answer), answer.get("total_cost_usd"), False))
