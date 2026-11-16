#!/usr/bin/env python3
"""Measure how good the analysis and the plan that analyze writes are, against expected assessments a person approved.

Each case in scripts/plan_eval/cases/ is an archived spec with an expected assessment: the requirements a good
analysis and plan cover, the code and interactions they find, the tests they need, and the serious omissions that
fail them, each with its evidence in the description or the code at the pinned commit. `run` runs analyze on each
case in replay's historical copies, with the Aide commit, tool, model and advisor given, and has a judge score the
analysis and the plan on their own turns against an anchored rubric: requirements coverage, affected code and
interactions, test adequacy, soundness and simplicity, each with a reason and evidence. A serious omission missed
fails the document whatever its scores. `compare` sets a baseline run against one alternative.

  check    reads every case, checks its pinned commits against the spec's landing and its description's hash
           against the archive, and says per case: ready, not approved, or what is wrong. No model is called.
  run      refuses until every selected case is approved and consistent, then generates and judges each case
           --repeat times, and writes run.json, results.json, results.md and every log, prompt and reply.
  compare  writes comparison.md into the alternative's run folder; refused unless the two runs share their cases,
           pinned commits, rubric, judge and repeat count and differ in exactly one of the Aide commit, the analyze
           step and the advisor.

Nothing is written to the board's queue, to the real repositories or to any origin; the copies are removed when the
run ends. The command is run by hand, never by a test suite or the board. A run uses the account's usage: check the
board's queue first.

Usage:
  python3 scripts/plan_eval check [--cases 640,647,653]
  export CLAUDE_CODE_OAUTH_TOKEN=...   # once: `claude setup-token`; needed for a claude analyze step only
  python3 scripts/plan_eval run --aide-commit <sha> --analyze claude opus high [--advisor opus] \\
      [--judge claude opus | --judge codex gpt-6.1-sol] [--repeat 3] [--cases 640,647,653]
      [--cases-dir scripts/plan_eval/cases] [--project aide] [--code ~/.aide/dashboard/checkouts/<project>/code]
      [--specs-root ~/.aide/dashboard/checkouts/<project>/specs/<project>] [--aide-repo <this repository>]
      [--results ~/.aide/plan-eval]
  python3 scripts/plan_eval compare <baseline run folder> <alternative run folder>

A skill or prompt change is a different --aide-commit (a local commit with the change), a model change a different
--analyze. The judge uses your own Claude or Codex login; no API key is read.
"""
import argparse
import json
import os
import shutil
import signal
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "replay_specs"))  # replay's modules import each other by plain name

import cases  # noqa: E402
import copies  # noqa: E402
import judging  # noqa: E402
import report  # noqa: E402
import rubric  # noqa: E402
import run_setup  # noqa: E402
from copies import Refusal  # noqa: E402
from generate import generate  # noqa: E402
from gitutil import git  # noqa: E402

MAX_REPEAT = 5


def parse(argv):
    home = os.path.expanduser("~")
    ap = argparse.ArgumentParser(description="Measure analyze's analysis and plan against approved expected assessments.")
    commands = ap.add_subparsers(dest="command", required=True)
    for name in ("check", "run"):
        sub = commands.add_parser(name)
        sub.add_argument("--cases", help="comma-separated case numbers; every case in the folder when left out")
        sub.add_argument("--cases-dir", default=str(HERE / "cases"))
        sub.add_argument("--project", default="aide")
        sub.add_argument("--code")
        sub.add_argument("--specs-root")
        if name == "run":
            sub.add_argument("--aide-commit", required=True)
            sub.add_argument("--analyze", nargs="+", required=True, metavar="TOOL MODEL [EFFORT]")
            sub.add_argument("--advisor", help="the model every claude step consults as its advisor")
            sub.add_argument("--judge", nargs="+", default=["claude", "opus"], metavar="TOOL MODEL [EFFORT]")
            sub.add_argument("--repeat", type=int, default=1, help=f"how many times each case is generated, 1 to {MAX_REPEAT}")
            sub.add_argument("--aide-repo", default=str(HERE.parents[1]))
            sub.add_argument("--results", default=os.path.join(home, ".aide", "plan-eval"))
    compare = commands.add_parser("compare")
    compare.add_argument("baseline")
    compare.add_argument("alternative")
    args = ap.parse_args(argv)
    if args.command in ("check", "run"):
        checkouts = os.path.join(home, ".aide", "dashboard", "checkouts", args.project)
        args.code = args.code or os.path.join(checkouts, "code")
        args.specs_root = args.specs_root or os.path.join(checkouts, "specs", args.project)
    return args


def numbers(args):
    return [n.strip() for n in args.cases.split(",") if n.strip()] if args.cases else None


def landing_of(code):
    return copies.default_branch(code), "pr" if copies.manifest_value(code, "codeLanding") == "pr" else "merge"


def check(args):
    paths = cases.selected(args.cases_dir, numbers(args))
    if not paths:
        print(f"no case in {args.cases_dir}")
        return 1
    branch, code_landing = landing_of(args.code)
    status = 0
    for path in paths:
        try:
            case = cases.load(path)
        except (OSError, cases.CaseError) as error:
            print(f"{path.stem}: {error}")
            status = 1
            continue
        problems = cases.consistent(case, args.code, args.specs_root, branch, code_landing)
        if problems:
            status = 1
            print(f"{case.number}: " + "; ".join(problems))
        else:
            print(f"{case.number}: {'ready, approved ' + case.approved if case.approved else 'not approved'}")
    return status


def evaluator_commit():
    """The commit this command runs from, marked when its working tree differs from it."""
    head = git(str(HERE.parents[1]), "rev-parse", "HEAD", check=False) or "unknown"
    changed = git(str(HERE.parents[1]), "status", "--porcelain", "--", "scripts/plan_eval", "scripts/replay_specs", check=False)
    return head + ("+uncommitted" if changed else "")


def approved_cases(args):
    """Every selected case, read; Refusal for a malformed or unapproved one."""
    paths = cases.selected(args.cases_dir, numbers(args))
    if not paths:
        raise Refusal(f"there is no case in {args.cases_dir}")
    selected = []
    for path in paths:
        try:
            case = cases.load(path)
        except OSError as error:
            raise Refusal(f"the case {path} cannot be read: {error}") from None
        except cases.CaseError as error:
            raise Refusal(str(error)) from None
        if not case.approved:
            raise Refusal(f"{path} reads `Approved: no`: a person reads and approves the expected assessment, setting "
                          "the line to the date, before it is run")
        selected.append(case)
    return selected


def setup_identity(sha, args, analyze, judge, selected):
    return {
        "project": args.project, "aide_commit": sha, "analyze": analyze._asdict(), "advisor": args.advisor,
        "judge": judge._asdict(), "rubric": rubric.IDENTITY, "repeat": args.repeat, "evaluator": evaluator_commit(),
        "cases": {c.number: {"file_sha256": c.sha256, "description_sha256": c.description_sha256, "before": c.before,
                             "landed": c.landed} for c in selected},
    }


def write_json(path, value):
    Path(f"{path}.tmp").write_text(json.dumps(value, indent=1) + "\n")
    os.replace(f"{path}.tmp", path)


def write_results(out, identity, records):
    """Rewritten after every attempt, so a run stopped part-way keeps what it finished."""
    write_json(out / "results.json", records)
    (out / "results.md.tmp").write_text(report.render_run(identity, records))
    os.replace(out / "results.md.tmp", out / "results.md")


def stats_dict(stats):
    return stats._asdict() if stats else None


def judge_document(run, judge, case, generation, document, out):
    ids = [item.id for item in case.omissions(document)]
    text = rubric.prompt(document, generation.description, case, generation.original.get(document), generation.new[document])
    reply = judging.ask(judge, text, run.tmp, out / f"judge-{document}")
    if reply.problem:
        return {"outcome": "no result", "why": reply.problem, "mean": None, "dimensions": {}, "omissions": {},
                "judge": stats_dict(reply.stats)}
    verdict = rubric.judge(reply.text, ids)
    judgment = verdict.judgment
    return {
        "outcome": verdict.outcome, "why": verdict.why, "mean": verdict.mean,
        "dimensions": {d: {"score": v.score, "reason": v.reason, "evidence": list(v.evidence)}
                       for d, v in (judgment.dimensions.items() if judgment else ())},
        "omissions": {oid: o._asdict() for oid, o in (judgment.omissions.items() if judgment else ())},
        "judge": stats_dict(reply.stats),
    }


def run_command(args):
    selected = approved_cases(args)
    if not 1 <= args.repeat <= MAX_REPEAT:
        raise Refusal(f"--repeat is how many times each case is generated, from 1 to {MAX_REPEAT}")
    judge = judging.judge_argument(args.judge)
    analyze = run_setup.step_argument(args.analyze, "--analyze")
    setup = argparse.Namespace(**{**vars(args), "judge": judge.model, "preflight": None})  # what run_setup reads
    run_setup.check_inputs(setup, analyze, None)
    branch, code_landing = landing_of(args.code)
    for case in selected:
        problems = cases.consistent(case, args.code, args.specs_root, branch, code_landing)
        if problems:
            raise Refusal(f"the case {case.path} does not match the archive: {'; '.join(problems)}")
    tmp = Path(os.path.realpath(tempfile.mkdtemp(prefix="plan-eval-", dir=os.environ.get("TMPDIR") or None)))
    try:
        run, sha = run_setup.prepare(setup, analyze, None, tmp)
        identity = setup_identity(sha, args, analyze, judge, selected)
        write_json(run.out / "run.json", identity)
        records = []
        for index, (case, k) in enumerate((c, k) for c in selected for k in range(1, args.repeat + 1)):
            out = run.out / case.number / f"run-{k}"
            generation = generate(run, case, out, tmp / f"case-{index}")
            record = {"case": case.number, "attempt": k, "generation": stats_dict(generation.stats),
                      "problem": generation.problem, "documents": {}}
            if not generation.problem:
                for document in report.DOCUMENTS:
                    record["documents"][document] = judge_document(run, judge, case, generation, document, out)
            records.append(record)
            write_results(run.out, identity, records)
        print(run.out / "results.md")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def read_run(folder):
    folder = Path(folder)
    try:
        return {"identity": json.loads((folder / "run.json").read_text()),
                "records": json.loads((folder / "results.json").read_text())}
    except (OSError, ValueError) as error:
        raise Refusal(f"{folder} holds no run.json and results.json to compare: {error}") from None


def compare_command(args):
    base, alt = read_run(args.baseline), read_run(args.alternative)
    refusal, _ = report.comparable(base["identity"], alt["identity"])
    if refusal:
        raise Refusal(refusal)
    target = Path(args.alternative) / "comparison.md"
    target.write_text(report.render_comparison(base, alt))
    print(target)
    return 0


def stop(signum, _frame):
    raise SystemExit(128 + signum)


def main(argv=None):
    args = parse(argv)
    handlers = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        if args.command == "check":
            return check(args)
        if args.command == "run":
            return run_command(args)
        return compare_command(args)
    except Refusal as error:
        print(f"plan_eval: {error}", file=sys.stderr)
        return 2
    finally:
        for number, handler in handlers.items():
            signal.signal(number, handler)


if __name__ == "__main__":
    sys.exit(main())
