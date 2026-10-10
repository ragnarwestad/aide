"""What a replayed spec is measured on: the plan review's counts, where each criterion is tested, the implement
step's rounds and result, the original spec's tests run against the new code, and the tokens a step used."""
import json
import os
import re
import subprocess
import sys
import tempfile
from xml.etree import ElementTree
from collections import namedtuple
from pathlib import Path

from gitutil import git

Counts = namedtuple("Counts", "must should note")

AC_COVERAGE = Path(__file__).resolve().parents[2] / "core" / "scripts" / "lib" / "run-spec" / "record" / "ac-coverage.sh"
HAND_BACK = re.compile(r"the review found .* defect\(s\) — handing them to the session|the tests are red — handing them back to the session")
JS_TESTS = (".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs")


def plan_review_findings(text):
    """The `**Findings:**` line's text in the newest Plan review section, read as the runner's `plan_review_field`
    reads it (core/scripts/lib/run-spec/turn/review.sh): fenced blocks skipped, a `## Round N` heading starting over.
    None when there is no section."""
    fence = found = inside = seen = False
    level_at, value = 0, ""
    for line in text.splitlines():
        if line.startswith(("```", "~~~")):
            fence = not fence
            continue
        if fence:
            continue
        if re.match(r"## Round [0-9]", line):
            found = inside = seen = False
            value = ""
        if line.startswith("##"):
            level = len(re.match(r"#+", line).group())
            if inside and level <= level_at:
                inside = False
            if not inside and "plan review" in line.lower():
                found = inside = True
                level_at, seen, value = level, False, ""
            continue
        if inside and not seen and line.startswith("**Findings:**"):
            seen, value = True, line[len("**Findings:**"):].strip()
    return value if found else None


def plan_review_counts(text):
    findings = plan_review_findings(text)
    if findings is None:
        return Counts(None, None, "no plan review")
    must, should = (re.search(rf"(\d+) {kind}-fix", findings) for kind in ("must", "should"))
    if not must or not should:
        return Counts(None, None, "no counts")
    return Counts(int(must.group(1)), int(should.group(1)), "")


def where_the_tests_sit(text):
    """The bullets of the newest `Where the tests sit` subsection, each joined with its wrapped lines; None when
    there is no such subsection."""
    fence, inside, level_at, bullets, in_bullet = False, False, 0, None, False
    for line in text.splitlines():
        if line.startswith(("```", "~~~")):
            fence = not fence
        if fence:
            continue
        heading = re.match(r"(#{2,6})\s+(.*?)\s*$", line)
        if heading:
            level = len(heading.group(1))
            if heading.group(2).lower() == "where the tests sit":
                inside, level_at, bullets, in_bullet = True, level, [], False
            elif inside and level <= level_at:
                inside = False
        elif inside and re.match(r"\s*[-*] ", line):
            bullets.append(line)
            in_bullet = True
        elif inside and in_bullet and line.strip() and line[0] in " \t":
            bullets[-1] += " " + line.strip()
        else:
            in_bullet = False
    return None if bullets is None else "\n".join(bullets)


def unplaced_criteria(description, solution):
    """`yes` when every criterion of the description is named in the plan's places for tests, else which are not."""
    ids = re.findall(r"^- \*\*(AC-[0-9]+)", description, re.M)
    if not ids:
        return "no criteria"
    places = where_the_tests_sit(solution)
    if places is None:
        return "no such subsection"
    missing = [i for i in ids if i not in re.findall(r"AC-[0-9]+", places)]
    return "no: " + ", ".join(missing) if missing else "yes"


def implement_rounds(log):
    """The implement session's turns: one, plus one for every time the runner handed defects or red tests back."""
    return 1 + sum(1 for line in log.splitlines() if HAND_BACK.search(line))


def implement_green(result):
    reason = result.get("terminalReason")
    if reason == "completed":
        return "yes" if result.get("testedGreen") else "no test command"
    return "no" if reason == "tests-red" else "–"


def files_to_change(analysis):
    """The paths under `### Files to change` in the newest round of an analysis, read as aide-spec-overlap reads
    them: in backticks, less a leading `./` and a trailing `:<line>` or `:<from>-<to>`."""
    rounds = re.split(r"^## Round [0-9].*$", analysis, flags=re.M)
    section = re.search(r"^### Files to change\s*$(.*?)(?=^#{1,6} |\Z)", rounds[-1], re.M | re.S)
    if not section:
        return []
    paths = []
    for line in section.group(1).splitlines():
        found = re.match(r"\s*[-*]\s*`([^`]+)`", line)
        if found:
            paths.append(re.sub(r":[0-9]+(-[0-9]+)?$", "", re.sub(r"^\./", "", found.group(1))))
    return paths


def changed_files(code, before, landed):
    return (git(code, "diff", "--name-only", "--no-renames", before, landed) or "").splitlines()


def files_found(named, changed):
    """(named and changed, changed, named and not changed), Markdown left out as the shared files check leaves it."""
    named = {p for p in named if not p.endswith(".md")}
    changed = {p for p in changed if not p.endswith(".md")}
    return len(named & changed), len(changed), len(named - changed)


def original_test_files(code, before, landed, ac_coverage=AC_COVERAGE):
    """The test files the landing added or changed (by the project's own rule for which paths hold tests)."""
    out = git(code, "diff", "--name-status", "--no-renames", "-z", before, landed).split("\0")
    paths = [path for status, path in zip(out[::2], out[1::2]) if status in ("A", "M")]
    if not paths:
        return []
    script = 'source "$1"; shift; for p; do ac_coverage_is_test_file "$p" && echo "$p"; done'
    found = subprocess.run(["bash", "-c", script, "_", str(ac_coverage), *paths], capture_output=True, text=True)
    return sorted(found.stdout.split("\n")[:-1])


def junit_file_counts(path):
    """(passed, ran) in one JUnit file, skipped cases left out; None when it cannot be read."""
    try:
        root = ElementTree.parse(path).getroot()
    except (ElementTree.ParseError, OSError):
        return None
    passed = ran = 0
    for case in root.iter("testcase"):
        kinds = {child.tag for child in case}
        if "skipped" not in kinds:
            ran += 1
            passed += not kinds & {"failure", "error"}
    return passed, ran


def junit_counts(paths):
    counts = [c for c in map(junit_file_counts, paths) if c]
    return sum(p for p, _ in counts), sum(r for _, r in counts)


def command_for(worktree, rel, xml, python):
    """The command and folder that run one test file and write JUnit XML, or None for a file with no known runner."""
    if rel.endswith(".py"):
        return [python or sys.executable, "-m", "pytest", "-p", "no:cacheprovider", "--junitxml", xml, rel], worktree
    if not rel.endswith(JS_TESTS):
        return None
    folder = Path(worktree, rel).parent
    while folder != Path(worktree).parent and not (folder / "package.json").exists():
        folder = folder.parent
    if not (folder / "package.json").exists():
        return None
    inside = os.path.relpath(Path(worktree, rel), folder)
    if (folder / "bun.lock").exists() or (folder / "bun.lockb").exists():
        return ["bun", "test", "--reporter=junit", "--reporter-outfile", xml, inside], str(folder)
    if "vitest" in (folder / "package.json").read_text():
        return ["npx", "vitest", "run", "--reporter=junit", "--outputFile", xml, inside], str(folder)
    return None


def run_test_file(worktree, rel, python=None, timeout=600):
    """(passed, ran) of one test file run on its own; a file that wrote no XML counts as one case, passed when it
    exited 0. None when the file has no known runner or the runner is not installed."""
    with tempfile.TemporaryDirectory() as folder:
        xml = os.path.join(folder, "junit.xml")
        command = command_for(str(worktree), rel, xml, python)
        if not command:
            return None
        try:
            ran = subprocess.run(command[0], cwd=command[1], capture_output=True, timeout=timeout)
            code = ran.returncode
        except subprocess.TimeoutExpired:
            code = 1
        except OSError:
            return None
        counts = junit_file_counts(xml)
    return counts if counts and counts[1] else (int(code == 0), 1)


def claude_event_tokens(event):
    """The tokens one Claude Code result event reports: the sum over its models, else its flat usage. None when it has
    neither."""
    models = [m for m in (event.get("modelUsage") or {}).values() if isinstance(m, dict)]
    flat = event.get("usage") if isinstance(event.get("usage"), dict) else None
    if models:
        return sum(m.get(k) or 0 for m in models for k in ("inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"))
    if flat:
        return sum(flat.get(k) or 0 for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
    return None


def step_tokens(stream, tool):
    """Every token a step used, summed over all its turns' closing events in its stream file; None when it has none.
    The fields are the ones the runner reads (core/scripts/lib/run-spec/turn/model-turn.sh)."""
    if tool == "opencode":
        return None
    try:
        lines = Path(stream).read_text().splitlines()
    except OSError:
        return None
    totals = []
    for line in lines:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        if tool == "codex" and event.get("type") == "turn.completed" and isinstance(event.get("usage"), dict):
            u = event["usage"]
            totals.append(sum(u.get(k) or 0 for k in ("input_tokens", "output_tokens", "reasoning_output_tokens", "cached_input_tokens")))
        elif tool != "codex" and event.get("type") == "result":
            totals.append(claude_event_tokens(event))
    totals = [t for t in totals if t is not None]
    return sum(totals) if totals else None
