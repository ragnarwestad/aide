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

Run by hand, like scripts/replay_specs; it is no part of any test suite and does not run on the board. The sessions
read the worktree with bypassPermissions (Claude, with the edit tools taken away) or read-only (Codex).

Usage:
  export CLAUDE_CODE_OAUTH_TOKEN=...   # a Claude review or verification, or the judge
  python3 scripts/review_eval review --tool codex --model gpt-6.1-sol [--specs 637,640] [--judge sonnet]
  python3 scripts/review_eval verify --tool claude --model opus [--specs 645]
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
from pathlib import Path

import replies

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parents[1] / "core" / "scripts"
HEADLESS = ("(This run is headless: no one is at a keyboard and no question can be answered. Never stop to ask for "
            "confirmation — decide, or write down what you would have asked, and finish.)")
MATCH_PROMPT = """A code review of one commit reported the findings under <new>. The findings under <known> were reported
on the same commit earlier, each with an id. For each new finding, say which known finding describes the same defect:
the same wrong behaviour, even when the wording, the line or the example differs. A new finding that describes no
known one is "new". Answer with one JSON object and nothing else, mapping each new finding's number to an id or "new":
{{"1": "<id>", "2": "new"}}

<known>
{known}
</known>

<new>
{new}
</new>
"""


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
    script = f'source "$1/_aide-spec-lib.sh"; source "$1/lib/run-spec/turn/review-prompts.sh"; {function} "${{@:2}}"'
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


class Case:
    def __init__(self, args, case, scratch):
        self.args, self.spec, self.commit = args, case["spec"], case["commit"]
        self.out = Path(args.out) / self.spec
        self.out.mkdir(parents=True, exist_ok=True)
        self.tree = Path(scratch) / self.spec
        self.fork = git(args.code, "rev-parse", f"{self.commit}^")
        when = git(args.code, "log", "-1", "--format=%ct", self.commit)
        self.description = self.out / "1-description.md"
        self.description.write_text(description_at(args.specs_repo, args.project, self.spec, when) + "\n")

    def __enter__(self):
        git(self.args.code, "worktree", "add", "-q", "--detach", str(self.tree), self.commit)
        return self

    def __exit__(self, *_):
        git(self.args.code, "worktree", "remove", "--force", str(self.tree))


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


def main(argv):
    home = os.path.expanduser("~")
    ap = argparse.ArgumentParser(description="Measure implement's review and its verification against known defects.")
    ap.add_argument("command", choices=("review", "verify"))
    ap.add_argument("--tool", choices=("claude", "codex"), required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--specs", help="comma-separated spec numbers; all cases when left out")
    ap.add_argument("--judge", default="sonnet", help="the Claude model that matches a review's findings to the labelled ones")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--project", default="aide")
    ap.add_argument("--code", default=str(HERE.parents[1]))
    ap.add_argument("--specs-repo", default=os.path.join(home, "develop", "aide-specs"))
    ap.add_argument("--results", default=os.path.join(home, ".aide", "review-eval"))
    args = ap.parse_args(argv)
    args.out = os.path.join(args.results, f"{datetime.datetime.now():%Y%m%d-%H%M}-{args.command}-{args.tool}-{args.model}")
    work, report = (review_one, report_review) if args.command == "review" else (verify_one, report_verify)
    labelled, results = run_all(args, work)
    head, lines = report(args, labelled, results)
    Path(args.out, "results.md").write_text("\n".join([head, "", *lines]) + "\n")
    print(head)
    print(f"Results: {args.out}/results.md")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
