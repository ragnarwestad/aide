"""results.md: the run's settings, a row per spec with the totals, and the judge's reasons."""
from collections import namedtuple
from dataclasses import dataclass
from typing import Optional

# What a step used. A None is a figure that was not measured; `last_turn` marks tokens that are the last turn's alone.
Stats = namedtuple("Stats", "seconds tokens cost last_turn")

COLUMNS = ("Spec", "Must-fix", "Should-fix", "Every AC placed", "Green", "Rounds", "Original tests", "Judge",
           "Analyze time/tokens/cost", "Implement time/tokens/cost", "Judge time/tokens/cost", "Note")


@dataclass
class Row:
    spec: str
    folder: str = ""
    replayed: bool = False
    must: Optional[int] = None
    should: Optional[int] = None
    placed: str = "–"
    green: str = "–"
    rounds: Optional[int] = None
    original: Optional[tuple] = None  # (passed, ran, files not run)
    judge: object = None  # a score, or the words "no score"
    reasons: str = ""
    analyze: Optional[Stats] = None
    implement: Optional[Stats] = None
    judging: Optional[Stats] = None
    notes: tuple = ()


def duration(seconds):
    seconds = int(round(seconds))
    minutes, rest = divmod(seconds, 60)
    return f"{rest}s" if not minutes else f"{minutes}m" if not rest else f"{minutes}m{rest}s"


def count(n):
    return str(n) if n < 1000 else f"{n / 1000:.0f}k" if n < 1_000_000 else f"{n / 1_000_000:.1f}M"


def money(cost):
    return "not measured" if cost is None else f"${cost:.2f}"


def step_cell(stats):
    if stats is None:
        return "–"
    tokens = "not measured" if stats.tokens is None else count(stats.tokens) + (" (last turn)" if stats.last_turn else "")
    return f"{duration(stats.seconds)} · {tokens} · {money(stats.cost)}"


def original_cell(original):
    if original is None:
        return "–"
    passed, ran, not_run = original
    return f"{passed}/{ran}" + (f" ({not_run} file{'s' if not_run != 1 else ''} not run)" if not_run else "")


def number(value):
    return "–" if value is None else str(value)


def cells(row):
    return [row.spec, number(row.must), number(row.should), row.placed, row.green, number(row.rounds), original_cell(row.original),
            number(row.judge), step_cell(row.analyze), step_cell(row.implement), step_cell(row.judging), "; ".join(row.notes)]


def total_step(stats, replayed):
    """Summed time and tokens, and the summed cost with how many of the steps measured one."""
    if not replayed:
        return "–"
    ran = [s for s in stats if s is not None]
    tokens = [s.tokens for s in ran if s.tokens is not None]
    paid = [s.cost for s in ran if s.cost is not None]
    return (f"{duration(sum(s.seconds for s in ran))} · {count(sum(tokens)) if tokens else 'not measured'} · "
            f"${sum(paid):.2f} ({len(paid)} of {len(ran)} measured)")


def total_row(rows):
    replayed = [r for r in rows if r.replayed]
    musts, shoulds = [r.must for r in replayed if r.must is not None], [r.should for r in replayed if r.should is not None]
    rounds = [r.rounds for r in replayed if r.rounds is not None]
    originals = [r.original for r in replayed if r.original is not None]
    scores = [r.judge for r in replayed if isinstance(r.judge, int)]
    n = len(replayed)
    return [f"Total ({n} of {len(rows)} replayed)",
            str(sum(musts)) if musts else "–", str(sum(shoulds)) if shoulds else "–",
            f"{sum(r.placed == 'yes' for r in replayed)} of {n}", f"{sum(r.green == 'yes' for r in replayed)} of {n}",
            str(sum(rounds)) if rounds else "–",
            f"{sum(o[0] for o in originals)}/{sum(o[1] for o in originals)}" if originals else "–",
            f"{sum(scores) / len(scores):.1f}" if scores else "–",
            total_step([r.analyze for r in replayed], n), total_step([r.implement for r in replayed], n),
            total_step([r.judging for r in replayed], n), ""]


def render(header, rows):
    """The whole of results.md."""
    def line(values):
        return "| " + " | ".join(str(v).replace("|", "/").replace("\n", " ") for v in values) + " |"
    out = [header, "", line(COLUMNS), line(["---"] * len(COLUMNS))]
    out += [line(cells(r)) for r in rows] + [line(total_row(rows))]
    reasons = [f"- {r.folder or r.spec} ({number(r.judge)}): {r.reasons}" for r in rows if r.reasons]
    if reasons:
        out += ["", "Judge's reasons", *reasons]
    return "\n".join(out) + "\n"
