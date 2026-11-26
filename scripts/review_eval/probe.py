"""The prompt of a session that tries to break each acceptance criterion by running the real code, and the session
itself: it may write and run scratch tests in the commit's worktree, which the review may not."""
import json
import subprocess
from pathlib import Path

# How long one session may run before it is stopped and counted as not measured.
LIMIT_SEC = 40 * 60

PROMPT = """Read this spec's own description, and everything this spec's branch changed. For each acceptance criterion
in the description (AC-1, AC-2, ...), try to break it by running the real code. Reading the code is how you choose what
to run, never the evidence itself.

For each criterion:

1. Say in one sentence what it promises, and what the promise ranges over: one case; every input of some kind (a text,
   a path, a list, a number, a file's content, a setting's value); every combination of states or settings; or every
   order in which events can arrive.
2. Find the tests the branch gave it (their names carry its id) and name the cases they try.
3. Run cases those tests do not try, against the code the branch changed: call the real functions, routes or scripts.
   Never test a copy or a model of them. Where the promise ranges over inputs, generate them rather than picking one:
   empty, one, many; the shortest and a very long one; the boundary a limit in the code sits at, one under and one
   over; unusual characters, comments and whitespace; a form that is accepted but not normalised; items repeated,
   interleaved with others, or missing their pair. Where it ranges over states or settings, run each allowed value
   and the combinations the description names. Where it ranges over order, run the events in other orders, and an
   event arriving late, twice or never.
4. A case is a defect only when you ran it and the result contradicts the criterion as the description words it. A
   guard that might be missing, a state the code cannot reach, and anything you did not run are not defects.

Write scratch tests wherever the project's own tests live, and run them with the project's own test commands (this
worktree has its dependencies). Do not change the code under test and do not commit anything.

The description: {description}

What changed: run `git diff {fork}` in this directory, for every change since the branch left main. Read a whole file
wherever the diff alone does not show enough.

Before the last lines, say for each criterion: confirmed, with how many new cases you ran; broken; or not checked, and
why. End your reply with exactly one of these, as your very last lines, plain text, no other formatting:
review: no defects found
or
review: N defect(s) found
1. <the defect and the case you ran that shows it, one sentence>
2. <the defect and the case you ran that shows it, one sentence>
{headless}
"""


def prepare(tree, code):
    """The dependencies a session needs to run the project's tests in a bare worktree of the commit."""
    for link in ("dashboard/node_modules", ".venv"):
        target, source = Path(tree) / link, Path(code) / link
        if source.exists() and not target.exists() and target.parent.is_dir():
            target.symlink_to(source.resolve())


def turn(tool, model, text, cwd, out):
    """One session in `cwd` that may write and run; its reply, or None when it did not finish in time."""
    if tool == "codex":
        argv = ["codex", "exec", "-m", model, "--dangerously-bypass-approvals-and-sandbox", "-C", str(cwd),
                "--skip-git-repo-check", "--json", "-o", f"{out}.txt", text]
    else:
        argv = ["claude", "-p", "--model", model, "--output-format", "json", "--permission-mode", "bypassPermissions"]
    try:
        ran = subprocess.run(argv, input=None if tool == "codex" else text, cwd=cwd, capture_output=True, text=True,
                             timeout=LIMIT_SEC, stdin=subprocess.DEVNULL if tool == "codex" else None)
    except subprocess.TimeoutExpired:
        Path(f"{out}.err").write_text(f"stopped after {LIMIT_SEC} seconds\n")
        return None
    Path(f"{out}.jsonl" if tool == "codex" else f"{out}.json").write_text(ran.stdout)
    if ran.stderr:
        Path(f"{out}.err").write_text(ran.stderr)
    if tool == "codex":
        return Path(f"{out}.txt").read_text() if Path(f"{out}.txt").exists() else ""
    try:
        reply = json.loads(ran.stdout).get("result") or ""
    except ValueError:
        reply = ""
    Path(f"{out}.txt").write_text(reply)
    return reply
