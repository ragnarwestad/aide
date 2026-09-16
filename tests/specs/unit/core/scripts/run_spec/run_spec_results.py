"""What a run reports back: the result JSON a stand-in prints, the usage
shapes each tool records it in, and the stream a run keeps while it
works.

Split out of conftest.py 2026-09-04; unchanged, and each keeps its name.
"""

import json
import shlex


RESULT_OK = {
    "type": "result", "subtype": "success", "is_error": False,
    "session_id": "ee80227f-510c-45e9-bfbf-c5124f7761c0",
    "total_cost_usd": 0.5357, "num_turns": 1, "terminal_reason": "completed",
    "result": "done",
}


# What a real result event carries beside the cost, read off an actual
# transcript on this machine (2026-08-19, `claude` 2.1.x): `modelUsage`
# is the SESSION's total, keyed by model and named in camelCase, while
# the flat `usage` block is the last turn's alone. Two models here on
# purpose — a run that switched model mid-session has a block each, and
# reading only the first would under-report every one of them.
MODEL_USAGE = {
    "claude-opus-5": {
        "inputTokens": 86, "outputTokens": 60258,
        "cacheReadInputTokens": 4492445, "cacheCreationInputTokens": 383592,
        "webSearchRequests": 0, "costUSD": 3.93,
    },
    "claude-haiku-4-5": {
        "inputTokens": 14, "outputTokens": 742,
        "cacheReadInputTokens": 5555, "cacheCreationInputTokens": 408,
        "webSearchRequests": 0, "costUSD": 0.01,
    },
}


# The same event's flat block: snake_case, and only what the LAST turn
# used. It is the fallback, never the first choice.
FLAT_USAGE = {
    "input_tokens": 54, "output_tokens": 22054,
    "cache_read_input_tokens": 3177754, "cache_creation_input_tokens": 107458,
    "service_tier": "standard",
}


# --- spec 125: the same fixture pattern, for the second tool ------------------
#
# Codex's non-interactive mode (`codex exec --json`) writes JSONL to
# stdout the way `claude -p --output-format stream-json` does, but the
# events are a different shape: a `thread.started` carrying Codex's own
# thread id, `item.*` events for what it did, and a closing
# `turn.completed` carrying the usage block. Every field below was read
# off the installed CLI (`codex-cli 0.147.0`, 2026-08-20) rather than
# assumed — the event names and the four `usage` keys are in the
# binary's own strings.
CODEX_USAGE = {
    "input_tokens": 4210,
    "cached_input_tokens": 3900,
    "output_tokens": 812,
    "reasoning_output_tokens": 640,
}


CODEX_THREAD_ID = "0199f4c2-6d1a-7c31-9f0e-2b7a5c8d1e44"


def emits(stream: str) -> str:
    """A fake-binary body that consumes the prompt and prints `stream`
    verbatim. One `printf` argument per line: a single quoted blob would
    reach bash with its `\\n` escapes intact and print one long line,
    which parses as nothing at all."""
    args = " ".join(shlex.quote(l) for l in stream.split("\n"))
    return f"cat > /dev/null; printf '%s\\n' {args}"


CODEX_STREAM_OK = "\n".join(
    json.dumps(e)
    for e in [
        {"type": "thread.started", "thread_id": CODEX_THREAD_ID},
        {"type": "turn.started"},
        {"type": "item.completed", "item": {"id": "item_0", "item_type": "agent_message", "text": "done"}},
        {"type": "turn.completed", "usage": CODEX_USAGE},
    ]
)


CODEX_STREAM_FAILED = "\n".join(
    json.dumps(e)
    for e in [
        {"type": "thread.started", "thread_id": CODEX_THREAD_ID},
        {"type": "turn.failed", "error": {"message": "the model refused the turn"}},
    ]
)


STREAM_NOISE = [
    {"type": "system", "subtype": "init", "cwd": "/x"},
    {"type": "assistant", "message": {"content": [{"type": "text", "text": "Reading queue.ts"}]}},
]


def stream_body(result, before=STREAM_NOISE, after=None, exit_code=0):
    """A fake claude that emits NDJSON the way --output-format
    stream-json does: many events, the result among them."""
    lines = "".join(f"echo '{json.dumps(e)}'\n" for e in before)
    lines += f"echo '{json.dumps(result)}'\n"
    for e in after or []:
        lines += f"echo '{json.dumps(e)}'\n"
    return "cat > /dev/null\n" + lines + f"exit {exit_code}"


RESULT_ERROR = {
    "type": "result", "subtype": "error_during_execution", "is_error": True,
    "session_id": "3f1d5b0e-9a2c-4d21-8b77-2e6a4c9d1f30",
    "total_cost_usd": 0.1042, "terminal_reason": "error",
    "errors": ["the project's tests are red after the merge"],
}


OPENCODE_SESSION_ID = "ses_f5706d229ffeybcta39ML4GY02"


def _opencode_step(cost, input_t, output_t, reasoning_t, cache_read, cache_write):
    """One `step_finish` part, in the shape opencode 1.18.31 emits."""
    return {
        "type": "step_finish",
        "sessionID": OPENCODE_SESSION_ID,
        "part": {
            "type": "step-finish",
            "reason": "stop",
            "cost": cost,
            "tokens": {
                "input": input_t,
                "output": output_t,
                "reasoning": reasoning_t,
                "cache": {"read": cache_read, "write": cache_write},
            },
        },
    }


# THREE steps, deliberately: opencode closes no turn with one summary
# event, so a run's totals are the sum over every `step_finish` it
# emitted. A fixture with a single step would pass just as well against
# code that read the last event alone.
OPENCODE_STEPS = [
    _opencode_step(0.0125, 1200, 40, 10, 0, 800),
    _opencode_step(0.0400, 3400, 120, 60, 5000, 0),
    _opencode_step(0.0075, 900, 35, 5, 2500, 0),
]

OPENCODE_TOTALS = {
    "cost": 0.06,
    "input": 5500,
    "output": 270,
    "cacheRead": 7500,
    "cacheCreation": 800,
}


OPENCODE_STREAM_OK = "\n".join(
    json.dumps(e)
    for e in [
        {"type": "step_start", "sessionID": OPENCODE_SESSION_ID, "part": {"type": "step-start"}},
        OPENCODE_STEPS[0],
        {
            "type": "tool_use",
            "sessionID": OPENCODE_SESSION_ID,
            "part": {"type": "tool", "tool": "read"},
        },
        OPENCODE_STEPS[1],
        {
            "type": "text",
            "sessionID": OPENCODE_SESSION_ID,
            "part": {"type": "text", "text": "done"},
        },
        OPENCODE_STEPS[2],
    ]
)


OPENCODE_STREAM_FAILED = "\n".join(
    json.dumps(e)
    for e in [
        {
            "type": "error",
            "sessionID": OPENCODE_SESSION_ID,
            "error": {
                "name": "UnknownError",
                "data": {"message": "the model refused the turn"},
            },
        }
    ]
)
