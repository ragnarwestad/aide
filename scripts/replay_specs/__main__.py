#!/usr/bin/env python3
"""Replay archived specs to measure how a model, or a version of the skills, does.

For each spec it is given, the script copies the project's code repository at the commit just before the spec's
code landed, and a specs repository holding only that spec (its description as archived, the other files fresh from
the templates). It runs analyze and implement there through the runner of the Aide commit it is given, with the tool,
model and effort it is given per step and that commit's skills, then measures the run: the plan review's counts,
whether every acceptance criterion has a place for its test, whether the suite is green and in how many rounds, how
many of the original spec's tests pass against the new code, a judge's score of the new plan against the original,
and time, tokens and cost per step. Without --implement only analyze runs; with --skip-analyze in place of
--analyze, implement runs on the description alone, with the analysis and the plan as the templates left them, and
no plan is judged. A row also says how many of the files the original landing changed the new analysis named. One
table with a row per spec and the totals goes to a results folder.

Nothing is written to the board's queue, to the real specs repository or to any origin, and the copies are removed
when the run ends. The script is run by hand; it is no part of any test suite and does not run on the board.

The steps run with the permission mode the board's queue gives them (bypassPermissions), in your own account and
environment: the copies keep the repositories safe, but nothing keeps a session from reaching the rest of your
machine. Run it only on specs and Aide commits you trust.

Usage:
  export CLAUDE_CODE_OAUTH_TOKEN=...   # once: `claude setup-token`; a fresh Claude config folder has no login
  python3 scripts/replay_specs --project aide --specs 590,601,605 --aide-commit 4e8a481a \\
      --analyze claude opus high [--implement codex gpt-6.1-sol] --judge opus [--advisor opus]
      [--code ~/.aide/dashboard/checkouts/<project>/code]
      [--specs-root ~/.aide/dashboard/checkouts/<project>/specs/<project>]
      [--aide-repo <the repository this script sits in>] [--results ~/.aide/replays] [--repeat 3]
  python3 scripts/replay_specs --project aide --specs 590,601 --aide-commit 4e8a481a \\
      --skip-analyze --implement claude sonnet

A step is `TOOL MODEL [EFFORT]`, the tool one of claude, codex, opencode and fake-claude. --advisor gives every claude
step that model as its advisor, through `advisorModel` in the step's Claude config folder.
--repeat replays each spec that many times, a row and a log folder each, and adds how many of a spec's replays went
green and the spread of implement's cost: one replay cannot tell a steady result from a lucky one.
"""
import argparse
import os
import shutil
import signal
import sys
import tempfile
from pathlib import Path

import steps
from copies import Refusal
from run_setup import check_inputs, prepare, step_argument
from table import render

HERE = Path(__file__).resolve().parent


def parse(argv):
    home = os.path.expanduser("~")
    ap = argparse.ArgumentParser(description="Replay archived specs to measure a model or a version of the skills.")
    ap.add_argument("--project", default="aide")
    ap.add_argument("--specs", required=True, help="comma-separated spec numbers or folder names")
    ap.add_argument("--aide-commit", required=True)
    ap.add_argument("--analyze", nargs="+", metavar="TOOL MODEL [EFFORT]")
    ap.add_argument("--skip-analyze", action="store_true", help="implement runs on the description alone; needs --implement")
    ap.add_argument("--implement", nargs="+", metavar="TOOL MODEL [EFFORT]", help="left out, only analyze runs")
    ap.add_argument("--preflight", help="shell command run in each historical code copy before any model; failure stops that spec")
    ap.add_argument("--repeat", type=int, default=1, help="how many times each spec is replayed, to see how consistent it is")
    ap.add_argument("--judge", default="opus", help="the Claude model that scores the new plan")
    ap.add_argument("--advisor", help="the model every claude step consults as its advisor")
    ap.add_argument("--code")
    ap.add_argument("--specs-root")
    ap.add_argument("--aide-repo", default=str(HERE.parents[1]))
    ap.add_argument("--results", default=os.path.join(home, ".aide", "replays"))
    args = ap.parse_args(argv)
    checkouts = os.path.join(home, ".aide", "dashboard", "checkouts", args.project)
    args.code = args.code or os.path.join(checkouts, "code")
    args.specs_root = args.specs_root or os.path.join(checkouts, "specs", args.project)
    return args


def header(sha, run):
    parts = [f"Aide {sha[:8]}", *(f"{name} {s.tool} {s.model}" + (f" {s.effort}" if s.effort else "")
                                  for name, s in (("analyze", run.analyze), ("implement", run.implement)) if s),
             *([f"advisor {run.advisor}"] if run.advisor else []),
             *([] if run.implement else ["analyze only"]),
             *([f"judge claude {run.judge_model}"] if run.analyze else ["no analyze"])]
    if "opencode" in {s.tool for s in (run.analyze, run.implement) if s}:
        parts.append("opencode reads its global AGENTS.md from the installed one")
    return " · ".join(parts)


def write_results(run, sha, rows):
    target = run.out / "results.md"
    (run.out / "results.md.tmp").write_text(render(header(sha, run), rows))
    os.replace(run.out / "results.md.tmp", target)  # a run stopped part-way keeps the rows it finished


def stop(signum, _frame):
    raise SystemExit(128 + signum)


def main(argv=None):
    args = parse(argv)
    handlers = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    tmp = None
    try:
        if args.skip_analyze and args.analyze:
            raise Refusal("--skip-analyze runs implement on the description alone, and --analyze names an analyze to run: give one of them")
        if args.skip_analyze and not args.implement:
            raise Refusal("--skip-analyze needs --implement: with analyze skipped, implement is the step that runs")
        if not args.skip_analyze and not args.analyze:
            raise Refusal("--analyze is needed, or --skip-analyze with --implement")
        if args.repeat < 1:
            raise Refusal("--repeat is how many times each spec is replayed, at least 1")
        analyze = step_argument(args.analyze, "--analyze") if args.analyze else None
        implement = step_argument(args.implement, "--implement") if args.implement else None
        check_inputs(args, analyze, implement)
        tmp = Path(os.path.realpath(tempfile.mkdtemp(prefix="replay-specs-", dir=os.environ.get("TMPDIR") or None)))
        run, sha = prepare(args, analyze, implement, tmp)
        rows = []
        specs = [s.strip() for s in args.specs.split(",") if s.strip()]
        for index, (arg, k) in enumerate((arg, k) for arg in specs for k in range(1, args.repeat + 1)):
            rows.append(steps.replay_one(run, arg, index, (k, args.repeat) if args.repeat > 1 else None))
            write_results(run, sha, rows)
        print(run.out / "results.md")
        return 0
    except Refusal as error:
        print(f"replay_specs: {error}", file=sys.stderr)
        return 2
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
        for number, handler in handlers.items():
            signal.signal(number, handler)


if __name__ == "__main__":
    sys.exit(main())
