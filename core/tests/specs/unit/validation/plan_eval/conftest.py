"""Fixtures for scripts/plan_eval: replay's world of repositories and archived specs, a case file for its landed spec,
and stand-in `claude` and `codex` judges that record every call and answer a canned rubric judgment. No test starts a
model."""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest

from ..replay_specs.conftest import aide_repo, make_aide_repo, standin, world, write  # noqa: F401  (fixtures)

PLAN_EVAL_DIR = Path(__file__).resolve().parents[6] / "scripts" / "plan_eval"
sys.path.insert(0, str(PLAN_EVAL_DIR))  # the script's modules import each other by plain name

DIMENSIONS = ("requirements", "code", "tests", "approach")


def case_text(number="4", folder="4-replayed", before="a" * 40, landed="b" * 40, description_sha="c" * 64, approved="no",
              omissions=None):
    """A case file's text; `omissions` is the Serious omissions section's items, as (id, documents)."""
    omissions = omissions or [("S1", "analysis, plan"), ("S2", "plan")]
    lines = [f"# Expected assessment: {number}", "",
             f"- **Spec:** `{folder}`", f"- **Code before:** `{before}`", f"- **Code landed:** `{landed}`",
             f"- **Description sha256:** `{description_sha}`", f"- **Approved:** {approved}", "",
             "## Requirements", "", "- **R1:** The thing 1 works. Evidence: AC-1.", "",
             "## Code and interactions", "", "- **C1:** `lib_replayed.py` holds the thing.",
             "  Evidence: `lib_replayed.py:1` at the commit before.", "",
             "## Tests", "", "- **T1:** A test that the thing works. Evidence: AC-1.", "",
             "## Serious omissions", ""]
    lines += [f"- **{sid} ({docs}):** Omission {sid} is missed. Evidence: AC-2." for sid, docs in omissions]
    return "\n".join(lines) + "\n"


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def answer(scores=None, omissions=None, **dimension_changes):
    """A judge's rubric answer as JSON text: every dimension scored 4 with a reason and evidence unless changed."""
    scores = scores or {}
    dims = {d: {"reason": f"reason for {d}", "evidence": [f"evidence for {d}"], "score": scores.get(d, 4)} for d in DIMENSIONS}
    for d, change in dimension_changes.items():
        if change is None:
            del dims[d]
        else:
            dims[d].update(change)
    omissions = omissions if omissions is not None else {"S1": "covered", "S2": "covered"}
    return json.dumps({"dimensions": dims, "omissions": {k: {"status": v, "evidence": f"where {k} is"} for k, v in omissions.items()}})


CLAUDE_JUDGE = r'''#!/usr/bin/env bash
n=$(( $(ls "$STANDIN_DIR"/judge-call-* 2>/dev/null | wc -l) + 1 ))
d="$STANDIN_DIR/judge-call-$n"; mkdir -p "$d"
cat > "$d/prompt"; printf '%s\n' "$@" > "$d/args"; echo claude > "$d/tool"
echo "AIDE_RUN_URL=${AIDE_RUN_URL-unset}" > "$d/env"
text="$(cat "$STANDIN_DIR/judge-reply")"
python3 -c 'import json,sys; print(json.dumps({"type":"result","result":sys.argv[1],"duration_ms":2000,"total_cost_usd":0.25,
"usage":{"input_tokens":10,"output_tokens":5}}))' "$text"
'''

CODEX_JUDGE = r'''#!/usr/bin/env bash
n=$(( $(ls "$STANDIN_DIR"/judge-call-* 2>/dev/null | wc -l) + 1 ))
d="$STANDIN_DIR/judge-call-$n"; mkdir -p "$d"
cat > "$d/prompt"; printf '%s\n' "$@" > "$d/args"; echo codex > "$d/tool"
echo "AIDE_RUN_URL=${AIDE_RUN_URL-unset}" > "$d/env"
out=""; dir=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; -C) dir="$2"; shift ;; esac
  shift
done
ls -A "$dir" > "$d/folder-listing"
cp "$STANDIN_DIR/judge-reply" "$out"
echo '{"type":"thread.started","thread_id":"t"}'
echo '{"type":"turn.completed","usage":{"input_tokens":50,"cached_input_tokens":20,"output_tokens":7}}'
echo '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20}}'
'''


@pytest.fixture
def judges(tmp_path, monkeypatch, standin):
    """Stand-in `claude` and `codex` judges on AIDE_CLAUDE_BIN and AIDE_CODEX_BIN. `say(text)` sets their reply;
    `calls()` gives every call made, in order, as dicts of tool, args, prompt and env."""
    bin_dir = tmp_path / "judge-bin"
    write(bin_dir / "claude", CLAUDE_JUDGE, 0o755)
    write(bin_dir / "codex", CODEX_JUDGE, 0o755)
    monkeypatch.setenv("AIDE_CLAUDE_BIN", str(bin_dir / "claude"))
    monkeypatch.setenv("AIDE_CODEX_BIN", str(bin_dir / "codex"))

    def say(text):
        write(standin / "judge-reply", text)

    def calls():
        found = sorted(standin.glob("judge-call-*"), key=lambda p: int(p.name.rsplit("-", 1)[1]))
        return [{name: (p / name).read_text() for name in ("tool", "args", "prompt", "env") if (p / name).exists()} | {"dir": p}
                for p in found]

    say(answer())
    return type("Judges", (), {"say": staticmethod(say), "calls": staticmethod(calls), "bin": bin_dir})


@pytest.fixture
def pilot(world, judges, tmp_path):
    """The world with a cases folder holding an approved case for `4-replayed`, pinned to its landing, and the
    argv builders for `check` and `run`."""
    cases = tmp_path / "cases"
    description = world.specs_root / "archive" / "4-replayed" / "1-description.md"

    def write_case(approved="2026-11-16", **fields):
        values = dict(before=world.before["4-replayed"], landed=world.landed["4-replayed"],
                      description_sha=sha256_of(description), approved=approved)
        values.update(fields)
        write(cases / "4.md", case_text(**values))
        return cases / "4.md"

    write_case()

    def common():
        return ["--cases-dir", str(cases), "--project", "proj", "--code", str(world.code), "--specs-root", str(world.specs_root)]

    def check_argv(*extra):
        return ["check", *common(), *extra]

    def run_argv(*extra, analyze=("claude", "opus", "high"), judge=("claude", "opus"), commit_=None):
        return ["run", *common(), "--aide-commit", commit_ or world.aide.new, "--analyze", *analyze, "--judge", *judge,
                "--aide-repo", str(world.aide.path), "--results", str(world.results), *extra]

    world.cases, world.write_case, world.check_argv, world.run_argv = cases, write_case, check_argv, run_argv
    world.judges = judges
    return world


@pytest.fixture
def plan_eval_main():
    spec = importlib.util.spec_from_file_location("plan_eval_main", PLAN_EVAL_DIR / "__main__.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.main
