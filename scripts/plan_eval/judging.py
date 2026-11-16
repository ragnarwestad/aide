"""One judge turn on the Claude or the Codex command line, in an empty folder, with the user's own login: the
reply, its time, tokens and cost, and why there is no reply when there is none. No API key is read or needed.

Claude reports its time, tokens and cost in its result. Codex reports tokens in its `turn.completed` events, where
`input_tokens` already holds the cached input, and no cost: a cost it does not report is None, read "not measured".
"""
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import NamedTuple, Optional

from copies import Refusal
from measure import claude_event_tokens
from table import Stats

TOOLS = ("claude", "codex")
TIMEOUT_SEC = 900


class Judge(NamedTuple):
    tool: str
    model: str
    effort: Optional[str]


class Reply(NamedTuple):
    text: Optional[str]
    stats: Optional[Stats]
    problem: Optional[str]


def judge_argument(values):
    """The Judge `--judge TOOL MODEL [EFFORT]` names; Refusal when it cannot be run."""
    if not 2 <= len(values) <= 3 or values[0] not in TOOLS:
        raise Refusal(f"--judge takes TOOL MODEL [EFFORT], the tool one of {', '.join(TOOLS)}")
    if values[0] == "codex" and len(values) == 3:
        raise Refusal("--judge codex takes no effort: the runner passes Codex none either, so give TOOL MODEL")
    return Judge(values[0], values[1], values[2] if len(values) == 3 else None)


def _environment():
    return {k: v for k, v in os.environ.items() if k != "AIDE_RUN_URL"}  # a judge reports to no board


def _codex_tokens(stdout):
    usage = None
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict) and event.get("type") == "turn.completed" and isinstance(event.get("usage"), dict):
            usage = event["usage"]
    if usage is None:
        return None
    return (usage.get("input_tokens") or 0) + (usage.get("output_tokens") or 0)


def _claude(judge, prompt, folder, out):
    command = [os.environ.get("AIDE_CLAUDE_BIN") or "claude", "-p", "--output-format", "json", "--model", judge.model,
               *(["--effort", judge.effort] if judge.effort else [])]
    started = time.monotonic()
    ran = subprocess.run(command, input=prompt, text=True, capture_output=True, cwd=folder, env=_environment(),
                         timeout=TIMEOUT_SEC)
    wall = time.monotonic() - started
    Path(f"{out}.raw").write_text(ran.stdout + (f"\n--- stderr\n{ran.stderr}" if ran.stderr else ""))
    try:
        answer = json.loads(ran.stdout)
    except ValueError:
        answer = None
    if not isinstance(answer, dict) or answer.get("is_error") or not isinstance(answer.get("result"), str):
        said = (ran.stdout or ran.stderr).strip()[:200]
        return Reply(None, Stats(wall, None, None), f"the judge answered no result (exit {ran.returncode}): {said}")
    seconds = answer["duration_ms"] / 1000 if isinstance(answer.get("duration_ms"), (int, float)) else wall
    return Reply(answer["result"], Stats(seconds, claude_event_tokens(answer), answer.get("total_cost_usd")), None)


def _codex(judge, prompt, folder, out):
    reply_file = Path(folder).parent / "codex-reply.txt"
    command = [os.environ.get("AIDE_CODEX_BIN") or "codex", "exec", "--json", "-m", judge.model, "-s", "read-only",
               "--skip-git-repo-check", "-C", str(folder), "-o", str(reply_file), "-"]
    started = time.monotonic()
    ran = subprocess.run(command, input=prompt, text=True, capture_output=True, env=_environment(), timeout=TIMEOUT_SEC)
    wall = time.monotonic() - started
    Path(f"{out}.raw").write_text(ran.stdout + (f"\n--- stderr\n{ran.stderr}" if ran.stderr else ""))
    stats = Stats(wall, _codex_tokens(ran.stdout), None)
    if ran.returncode != 0 or not reply_file.exists():
        said = (ran.stderr or ran.stdout).strip().splitlines()
        return Reply(None, stats, f"the judge answered no result (exit {ran.returncode}): {said[-1][:200] if said else ''}")
    return Reply(reply_file.read_text(), stats, None)


def ask(judge, prompt, scratch, out):
    """Send `prompt` to `judge` from an empty folder under `scratch`. `out` is the path stem the prompt
    (`.prompt.md`), the raw output (`.raw`) and the reply (`.reply.md`) are saved under."""
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(f"{out}.prompt.md").write_text(prompt)
    with tempfile.TemporaryDirectory(dir=scratch) as holder:
        folder = Path(holder) / "empty"
        folder.mkdir()
        started = time.monotonic()
        try:
            reply = (_codex if judge.tool == "codex" else _claude)(judge, prompt, folder, out)
        except subprocess.TimeoutExpired as error:  # the time it ran is known; its tokens and cost are not
            return Reply(None, Stats(time.monotonic() - started, None, None), f"the judge could not run: {error}")
        except OSError as error:
            return Reply(None, None, f"the judge could not run: {error}")
    if reply.text is not None:
        Path(f"{out}.reply.md").write_text(reply.text)
    return reply
