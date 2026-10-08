#!/usr/bin/env python3
"""Replay archived specs to measure how a model, or a version of the skills, does.

For each spec it is given, the script copies the project's code repository at the commit just before the spec's
code landed, and a specs repository holding only that spec (its description as archived, the other files fresh from
the templates). It runs analyze and implement there through the runner of the Aide commit it is given, with the tool,
model and effort it is given per step and that commit's skills, then measures the run: the plan review's counts,
whether every acceptance criterion has a place for its test, whether the suite is green and in how many rounds, how
many of the original spec's tests pass against the new code, a judge's score of the new plan against the original,
and time, tokens and cost per step. One table with a row per spec and the totals goes to a results folder.

Nothing is written to the board's queue, to the real specs repository or to any origin, and the copies are removed
when the run ends. The script is run by hand; it is no part of any test suite and does not run on the board.

The steps run with the permission mode the board's queue gives them (bypassPermissions), in your own account and
environment: the copies keep the repositories safe, but nothing keeps a session from reaching the rest of your
machine. Run it only on specs and Aide commits you trust.

Usage:
  export CLAUDE_CODE_OAUTH_TOKEN=...   # once: `claude setup-token`; a fresh Claude config folder has no login
  python3 scripts/replay_specs --project aide --specs 590,601,605 --aide-commit 4e8a481a \\
      --analyze claude opus high --implement codex gpt-6.1-sol --judge opus
      [--code ~/.aide/dashboard/checkouts/<project>/code]
      [--specs-root ~/.aide/dashboard/checkouts/<project>/specs/<project>]
      [--aide-repo <the repository this script sits in>] [--results ~/.aide/replays]

A step is `TOOL MODEL [EFFORT]`, the tool one of claude, codex, opencode and fake-claude.
"""
import argparse
import datetime
import os
import shutil
import signal
import sys
import tempfile
from pathlib import Path

import copies
import steps
from copies import Refusal
from gitutil import git
from table import render

TOOLS = ("claude", "codex", "opencode", "fake-claude")
HERE = Path(__file__).resolve().parent


def step_argument(values, option):
    if not 2 <= len(values) <= 3 or values[0] not in TOOLS:
        raise Refusal(f"{option} takes TOOL MODEL [EFFORT], the tool one of {', '.join(TOOLS)}")
    return steps.Step(values[0], values[1], values[2] if len(values) == 3 else None)


def parse(argv):
    home = os.path.expanduser("~")
    ap = argparse.ArgumentParser(description="Replay archived specs to measure a model or a version of the skills.")
    ap.add_argument("--project", default="aide")
    ap.add_argument("--specs", required=True, help="comma-separated spec numbers or folder names")
    ap.add_argument("--aide-commit", required=True)
    ap.add_argument("--analyze", nargs="+", required=True, metavar="TOOL MODEL [EFFORT]")
    ap.add_argument("--implement", nargs="+", required=True, metavar="TOOL MODEL [EFFORT]")
    ap.add_argument("--judge", default="opus", help="the Claude model that scores the new plan")
    ap.add_argument("--code")
    ap.add_argument("--specs-root")
    ap.add_argument("--aide-repo", default=str(HERE.parents[1]))
    ap.add_argument("--results", default=os.path.join(home, ".aide", "replays"))
    args = ap.parse_args(argv)
    checkouts = os.path.join(home, ".aide", "dashboard", "checkouts", args.project)
    args.code = args.code or os.path.join(checkouts, "code")
    args.specs_root = args.specs_root or os.path.join(checkouts, "specs", args.project)
    return args


def inside(path, repo):
    path, repo = os.path.realpath(path), os.path.realpath(repo)
    return path == repo or path.startswith(repo + os.sep)


def check_inputs(args, analyze, implement):
    """Everything that can be refused before anything is copied."""
    if "claude" in (analyze.tool, implement.tool) and not (os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") or os.environ.get("ANTHROPIC_API_KEY")):
        raise Refusal("a step names claude, and a fresh Claude config folder has no login: run `claude setup-token` once and "
                      "export CLAUDE_CODE_OAUTH_TOKEN (or set ANTHROPIC_API_KEY)")
    for what, path in (("code checkout", args.code), ("specs root", args.specs_root), ("Aide repository", args.aide_repo)):
        if not os.path.isdir(path):
            raise Refusal(f"the {what} {path} does not exist")
    for what, path in (("code", args.code), ("specs", args.specs_root), ("Aide", args.aide_repo)):
        top = git(path, "rev-parse", "--show-toplevel", check=False)
        if top and inside(args.results, top):
            raise Refusal(f"the results folder {args.results} lies inside the {what} repository {top}")


def prepare(args, analyze, implement, tmp):
    """The export, the tools' configuration folders and the run's folders; Refusal when the commit cannot be replayed with."""
    core, sha = copies.export_aide(args.aide_repo, args.aide_commit, tmp)
    home, configured = os.path.expanduser("~"), {}
    for tool in {analyze.tool, implement.tool}:
        key = "claude" if tool == "fake-claude" else tool
        configured[tool] = configured[key] if key in configured else copies.tool_environment(core, tool, tmp / "tools", home)
    (tmp / "tmp").mkdir()
    env = {k: v for k, v in os.environ.items() if k != "AIDE_RUN_URL"}  # no step reports to a board
    env["PATH"] = f"{core / 'scripts'}{os.pathsep}{env.get('PATH', '')}"
    env["TMPDIR"] = str(tmp / "tmp")
    stamp = f"{datetime.datetime.now():%Y%m%d-%H%M}-{sha[:8]}"
    out, n = Path(args.results) / stamp, 1
    while out.exists():
        n += 1
        out = Path(args.results) / f"{stamp}-{n}"
    out.mkdir(parents=True)
    branch = copies.default_branch(args.code)
    return steps.Run(project=args.project, code=os.path.realpath(args.code), specs_root=os.path.realpath(args.specs_root), core=core,
                     tmp=tmp, out=out, analyze=analyze, implement=implement, judge_model=args.judge, branch=branch,
                     code_landing="pr" if copies.manifest_value(args.code, "codeLanding") == "pr" else "merge",
                     env=env, tool_env=configured), sha


def header(sha, run):
    parts = [f"Aide {sha[:8]}", *(f"{name} {s.tool} {s.model}" + (f" {s.effort}" if s.effort else "")
                                  for name, s in (("analyze", run.analyze), ("implement", run.implement))),
             f"judge claude {run.judge_model}", "no wiki in the specs copy"]
    if "opencode" in (run.analyze.tool, run.implement.tool):
        parts.append("opencode reads its global AGENTS.md from the installed one")
    return " · ".join(parts)


def write_results(run, sha, rows):
    target = run.out / "results.md"
    (run.out / "results.md.tmp").write_text(render(header(sha, run), rows))
    os.replace(run.out / "results.md.tmp", target)  # a run stopped part-way keeps the rows it finished


def stop(signum, frame):
    raise SystemExit(128 + signum)


def main(argv=None):
    args = parse(argv)
    handlers = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    tmp = None
    try:
        analyze, implement = step_argument(args.analyze, "--analyze"), step_argument(args.implement, "--implement")
        check_inputs(args, analyze, implement)
        tmp = Path(os.path.realpath(tempfile.mkdtemp(prefix="replay-specs-", dir=os.environ.get("TMPDIR") or None)))
        run, sha = prepare(args, analyze, implement, tmp)
        rows = []
        for index, arg in enumerate(s.strip() for s in args.specs.split(",") if s.strip()):
            rows.append(steps.replay_one(run, arg, index))
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
