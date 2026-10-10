"""A step run through the Aide commit's runner, and the replay of one spec from its copies to its table row."""
import json
import os
import re
import shutil
import signal
import subprocess
import time
from collections import namedtuple
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple, Optional

import copies
import judge
import landing
import measure
from copies import CannotReplay
from gitutil import git
from table import Row, Stats

class Step(NamedTuple):
    tool: str
    model: str
    effort: Optional[str]
StepRun = namedtuple("StepRun", "seconds result log stream")

# The time limits and permission mode the board's queue gives each step.
TIME_LIMITS = {"analyze": 2400, "implement": 5400}
PERMISSION_MODE = "bypassPermissions"
GRACE_SEC = 30


@dataclass
class Run:
    project: str
    code: str
    specs_root: str
    core: Path
    tmp: Path
    out: Path
    analyze: Step
    implement: Optional[Step]
    judge_model: str
    branch: str
    with_wiki: bool
    code_landing: str
    env: dict
    tool_env: dict


def end_group(proc):
    """End the runner and everything it started: they share the process group it leads."""
    for sig, wait in ((signal.SIGTERM, GRACE_SEC), (signal.SIGKILL, 30)):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            return
        try:
            proc.wait(timeout=wait)
        except subprocess.TimeoutExpired:
            continue
        try:  # the leader is gone; whatever it left behind goes too
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        return


def read_result(path, stdout):
    for text in (Path(path).read_text() if Path(path).exists() else "", *reversed(stdout.splitlines())):
        try:
            value = json.loads(text)
        except ValueError:
            continue
        if isinstance(value, dict):
            return value
    return None


def run_step(run, command, step, folder, project_dir, specs_root, out):
    """One runner call in its own process group, timed around the whole call. Nothing is pushed anywhere."""
    result_file, stream = out / f"{command}-result.json", out / f"{command}.stream"
    argv = ["bash", str(run.core / "scripts" / "aide-run-spec"), "--project-dir", project_dir, "--specs-root", specs_root,
            "--command", command, "--spec", folder, "--tool", step.tool, "--model", step.model,
            *(["--effort", step.effort] if step.effort else []),
            "--permission-mode", PERMISSION_MODE, "--timeout-sec", str(TIME_LIMITS[command]), "--push", "none",
            "--worktree-base", str(run.tmp / "worktrees"), "--result-file", str(result_file), "--stream-file", str(stream)]
    env = {**run.env, **run.tool_env[step.tool]}
    log = out / f"{command}.log"
    started, stdout = time.monotonic(), ""
    with open(log, "wb") as stderr:
        proc = subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=stderr,
                                start_new_session=True, text=True)
        try:
            stdout, _ = proc.communicate(timeout=TIME_LIMITS[command] + 600)
        except subprocess.TimeoutExpired:
            end_group(proc)
        except BaseException:
            end_group(proc)
            raise
    return StepRun(time.monotonic() - started, read_result(result_file, stdout), log, stream)


def stats_of(step, ran):
    """Time is the wall clock around the call; tokens are summed over the stream, else the result line's last turn."""
    tokens, last_turn = measure.step_tokens(ran.stream, step.tool), False
    if tokens is None:
        tokens = ((ran.result or {}).get("tokens") or {}).get("total")
        last_turn = tokens is not None
    return Stats(ran.seconds, tokens, (ran.result or {}).get("costUsd"), last_turn)


def ended(ran):
    return (ran.result or {}).get("terminalReason") or "with no result"


def find_archived(specs_root, arg):
    """The archived folder named by `arg`, a folder name or a number."""
    def named(base):
        names = sorted(p.name for p in base.iterdir() if p.is_dir() and (p.name == arg or (arg.isdigit() and p.name.startswith(f"{arg}-")))) \
            if base.is_dir() else []
        return names[0] if names else None
    root = Path(specs_root)
    folder = named(root / "archive")
    if folder:
        return folder, root / "archive" / folder
    raise CannotReplay("not archived" + (" yet" if named(root) else f": no spec {arg} found"))


def land_analyze(specs_repo, folder):
    """Merge the analyze branch into the specs copy's default branch, as the board does after an analyze."""
    branch = f"aide/{folder}"
    if not git(specs_repo, "rev-parse", "--verify", "--quiet", branch, check=False):
        raise CannotReplay("analyze left no branch to land")
    git(specs_repo, "checkout", "--quiet", "main")
    git(specs_repo, "merge", "--quiet", "--no-edit", branch)


def original_tests(run, folder, found, code_dir, work):
    """(passed, ran, files not run) of the test files the original landing added or changed, taken as they landed and
    run against the new implement's tip; None and why when that cannot be done."""
    files = measure.original_test_files(run.code, found.before, found.landed)
    if not files:
        return None, "the landing changed no test files"
    tip = git(code_dir, "rev-parse", "--verify", "--quiet", f"aide/{folder}", check=False)
    if not tip:
        return None, "implement left no branch to run the original tests against"
    tree = str(work / "measure")
    git(code_dir, "worktree", "add", "--quiet", "--detach", tree, tip)
    copies.link_worktree_paths(run.code, tree, manifest_dir=code_dir)
    python = Path(tree) / ".venv" / "bin" / "python"
    passed = ran = not_run = 0
    for rel in files:
        shown = subprocess.run(["git", "-C", run.code, "show", f"{found.landed}:{rel}"], capture_output=True)
        if shown.returncode != 0:
            not_run += 1
            continue
        (Path(tree) / rel).parent.mkdir(parents=True, exist_ok=True)
        (Path(tree) / rel).write_bytes(shown.stdout)
        counts = measure.run_test_file(tree, rel, python=str(python) if python.exists() else None)
        if counts is None:
            not_run += 1
        else:
            passed, ran = passed + counts[0], ran + counts[1]
    return (passed, ran, not_run), ""


def replay_steps(run, row, folder, archived, found, code_dir, specs_repo, specs_dir, work):
    out = run.out / folder
    description = (Path(archived) / "1-description.md").read_text()
    first = run_step(run, "analyze", run.analyze, folder, code_dir, specs_dir, out)
    row.analyze = stats_of(run.analyze, first)
    if ended(first) != "completed":
        row.notes += (f"analyze ended {ended(first)}",)
        return
    land_analyze(specs_repo, folder)
    plan = (Path(specs_dir) / folder / "3-solution.md").read_text()
    counts = measure.plan_review_counts(plan)
    row.must, row.should = counts.must, counts.should
    row.notes += (counts.note,) if counts.note else ()
    row.placed = measure.unplaced_criteria(description, plan)
    analysis = (Path(specs_dir) / folder / "2-analysis.md").read_text()
    row.files = measure.files_found(measure.files_to_change(analysis), measure.changed_files(run.code, found.before, found.landed))

    original = (Path(archived) / "3-solution.md").read_text()
    verdict = judge.ask(run.judge_model, description, original, plan, str(run.tmp))
    row.judge = verdict.score if verdict.score else "no score"
    row.reasons, row.judging = verdict.reasons, verdict.stats
    if not run.implement:
        return

    second = run_step(run, "implement", run.implement, folder, code_dir, specs_dir, out)
    row.implement = stats_of(run.implement, second)
    row.green = measure.implement_green(second.result or {})
    row.rounds = measure.implement_rounds(Path(second.log).read_text(errors="replace"))
    if ended(second) not in ("completed", "tests-red"):
        row.notes += (f"implement ended {ended(second)}",)
    row.original, why = original_tests(run, folder, found, code_dir, work)
    row.notes += (why,) if why else ()


def replay_one(run, arg, index):
    """Replay one spec in copies that are removed afterwards; whatever goes wrong ends up in the row."""
    number = re.match(r"\d+", arg)
    row = Row(spec=number.group() if number else arg, folder=arg)
    work = run.tmp / f"spec-{index}"
    try:
        folder, archived = find_archived(run.specs_root, arg)
        row.folder = folder
        state = json.loads((archived / "4-status.json").read_text()) if (archived / "4-status.json").exists() else {}
        if state.get("closed"):
            raise CannotReplay("closed")
        found = landing.find_landing(run.code, run.branch, folder, str(archived), run.code_landing)
        (run.out / folder).mkdir(parents=True, exist_ok=True)
        code_dir = copies.code_copy(run.code, re.sub("^origin/", "", run.branch), found.before, work / "code")
        specs_repo = work / "specs"
        began = git(run.code, "show", "-s", "--format=%cI", found.before) if run.with_wiki else None
        specs_dir = copies.specs_copy(archived, folder, run.project, specs_repo, run.core, run.specs_root, wiki_at=began)
        row.replayed = True
        replay_steps(run, row, folder, archived, found, code_dir, str(specs_repo), specs_dir, work)
    except (CannotReplay, landing.NoLanding) as error:
        row.notes += (f"stopped: {error}" if row.replayed else f"cannot be replayed: {error}",)
    except Exception as error:  # one spec's trouble ends that spec, never the run
        row.notes += (f"{'stopped' if row.replayed else 'cannot be replayed'}: {type(error).__name__}: {error}",)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return row
