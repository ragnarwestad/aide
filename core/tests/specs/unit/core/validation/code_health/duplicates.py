"""Blocks of normalised lines repeated across a set of files, for Python
and bash.

Below 8 lines, repeats are mostly idiom — argument parsing, imports,
guard lines; at 8 the source holds a few dozen cases, few enough to hold
and review. A normalised line is trimmed; blank lines, comment-only lines
and lines that only close a block are left out, so a copy cannot hide
behind a reflowed blank or a moved comment."""
import re

WINDOW = 8
_CLOSER = re.compile(r"(?:[\]\)\}]|fi|done|esac|;;)+[;,]*")


def _normalised(text):
    """(line number, trimmed line) for every line that counts."""
    kept = []
    for number, line in enumerate(text.splitlines(), start=1):
        line = line.strip()
        if line and not line.startswith("#") and not _CLOSER.fullmatch(line):
            kept.append((number, line))
    return kept


def duplicates(files):
    """{path: [(line, other path, other line), ...]} — one entry per window
    of WINDOW normalised lines starting in the file that also appears
    elsewhere, in the same file or another, so a copy is charged to both
    files. Files with none are left out."""
    seen = {}
    for path in sorted(files):
        lines = _normalised(files[path])
        for start in range(len(lines) - WINDOW + 1):
            window = tuple(line for _, line in lines[start:start + WINDOW])
            seen.setdefault(window, []).append((path, lines[start][0]))
    found = {}
    for places in seen.values():
        for index, (path, line) in enumerate(places):
            if len(places) > 1:
                other = places[1] if index == 0 else places[0]
                found.setdefault(path, []).append((line, *other))
    return {path: sorted(found[path]) for path in sorted(found)}
