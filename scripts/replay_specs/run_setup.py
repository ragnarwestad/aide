"""What a run on archived specs refuses before anything is copied, and the setup it then works in: the Aide commit's
export, each tool's configuration folder, an environment that reports to no board, and the stamped results folder.
Shared by every command that runs steps in replay's copies."""
import argparse
import datetime
import os
from pathlib import Path
from typing import Optional

import copies
import steps
from copies import Refusal
from gitutil import git

TOOLS = ("claude", "codex", "opencode", "fake-claude")


def step_argument(values, option):
    if not 2 <= len(values) <= 3 or values[0] not in TOOLS:
        raise Refusal(f"{option} takes TOOL MODEL [EFFORT], the tool one of {', '.join(TOOLS)}")
    return steps.Step(values[0], values[1], values[2] if len(values) == 3 else None)


def inside(path, repo):
    path, repo = os.path.realpath(path), os.path.realpath(repo)
    return path == repo or path.startswith(repo + os.sep)


def check_inputs(args: argparse.Namespace, analyze: Optional[steps.Step], implement: Optional[steps.Step]) -> None:
    """Everything that can be refused before anything is copied."""
    if "claude" in {s.tool for s in (analyze, implement) if s} and not (os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") or os.environ.get("ANTHROPIC_API_KEY")):
        raise Refusal("a step names claude, and a fresh Claude config folder has no login: run `claude setup-token` once and "
                      "export CLAUDE_CODE_OAUTH_TOKEN (or set ANTHROPIC_API_KEY)")
    if args.advisor and "claude" not in {s.tool for s in (analyze, implement) if s}:
        raise Refusal("--advisor is set for claude steps, and no step names claude")
    for what, path in (("code checkout", args.code), ("specs root", args.specs_root), ("Aide repository", args.aide_repo)):
        if not os.path.isdir(path):
            raise Refusal(f"the {what} {path} does not exist")
    for what, path in (("code", args.code), ("specs", args.specs_root), ("Aide", args.aide_repo)):
        top = git(path, "rev-parse", "--show-toplevel", check=False)
        if top and inside(args.results, top):
            raise Refusal(f"the results folder {args.results} lies inside the {what} repository {top}")


def prepare(args: argparse.Namespace, analyze: Optional[steps.Step], implement: Optional[steps.Step], tmp: Path):
    """The export, the tools' configuration folders and the run's folders; Refusal when the commit cannot be replayed with."""
    core, sha = copies.export_aide(args.aide_repo, args.aide_commit, tmp)
    home, configured = os.path.expanduser("~"), {}
    for tool in {s.tool for s in (analyze, implement) if s}:
        key = "claude" if tool == "fake-claude" else tool
        configured[tool] = configured[key] if key in configured else copies.tool_environment(core, tool, tmp / "tools", home, args.advisor)
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
                     tmp=tmp, out=out, analyze=analyze, implement=implement, judge_model=args.judge, advisor=args.advisor, branch=branch,
                     code_landing="pr" if copies.manifest_value(args.code, "codeLanding") == "pr" else "merge",
                     env=env, tool_env=configured, preflight=args.preflight), sha
