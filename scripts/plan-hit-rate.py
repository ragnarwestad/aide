#!/usr/bin/env python3
"""How well a spec's plan named the files its implement changed.

For every spec of a project that the board's queue still holds an
implement for, the files `2-analysis.md` and `3-solution.md` name are set
against the files implement's own commits changed in the code repo:
recall is the share of changed files the plan named, precision the share
of named files that changed. Test files are counted apart, since a plan
says what to test more often than in which file.

Usage:
  scripts/plan-hit-rate.py [--project aide] [--from 488]
      [--code ~/.aide/dashboard/checkouts/<project>/code]
      [--specs ~/.aide/dashboard/checkouts/<project>/specs/<project>]
      [--queue ~/.aide/dashboard/aide-queue.json]
"""
import argparse
import collections
import json
import os
import re
import subprocess

# A path the plan names in backticks, with an optional `:line` after it;
# a script in core/scripts has no extension.
# `src/` and `test/` are the dashboard's own, written relative to it.
NAMED = re.compile(
    r"`((?:dashboard/|core/|tests/|scripts/|implementations/|docs/|\.claude/|\.aide/|\.github/|src/|test/)"
    r"[A-Za-z0-9_./-]+)(?::[0-9,-]+)?`"
)


def named_files(text):
    """The repo paths a plan's text names."""
    return {
        ("dashboard/" + p) if p.startswith(("src/", "test/")) else p
        for p in NAMED.findall(text)
        if not p.endswith("/")  # a directory names no file
    }


def is_test(path):
    return "/test/" in path or path.startswith("tests/") or ".test." in path


def compare(changed, named):
    """Counts and shares for one spec; a share is None when it has nothing to divide by."""
    both = changed & named
    return {
        "changed": len(changed),
        "named": len(named),
        "both": len(both),
        "recall": len(both) / len(changed) if changed else None,
        "precision": len(both) / len(named) if named else None,
        "missed": sorted(changed - named),
    }


def implement_changes(queue_path, project, code):
    """The files each spec's implement commits changed, by spec folder."""
    raw = json.load(open(queue_path))
    jobs = raw.get("jobs", raw) if isinstance(raw, dict) else raw
    changed = collections.defaultdict(set)
    for job in jobs:
        if job.get("project") != project:
            continue
        for result in job.get("results", []):
            if result.get("step") != "implement":
                continue
            for repo in result.get("repos") or []:
                before, after = repo.get("headBefore"), repo.get("headAfter")
                if not repo.get("root", "").endswith("/code") or not before or not after:
                    continue
                out = subprocess.run(
                    ["git", "-C", code, "log", "--first-parent", "--no-merges", "--name-only", "--format=", f"{before}..{after}"],
                    capture_output=True, text=True,
                )
                if out.returncode == 0:
                    changed[job["specFolder"]] |= {f for f in out.stdout.split() if f}
    return changed


def plan_text(specs, folder):
    for base in (os.path.join(specs, folder), os.path.join(specs, "archive", folder)):
        if os.path.isdir(base):
            return "".join(
                open(os.path.join(base, n)).read()
                for n in ("2-analysis.md", "3-solution.md")
                if os.path.exists(os.path.join(base, n))
            )
    return None


def main():
    home = os.path.expanduser("~")
    ap = argparse.ArgumentParser(description="How well a spec's plan named the files its implement changed.")
    ap.add_argument("--project", default="aide")
    ap.add_argument("--from", dest="first", type=int, default=0, help="the lowest spec number counted")
    ap.add_argument("--code")
    ap.add_argument("--specs")
    ap.add_argument("--queue", default=os.path.join(home, ".aide/dashboard/aide-queue.json"))
    a = ap.parse_args()
    code = a.code or os.path.join(home, f".aide/dashboard/checkouts/{a.project}/code")
    specs = a.specs or os.path.join(home, f".aide/dashboard/checkouts/{a.project}/specs/{a.project}")

    totals = collections.defaultdict(lambda: [0, 0, 0])
    print(f"{'spec':6}{'files':6}{'changed':>8}{'named':>7}{'both':>6}{'recall':>8}{'precision':>10}")
    for folder, changed in sorted(implement_changes(a.queue, a.project, code).items()):
        number = int(folder.split("-")[0]) if folder.split("-")[0].isdigit() else -1
        text = plan_text(specs, folder)
        if number < a.first or text is None or not changed:
            continue
        named = named_files(text)
        for kind, c, n in (("all", changed, named), ("code", {f for f in changed if not is_test(f)}, {f for f in named if not is_test(f)})):
            r = compare(c, n)
            share = lambda x: f"{x:.0%}" if x is not None else "-"
            print(f"{folder.split('-')[0]:6}{kind:6}{r['changed']:8}{r['named']:7}{r['both']:6}{share(r['recall']):>8}{share(r['precision']):>10}")
            t = totals[kind]
            t[0] += r["changed"]; t[1] += r["named"]; t[2] += r["both"]
    for kind, (c, n, b) in totals.items():
        if c and n:
            print(f"total {kind}: changed {c}, named {n}, both {b}: recall {b / c:.0%}, precision {b / n:.0%}")


if __name__ == "__main__":
    main()
