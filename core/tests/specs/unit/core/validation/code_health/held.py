"""What is over a threshold, compared with the level held for it.

Code already over a threshold is recorded in held.json at its level, and
fails only when it gets worse: equal or better passes, and so does an
entry whose function or file is gone. Anything over a threshold with no
entry fails."""
import json
from pathlib import Path

# Past a screenful a function nearly always does more than one job; at 60
# lines only a handful of the repository's functions are over.
MAX_LINES = 60
# A fifth level of control blocks means a reader holds five conditions at
# once; an early return or a helper always brings it back.
MAX_DEPTH = 4

RULE = 'AGENTS.md, "Code health"'
FIX = {
    "lines": f"split the function so each part does one job ({RULE})",
    "depth": f"return early, or move the inner blocks into a helper ({RULE})",
    "duplicates": f"move the repeated block into one shared helper ({RULE})",
}
UNIT = {"lines": "lines", "depth": "levels deep"}
LIMIT = {"lines": MAX_LINES, "depth": MAX_DEPTH}


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def function_failures(measured, held):
    """One line per function measure over its limit and not within its held level."""
    bad = []
    for key in sorted(measured):
        for measure, limit in LIMIT.items():
            value = measured[key][measure]
            recorded = held.get(key, {}).get(measure)
            if value <= limit or (recorded is not None and value <= recorded):
                continue
            against = f"limit {limit}" if recorded is None else f"recorded {recorded}"
            bad.append(f"{key}: {value} {UNIT[measure]} ({against}) — {FIX[measure]}")
    return bad


def duplicate_failures(found, held):
    """One line per file with more repeated blocks than its held level (0 unless held)."""
    bad = []
    for path in sorted(found):
        count, recorded = len(found[path]), held.get(path, 0)
        if count > recorded:
            line, other, other_line = found[path][0]
            bad.append(f"{path}: {count} repeated blocks (held {recorded}), the first at line {line}, "
                       f"also at {other}:{other_line} — {FIX['duplicates']}")
    return bad
