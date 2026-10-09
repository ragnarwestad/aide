"""Fixtures for scripts/replay_specs: repositories with each kind of landing, archived specs, a stand-in Aide
repository with a recording runner, and stand-ins for the judge and `gh`. No test starts a model."""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT_DIR = Path(__file__).resolve().parents[6] / "scripts" / "replay_specs"
sys.path.insert(0, str(SCRIPT_DIR))  # the script's modules import each other by plain name

WORKSPACE = SCRIPT_DIR.parents[1]
IDENT = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@x"}


def git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), "-c", "commit.gpgsign=false", *args],
                       capture_output=True, text=True, env={**os.environ, **IDENT})
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()


def init_repo(path, branch="main"):
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", "-b", branch, str(path)], check=True)
    return path


def write(path, text, mode=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    if mode:
        path.chmod(mode)


def commit(repo, files=None, message="change"):
    for rel, text in (files or {}).items():
        write(Path(repo) / rel, text)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "--allow-empty", "-m", message)
    return git(repo, "rev-parse", "HEAD")


def land_by_merge(repo, folder, files, catch_up=True):
    """Branch `aide/<folder>` off main, one commit of its own, main moves on, a catch-up merge, the landing merge.
    Returns the commit before the landing and the landing merge."""
    git(repo, "checkout", "-q", "-b", f"aide/{folder}")
    commit(repo, files, f"Code for {folder}")
    git(repo, "checkout", "-q", "main")
    before = commit(repo, {f"other-{folder}.txt": "x"}, "Other work")
    if catch_up:
        git(repo, "checkout", "-q", f"aide/{folder}")
        git(repo, "merge", "-q", "--no-ff", "-m", f"Merge remote-tracking branch 'origin/main' into aide/{folder}", "main")
        git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", "-m",
        f"Merge remote-tracking branch 'refs/remotes/origin/aide/{folder}' into HEAD", f"aide/{folder}")
    return before, git(repo, "rev-parse", "HEAD")


def description(folder, depends=None, criteria=3):
    lines = [f"# {folder} - Description", "", "## Tracking info", "", f"- **Task:** `{folder}/`"]
    if depends:
        lines.append(f"- **Depends on:** `{depends}`")
    lines += ["", "---", "", "## Description", "", "## Out of scope", "", "Nothing else."]
    lines += [f"- **AC-{n}:** The thing {n} SHALL work." for n in range(1, criteria + 1)]
    return "\n".join(lines) + "\n"


def archive_spec(specs_root, folder, depends=None, state=None, landed_tip=None, began=None, attempts=None, extra=None):
    """An archived spec; `landed_tip` is the Repo line of its 4-status.md, `began` and `attempts` those of 3-solution.md."""
    base = Path(specs_root) / "archive" / folder
    write(base / "0-README.md", f"# {folder}\n")
    write(base / "1-description.md", description(folder, depends))
    write(base / "3-solution.md", "# Solution\n\nORIGINAL-PLAN-MARKER\n"
          + (f"\n- **Repo:** `code/aide/{folder} @ {began}`\n" if began else "")
          + (f"- **Attempts:** {attempts}\n" if attempts else ""))
    write(base / "4-status.md", "# Status\n" + (f"\n- **Repo:** `code/aide/{folder} @ {landed_tip}`\n" if landed_tip else ""))
    write(base / "4-status.json", json.dumps(state or {"closed": None}))
    for name, text in (extra or {}).items():
        write(base / name, text)
    return base


RUNNER = r'''#!/usr/bin/env bash
# Stand-in for aide-run-spec: records what it is given and leaves behind what a step leaves.
MARK="@MARK@"
set -u
cmd=""; proj=""; sroot=""; spec=""; result=""; stream=""; tool=""
args=("$@")
while [ $# -gt 0 ]; do
  case "$1" in
    --command) cmd="$2" ;;
    --project-dir) proj="$2" ;;
    --specs-root) sroot="$2" ;;
    --spec) spec="$2" ;;
    --result-file) result="$2" ;;
    --stream-file) stream="$2" ;;
    --tool) tool="$2" ;;
@WORKTREE@  esac
  shift 2
done
rec="$STANDIN_DIR/$cmd"
mkdir -p "$rec"
printf '%s\n' "${args[@]}" > "$rec/args"
{ echo "mark=$MARK"; echo "AIDE_RUN_URL=${AIDE_RUN_URL-unset}"; echo "CLAUDE_CONFIG_DIR=${CLAUDE_CONFIG_DIR-unset}"
  echo "CODEX_HOME=${CODEX_HOME-unset}"; echo "OPENCODE_CONFIG_DIR=${OPENCODE_CONFIG_DIR-unset}"
  echo "OPENCODE_DISABLE_EXTERNAL_SKILLS=${OPENCODE_DISABLE_EXTERNAL_SKILLS-unset}"; echo "TMPDIR=${TMPDIR-unset}"; } > "$rec/env"
cp "$(command -v aide-write-spec)" "$rec/write-spec"
git -C "$proj" rev-parse HEAD > "$rec/project-head"
git -C "$proj" remote > "$rec/project-remotes"
ls -A "$proj" > "$rec/project-files"
[ -L "$proj/.venv" ] && readlink "$proj/.venv" > "$rec/venv-link"
(cd "$sroot" && find . -not -name '.git' | sort) > "$rec/specs-listing"
cp "$sroot/$spec/1-description.md" "$rec/description"
[ -f "$sroot/$spec/3-solution.md" ] && cp "$sroot/$spec/3-solution.md" "$rec/solution"
cp "$sroot/$spec/2-analysis.md" "$rec/analysis"
[ -f "$sroot/wiki/index.md" ] && cp "$sroot/wiki/index.md" "$rec/wiki-index"
if [ "${CLAUDE_CONFIG_DIR-}" ]; then
  ls "$CLAUDE_CONFIG_DIR/skills" > "$rec/claude-skills"; ls "$CLAUDE_CONFIG_DIR/rules" > "$rec/claude-rules"
  cp "$CLAUDE_CONFIG_DIR/skills/aide-analyze/SKILL.md" "$rec/claude-skill"
fi
if [ "${CODEX_HOME-}" ]; then
  (cd "$CODEX_HOME" && ls) > "$rec/codex-files"; (cd "$CODEX_HOME/skills" && ls) > "$rec/codex-skills"
  cp "$CODEX_HOME/AGENTS.md" "$rec/codex-agents"; cp "$CODEX_HOME/config.toml" "$rec/codex-config"
  readlink "$CODEX_HOME/auth.json" > "$rec/codex-auth"
fi
if [ -e "$STANDIN_DIR/hang-$cmd" ]; then
  echo $$ > "$rec/pid"; sleep 300 & echo $! > "$rec/child"; wait
fi
if [ "$cmd" = analyze ]; then
  git -C "$sroot" checkout -q -b "aide/$spec"
  [ -f "$STANDIN_DIR/analysis.md" ] && cp "$STANDIN_DIR/analysis.md" "$sroot/$spec/2-analysis.md"
  if [ -f "$STANDIN_DIR/plan.md" ]; then cp "$STANDIN_DIR/plan.md" "$sroot/$spec/3-solution.md"
  else printf '# Plan\n\nNEW-PLAN-MARKER\n' > "$sroot/$spec/3-solution.md"; fi
  git -C "$sroot" add -A && git -C "$sroot" commit -q -m "Run /aide-analyze for $spec"
  git -C "$sroot" checkout -q main
else
  git -C "$proj" checkout -q -b "aide/$spec"
  echo "$spec" > "$proj/implemented.txt"
  git -C "$proj" add implemented.txt && git -C "$proj" commit -q -m "Implement $spec"
  git -C "$proj" checkout -q main
fi
if [ "$tool" = codex ]; then
  for i in 1 2; do echo '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":10,"reasoning_output_tokens":5,"cached_input_tokens":50}}'; done > "$stream"
else
  for i in 1 2; do echo '{"type":"result","modelUsage":{"m":{"inputTokens":100,"outputTokens":10,"cacheReadInputTokens":50,"cacheCreationInputTokens":5}}}'; done > "$stream"
fi
[ -f "$STANDIN_DIR/$cmd-log" ] && cat "$STANDIN_DIR/$cmd-log" >&2
line='{"ok":true,"terminalReason":"completed","testedGreen":true,"costUsd":0.5,"durationSec":3}'
[ -f "$STANDIN_DIR/$cmd-result.json" ] && line="$(cat "$STANDIN_DIR/$cmd-result.json")"
echo "$line" > "$result"
echo "$line"
'''

SKILLS = ("aide-analyze", "aide-implement", "spec-structure")
RULES = ("llm-discipline", "git", "testing", "spec-structure", "communication", "extra")


def build_aide_commit(repo, version, rules_line, takes_worktree_base=True):
    runner = RUNNER.replace("@MARK@", version).replace(
        "@WORKTREE@", "    --worktree-base) ;;\n" if takes_worktree_base else "")
    scripts = repo / "core" / "scripts"
    write(scripts / "aide-run-spec", runner)
    write(scripts / "aide-write-spec", f"#!/usr/bin/env bash\n# write-spec {version}\n", 0o755)
    for name in ("aide-reset-spec", "_aide-spec-lib.sh"):
        write(scripts / name, (WORKSPACE / "core" / "scripts" / name).read_text(), 0o755)
    for skill in SKILLS:
        write(repo / "core" / "skills" / skill / "SKILL.md", f"skill {skill} {version}\n")
    for rule in RULES:
        write(repo / "core" / "rules" / f"{rule}.md", f"rule {rule}\n")
    write(repo / "core" / "implementations" / "claude-code" / "install.sh", f'GENERIC_RULES="{rules_line}"\n')
    write(repo / "core" / "AGENTS.md", f"agents {version}\n")
    return commit(repo, message=f"Aide {version}")


@pytest.fixture
def make_aide_repo(tmp_path):
    """A stand-in Aide repository with two commits, `.old` and `.new`, that differ in a skill, a script and the
    rules the Claude Code installer lists."""
    def make(takes_worktree_base=True, name="aide-repo"):
        repo = init_repo(tmp_path / name)
        old = build_aide_commit(repo, "v1", "llm-discipline git", takes_worktree_base)
        new = build_aide_commit(repo, "v2", "llm-discipline git testing", takes_worktree_base)
        return SimpleNamespace(path=repo, old=old, new=new)
    return make


@pytest.fixture
def aide_repo(make_aide_repo):
    return make_aide_repo()


@pytest.fixture
def standin(tmp_path, monkeypatch):
    """The folder the stand-in runner, judge and gh read their orders from and record into."""
    folder = tmp_path / "standin"
    folder.mkdir()
    monkeypatch.setenv("STANDIN_DIR", str(folder))
    return folder


@pytest.fixture
def fake_gh(tmp_path, monkeypatch, standin):
    """A `gh` on PATH that answers what the test writes with `answer`."""
    bin_dir = tmp_path / "bin"
    write(bin_dir / "gh", '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$STANDIN_DIR/gh-args"\ncat "$STANDIN_DIR/gh-answer"\n', 0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    return lambda answer: write(standin / "gh-answer", answer)


def judge_says(standin, text, **fields):
    """Make the stand-in judge answer as `claude -p --output-format json` does, with `text` as the model's words."""
    write(standin / "judge-answer", json.dumps({"type": "result", "result": text, "duration_ms": 2000,
                                                 "total_cost_usd": 0.25, "usage": {"input_tokens": 10, "output_tokens": 5}, **fields}))


def snapshot(repo):
    """Everything about a repository the script must leave alone."""
    return {name: git(repo, *args) for name, args in {
        "branches": ("branch", "-a", "-v"), "head": ("rev-parse", "HEAD"), "status": ("status", "--porcelain"),
        "worktrees": ("worktree", "list"), "remotes": ("remote", "-v"), "stash": ("stash", "list"),
    }.items()}


@pytest.fixture
def world(tmp_path, monkeypatch, standin, aide_repo):
    """A project `proj`: a code checkout with an origin and two merge landings, a specs repository with archived
    specs (one landed, one never found, one closed), the stand-in Aide repository, judge and run settings."""
    code = init_repo(tmp_path / "checkouts" / "code")
    commit(code, {"README.md": "r", ".gitignore": ".venv/\n"}, "First")
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    git(code, "remote", "add", "origin", str(origin))
    before4, landed4 = land_by_merge(code, "4-replayed", {"test_replayed.py": "def test_ok():\n    assert True\n", "lib_replayed.py": "x = 1\n"})
    before6, landed6 = land_by_merge(code, "6-second", {"test_second.py": "def test_a():\n    assert True\n\n\ndef test_b():\n    assert False\n"})
    git(code, "push", "-q", "origin", "main")
    write(code / ".aide" / "project.yaml", "name: proj\nworktreeLinks: .venv\n")  # untracked, as in the board's clones
    (code / ".venv").mkdir()

    specs_repo = init_repo(tmp_path / "checkouts" / "specs")
    specs_root = specs_repo / "proj"
    archive_spec(specs_root, "1-nolanding")
    archive_spec(specs_root, "3-closed", state={"closed": {"reason": "no"}})
    archive_spec(specs_root, "4-replayed", depends="1", extra={
        "ac-coverage.json": "{}", "test-run.json": "{}"}, state={"closed": None, "archived": {"date": "2026-10-01"}})
    archive_spec(specs_root, "6-second")
    commit(specs_repo, message="Specs")

    judge = tmp_path / "bin" / "claude"
    write(judge, '#!/usr/bin/env bash\ncat > "$STANDIN_DIR/judge-prompt"\nprintf "%s\\n" "$*" > "$STANDIN_DIR/judge-args"\ncat "$STANDIN_DIR/judge-answer"\n', 0o755)
    judge_says(standin, '{"score": 4, "reasons": "covers AC-3"}')
    runner_tmp = tmp_path / "tmp"
    runner_tmp.mkdir()
    for key, value in {"TMPDIR": str(runner_tmp), "AIDE_RUN_URL": "http://board.invalid/run", "CLAUDE_CODE_OAUTH_TOKEN": "token",
                       "AIDE_CLAUDE_BIN": str(judge)}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    results = tmp_path / "results"
    w = SimpleNamespace(code=code, origin=origin, specs_repo=specs_repo, specs_root=specs_root, aide=aide_repo, results=results,
                        tmp=runner_tmp, standin=standin, before={"4-replayed": before4, "6-second": before6},
                        landed={"4-replayed": landed4, "6-second": landed6}, home=tmp_path / "home")

    def argv(*specs, analyze=("claude", "opus", "high"), implement=("claude", "sonnet"), commit_=None, extra=()):
        return ["--project", "proj", "--specs", ",".join(specs), "--aide-commit", commit_ or aide_repo.new,
                "--analyze", *analyze, *(["--implement", *implement] if implement else []), "--judge", "opus", "--code", str(code),
                "--specs-root", str(specs_root), "--aide-repo", str(aide_repo.path), "--results", str(results), *extra]

    def record(step, name):
        path = standin / step / name
        return path.read_text() if path.exists() else None

    def run_folder():
        (folder,) = list(results.iterdir())
        return folder

    w.argv, w.record, w.run_folder = argv, record, run_folder
    return w


@pytest.fixture
def replay_main():
    spec = importlib.util.spec_from_file_location("replay_specs_main", SCRIPT_DIR / "__main__.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.main
