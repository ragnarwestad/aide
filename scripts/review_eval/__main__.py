#!/usr/bin/env python3
"""Measure implement's review, and the verification of what it finds, against implement commits with known defects.

cases.json holds implement commits whose review on the board found nothing, and every finding a later review made
on them, each labelled real, false or unclear by reading the code at the commit. Both commands give a model the very
prompt the runner sends (core/scripts/lib/run-spec/turn/review-prompts.sh), in a detached worktree of the commit, with
the spec's description as it was when the commit was made.

  review  runs the review on every case, then has a Claude judge match each finding to a labelled one. It reports
          how many real defects were found, how many false and unclear ones reported, and lists the new ones, which
          need a verdict before they go into cases.json.
  verify  gives each case's labelled findings to the verification, and reports how many real ones it kept and how
          many false ones it dropped.

planted.json holds planted cases, each a commit with one described defect added by its patch, and clean cases,
commits promised to have none (planted.py).

  check   calls no model: every case's commit, patch and description can be found and its patch applies.
  planted runs the review, the verification of its findings and, for a planted case, the judge on every case, and
          writes results.json and results.md: per case whether the planted defect was found and kept, or how many
          false findings were raised and kept.
  compare reads two planted runs' results.json and writes the difference to comparison.md in the second (compare.py).

Run by hand, like scripts/replay_specs; it is no part of any test suite and does not run on the board. The sessions
read the worktree with bypassPermissions (Claude, with the edit tools taken away) or read-only (Codex).

Usage:
  export CLAUDE_CODE_OAUTH_TOKEN=...   # a Claude review or verification, or the judge
  python3 scripts/review_eval review --tool codex --model gpt-6.1-sol [--specs 637,640] [--judge sonnet]
  python3 scripts/review_eval verify --tool claude --model opus [--specs 645]
  python3 scripts/review_eval check
  python3 scripts/review_eval planted --tool codex --model gpt-6.1-sol [--verify-tool claude --verify-model opus]
      [--cases 641-planted,636-clean]
  python3 scripts/review_eval compare <run folder A> <run folder B>
      [--code ~/develop/aide] [--specs-repo ~/develop/aide-specs] [--project aide] [--results ~/.aide/review-eval]
"""
import argparse
import concurrent.futures
import datetime
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import compare
import planted
import replies

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parents[1] / "core" / "scripts"
HEADLESS = ("(This run is headless: no one is at a keyboard and no question can be answered. Never stop to ask for "
            "confirmation — decide, or write down what you would have asked, and finish.)")
ANSWER_AND_FINDINGS = """{{"1": "<id>", "2": "new"}}

<known>
{known}
</known>

<new>
{new}
</new>
"""
MATCH_PROMPT = """A code review of one commit reported the findings under <new>. The findings under <known> were reported
on the same commit earlier, each with an id. For each new finding, say which known finding describes the same defect:
the same wrong behaviour, even when the wording, the line or the example differs. A new finding that describes no
known one is "new". Answer with one JSON object and nothing else, mapping each new finding's number to an id or "new":
""" + ANSWER_AND_FINDINGS
PLANTED_MATCH_PROMPT = """A code review of one commit reported the findings under <new>. The commit is known to have the defect
under <known>, with its id. For each new finding, say whether it describes that defect: the same wrong behaviour, even
when the wording, the line or the example differs. A new finding that does not is "new". Answer with one JSON object
and nothing else, mapping each new finding's number to the id or "new":
""" + ANSWER_AND_FINDINGS


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout.strip()


def description_at(specs_repo, project, spec, commit_time):
    """The spec's 1-description.md as the specs repository had it when the implement commit was made."""
    pattern = [f"{project}/{spec}-*/1-description.md", f"{project}/archive/{spec}-*/1-description.md"]
    rev = git(specs_repo, "log", "--all", "-1", "--format=%H", f"--before=@{commit_time}", "--", *pattern)
    paths = [p for p in git(specs_repo, "ls-tree", "-r", "--name-only", rev).splitlines()
             if p.endswith("/1-description.md") and p.split("/")[-2].startswith(f"{spec}-")]
    return git(specs_repo, "show", f"{rev}:{paths[0]}")


def prompt(function, *args):
    """A prompt from review-prompts.sh, built by bash as the runner builds it."""
    script = (f'source "$1/_aide-spec-lib.sh"; source "$1/lib/spec-reference.sh"; '
              f'source "$1/lib/run-spec/turn/review-prompts.sh"; {function} "${{@:2}}"')
    return subprocess.run(["bash", "-c", script, "bash", str(SCRIPTS), *args], capture_output=True, text=True, check=True).stdout


def turn(tool, model, text, cwd, out):
    """One session in `cwd`; its reply, also written to `out`.txt with the raw output beside it."""
    if tool == "codex":
        ran = subprocess.run(["codex", "exec", "-m", model, "-s", "read-only", "-C", str(cwd), "--skip-git-repo-check",
                              "--json", "-o", f"{out}.txt", text], stdin=subprocess.DEVNULL, capture_output=True, text=True)
        Path(f"{out}.jsonl").write_text(ran.stdout)
        reply = Path(f"{out}.txt").read_text() if Path(f"{out}.txt").exists() else ""
    else:
        ran = subprocess.run(["claude", "-p", "--model", model, "--output-format", "json", "--permission-mode",
                              "bypassPermissions", "--disallowedTools", "Edit", "Write", "NotebookEdit"],
                             input=text, cwd=cwd, capture_output=True, text=True)
        Path(f"{out}.json").write_text(ran.stdout)
        try:
            reply = json.loads(ran.stdout).get("result") or ""
        except ValueError:
            reply = ""
        Path(f"{out}.txt").write_text(reply)
    if ran.stderr:
        Path(f"{out}.err").write_text(ran.stderr)
    return reply


WORKTREES = threading.Lock()


def worktree(code, *args):
    """git worktree, one at a time in this process, and tried again while another run holds the repository's lock."""
    with WORKTREES:
        for attempt in range(10):
            try:
                return git(code, "worktree", *args)
            except subprocess.CalledProcessError:
                if attempt == 9:
                    raise
                time.sleep(3)


class Case:
    def __init__(self, args, case, scratch):
        self.args, self.spec, self.commit = args, case["spec"], case["commit"]
        self.out = Path(args.out) / case.get("id", self.spec)
        self.out.mkdir(parents=True, exist_ok=True)
        self.tree = Path(scratch) / case.get("id", self.spec)
        self.fork = git(args.code, "rev-parse", f"{self.commit}^")
        when = git(args.code, "log", "-1", "--format=%ct", self.commit)
        self.description = self.out / "1-description.md"
        self.description.write_text(description_at(args.specs_repo, args.project, self.spec, when) + "\n")

    def __enter__(self):
        worktree(self.args.code, "add", "-q", "--detach", str(self.tree), self.commit)
        return self

    def __exit__(self, *_):
        worktree(self.args.code, "remove", "--force", str(self.tree))


def review_one(args, case, labelled, scratch):
    with Case(args, case, scratch) as c:
        text = prompt("review_prompt", str(c.description), c.fork, "main", "", HEADLESS)
        (c.out / "prompt-review").write_text(text)
        defects = replies.review_defects(turn(args.tool, args.model, text, c.tree, c.out / "review"))
    if defects is None:
        return c.spec, None, [], []
    known = [f for f in labelled if f["spec"] == c.spec]
    matched = ["new"] * len(defects)
    if defects and known:
        ask = MATCH_PROMPT.format(known="\n".join(f"{f['id']}: {f['text']}" for f in known), new=replies.numbered(defects))
        with tempfile.TemporaryDirectory() as empty:
            answer = turn("claude", args.judge, ask, empty, c.out / "match")
        matched = list(replies.matches(answer, len(defects), {f["id"] for f in known}).values())
    return c.spec, defects, matched, known


def verify_one(args, case, labelled, scratch):
    known = [f for f in labelled if f["spec"] == case["spec"]]
    if not known:
        return case["spec"], {}
    with Case(args, case, scratch) as c:
        text = prompt("verify_prompt", str(c.description), c.fork, "main", replies.numbered([f["text"] for f in known]), HEADLESS)
        (c.out / "prompt-verify").write_text(text)
        decided = replies.decisions(turn(args.tool, args.model, text, c.tree, c.out / "verify"), len(known))
    return c.spec, {f["id"]: decided[n] for n, f in enumerate(known, 1)}


def run_all(args, work):
    data = json.loads((HERE / "cases.json").read_text())
    cases = [c for c in data["cases"] if not args.specs or c["spec"] in args.specs.split(",")]
    with tempfile.TemporaryDirectory() as scratch, concurrent.futures.ThreadPoolExecutor(args.jobs) as pool:
        return data["findings"], list(pool.map(lambda c: work(args, c, data["findings"], scratch), cases))


def report_review(args, labelled, results):
    lines, total = [], {}
    for spec, defects, matched, known in results:
        if defects is None:
            lines.append(f"- {spec}: the reply has no review: line")
            continue
        score = replies.review_score(known, matched)
        for key, value in score.items():
            total[key] = total.get(key, 0) + value
        lines += [f"- {spec}: {n}. [{m}] {d}" for n, (d, m) in enumerate(zip(defects, matched), 1)]
    head = (f"Review {args.tool} {args.model}: {total.get('real found', 0)} of {total.get('real', 0)} real defects found, "
            f"{total.get('false reported', 0)} false and {total.get('unclear reported', 0)} unclear reported, "
            f"{total.get('new', 0)} new to check.")
    return head, lines


def report_verify(args, labelled, results):
    by_id = {f["id"]: f for f in labelled}
    decided = {fid: d for _, found in results for fid, d in found.items()}
    score = replies.verify_score([by_id[i] for i in decided], decided)
    head = (f"Verify {args.tool} {args.model}: kept {score['real kept']} of {score['real']} real, dropped "
            f"{score['false dropped']} of {score['false']} false, kept {score['unclear kept']} of {score['unclear']} unclear.")
    lines = [f"- {by_id[i]['verdict']:7} {d[0]:4} {i}" + (f": {d[1]}" if d[1] else "") for i, d in sorted(decided.items())]
    return head, lines


def planted_one(args, case, scratch):
    with Case(args, case, scratch) as c:
        def ask(role, text):
            (c.out / f"prompt-{role}").write_text(text)
            if role == "judge":
                with tempfile.TemporaryDirectory() as empty:
                    return turn("claude", args.judge, text, empty, c.out / role)
            tool, model = (args.tool, args.model) if role == "review" else (args.verify_tool, args.verify_model)
            return turn(tool, model, text, c.tree, c.out / role)

        outcome = planted.run_case(case, c.tree, c.fork, c.description, HERE, HEADLESS, PLANTED_MATCH_PROMPT,
                                   build=prompt, ask=ask)
    return {**outcome, "sha256": planted.digest(case)}


def run_planted(args):
    cases = [c for c in planted.load_cases() if not args.cases or c["id"] in args.cases.split(",")]
    with tempfile.TemporaryDirectory() as scratch, concurrent.futures.ThreadPoolExecutor(args.jobs) as pool:
        outcomes = list(pool.map(lambda c: planted_one(args, c, scratch), cases))
    setup = {"tool": args.tool, "model": args.model, "verify tool": args.verify_tool,
             "verify model": args.verify_model, "judge": args.judge, "aide commit": git(HERE, "rev-parse", "HEAD")}
    return planted.write_results(args.out, setup, outcomes)


def check(args):
    """Every planted and clean case ready to run, with no model: 0 when all are."""
    ready = True
    for case in planted.load_cases():
        problems = planted.structure_problems(case)
        try:
            git(args.code, "cat-file", "-e", f"{case['commit']}^{{commit}}")
        except subprocess.CalledProcessError:
            problems.append(f"the commit {case['commit']} is not in {args.code}")
        else:
            if case.get("kind") == "planted" and not problems:
                why = planted.patch_applies(args.code, case["commit"], HERE / case["patch"])
                problems += [why] if why else []
            when = git(args.code, "log", "-1", "--format=%ct", case["commit"])
            try:
                description_at(args.specs_repo, args.project, case["spec"], when)
            except (subprocess.CalledProcessError, IndexError):
                problems.append(f"no description of spec {case['spec']} in {args.specs_repo}")
        ready = ready and not problems
        print(f"{case.get('id')}: " + ("ready" if not problems else "; ".join(problems)))
    return 0 if ready else 1


def main(argv):
    home = os.path.expanduser("~")
    ap = argparse.ArgumentParser(description="Measure implement's review and its verification against known defects.")
    ap.add_argument("command", choices=("review", "verify", "check", "planted", "compare"))
    ap.add_argument("runs", nargs="*", help="compare: the folders of run A and run B")
    ap.add_argument("--tool", choices=("claude", "codex"))
    ap.add_argument("--model")
    ap.add_argument("--verify-tool", choices=("claude", "codex"), help="planted: the verification's tool; --tool when left out")
    ap.add_argument("--verify-model", help="planted: the verification's model; --model when left out")
    ap.add_argument("--specs", help="comma-separated spec numbers; all cases when left out")
    ap.add_argument("--cases", help="planted: comma-separated case ids; all cases when left out")
    ap.add_argument("--judge", default="sonnet", help="the Claude model that matches a review's findings to the labelled ones")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--project", default="aide")
    ap.add_argument("--code", default=str(HERE.parents[1]))
    ap.add_argument("--specs-repo", default=os.path.join(home, "develop", "aide-specs"))
    ap.add_argument("--results", default=os.path.join(home, ".aide", "review-eval"))
    args = ap.parse_args(argv)
    if args.command == "check":
        return check(args)
    if args.command == "compare":
        if len(args.runs) != 2:
            ap.error("compare takes two run folders")
        print(compare.main(*args.runs), end="")
        print(f"Comparison: {args.runs[1]}/comparison.md")
        return 0
    if not args.tool or not args.model:
        ap.error(f"{args.command} needs --tool and --model")
    args.verify_tool = args.verify_tool or args.tool
    args.verify_model = args.verify_model or args.model
    args.out = os.path.join(args.results, f"{datetime.datetime.now():%Y%m%d-%H%M}-{args.command}-{args.tool}-{args.model}")
    if args.command == "planted":
        head = run_planted(args)
        print(head)
        print(f"Results: {args.out}/results.md")
        return 0
    work, report = (review_one, report_review) if args.command == "review" else (verify_one, report_verify)
    labelled, results = run_all(args, work)
    head, lines = report(args, labelled, results)
    Path(args.out, "results.md").write_text("\n".join([head, "", *lines]) + "\n")
    print(head)
    print(f"Results: {args.out}/results.md")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
