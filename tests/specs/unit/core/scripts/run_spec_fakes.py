"""The stand-in AIs these tests run with: what each one writes, commits
or pushes while it stands in for the model.

Split out of conftest.py 2026-09-04, where the shared machinery had
reached 1017 lines. Every builder is unchanged and keeps its name.
"""

import json
import os
import pathlib
import re
import shlex
import shutil
import signal
import subprocess
import time
import pytest
from .conftest import READ_SPECS, git, run
from .run_spec_invoking import create
from .run_spec_results import RESULT_OK
def writing_claude(fake_claude, workspace):
    """A claude that leaves work behind in both roots, the way a real
    step does — in ITS OWN working directory and in the specs root its
    own .aide/config names, never by absolute path into a main checkout.
    """
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def project_only_claude(fake_claude, workspace):
    """A claude that writes to the project and nowhere else — the shape
    of a real `implement` step, which changes code and leaves the specs
    root with nothing of its own to commit.
    """
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def specs_only_claude(fake_claude, workspace):
    """An `analyze` step: it changes the specs repo and nothing else.
    This is the shape of most of what the queue actually runs."""
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def self_committing_claude(fake_claude, workspace):
    """A step that commits its own work before it finishes — the way
    /aide-archive does. The run's own commit loop then finds a clean
    tree, and that must not read as "nothing happened" (spec 98).

    Only the written file is staged: the linked `deps` dependency
    directory is a symlink, which `/deps/` in .gitignore does not match,
    and staging it would put the main checkout's absolute path into the
    commit.
    """
    return fake_claude(
        "cat > /dev/null\n"
        + 'echo "written and committed by the step" > "$PWD/self-committed.txt"\n'
        + "git add self-committed.txt\n"
        + 'git commit -q -m "the step committed this itself"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def partially_committing_claude(fake_claude, workspace, then=""):
    """A step that commits PART of its own work and leaves the rest on
    disk — spec 142's actual shape, and what the global git rules
    produce headlessly: new files may be added by name, modified
    tracked files are left for a user in an IDE who is not there.

    The committed message has a body on purpose: a stop reason appended
    to it must land on its own line, not glued to the last body line.
    """
    return fake_claude(
        "cat > /dev/null\n"
        + 'echo "committed by the step" > "$PWD/self-committed.txt"\n'
        + "git add self-committed.txt\n"
        + "git commit -q -m 'The step wrote this itself' "
        + "-m 'And explained why, the way a written message does.'\n"
        + 'echo "left behind by the step" > "$PWD/left-behind.txt"\n'
        + then
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def race_pushing_claude(fake_claude, workspace, origin_bare, branch, race_marker, race_dir):
    """The step's own script plays TWO parts: itself, writing its own
    file exactly as any real step does, and a stand-in for a second,
    concurrent process (another run, or a landing) that reaches origin's
    copy of the SAME branch first, via an independent clone. The race is
    real git against a real bare repo — no mocking — the shape REQ-1's
    `pull --rebase` retry has to recover from."""
    return fake_claude(
        "cat > /dev/null\n"
        + f'git clone -q "{origin_bare}" "{race_dir}"\n'
        + f'git -C "{race_dir}" switch -q -c "{branch}"\n'
        + f'echo "raced" > "{race_dir}/raced.txt"\n'
        + f'git -C "{race_dir}" add -A\n'
        + f'git -C "{race_dir}" commit -q -m "a concurrent push landed here first"\n'
        + f'git -C "{race_dir}" rev-parse HEAD > {race_marker}\n'
        + f'git -C "{race_dir}" push -q origin "{branch}"\n'
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def conflicting_race_claude(fake_claude, workspace, origin_bare, branch, race_marker, race_dir):
    """Like `race_pushing_claude`, but the concurrent process edits the
    SAME line of a tracked file this step's own worktree also edits —
    the shape REQ-3/REQ-7 need: a `pull --rebase` retry that hits a
    REAL, same-line conflict, which the script must abort and report,
    never resolve by force."""
    return fake_claude(
        "cat > /dev/null\n"
        + f'git clone -q "{origin_bare}" "{race_dir}"\n'
        + f'git -C "{race_dir}" switch -q -c "{branch}"\n'
        + f'echo "their line" > "{race_dir}/README.md"\n'
        + f'git -C "{race_dir}" commit -q -am "their side"\n'
        + f'git -C "{race_dir}" rev-parse HEAD > {race_marker}\n'
        + f'git -C "{race_dir}" push -q origin "{branch}"\n'
        + 'echo "our line" > "$PWD/README.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def self_pushing_claude(fake_claude, workspace, sha_marker, then=""):
    """Commits part of its own work under a written message AND pushes
    that commit to origin itself, then leaves more on disk — spec 146's
    `partially_committing_claude` shape, plus the push spec 327's run
    actually did. `sha_marker` records the step's own commit sha so a
    test can tell an amend (a new sha) from a second commit (this sha
    kept as an ancestor) after the run has torn the worktree down.
    """
    return fake_claude(
        "cat > /dev/null\n"
        + 'echo "committed by the step" > "$PWD/self-committed.txt"\n'
        + "git add self-committed.txt\n"
        + "git commit -q -m 'The step wrote this itself'\n"
        + f"git rev-parse HEAD > {sha_marker}\n"
        + 'git push -q origin "$(git rev-parse --abbrev-ref HEAD)"\n'
        + 'echo "left behind by the step" > "$PWD/left-behind.txt"\n'
        + then
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def probing_claude(fake_claude, workspace, extra="", result=RESULT_OK):
    """A claude that records the main checkouts' branches DURING the run —
    the only moment at which the question can be asked."""
    log = workspace["project"].parent / "main-branches.txt"
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'git -C "{workspace["project"]}" rev-parse --abbrev-ref HEAD >> {log}\n'
        + f'git -C "{workspace["specs"]}" rev-parse --abbrev-ref HEAD >> {log}\n'
        + extra
        + f"echo '{json.dumps(result)}'"
    ), log


def make_worktree_add_gate(tmp_path, name, target_root, events_file):
    """A `git` shim that pauses the ONE invocation matching
    `-C <target_root> worktree add ...`, touching `<name> ready` in
    `events_file` and blocking on a `<name>-go` file before running the
    real `git` — then records `<name> done` once it returns. Every other
    git invocation (including `worktree add` against a DIFFERENT root)
    passes straight through, unrecorded.
    """
    real_git = shutil.which("git")
    shim_dir = tmp_path / f"git-shim-{name}"
    shim_dir.mkdir()
    go = tmp_path / f"{name}-go"
    shim = shim_dir / "git"
    shim.write_text(
        "#!/usr/bin/env bash\n"
        f"real={shlex.quote(real_git)}\n"
        f'if [ "$1" = "-C" ] && [ "$2" = {shlex.quote(str(target_root))} ] '
        '&& [ "$3" = "worktree" ] && [ "$4" = "add" ]; then\n'
        f'  echo "{name} ready" >> {shlex.quote(str(events_file))}\n'
        f"  while [ ! -f {shlex.quote(str(go))} ]; do sleep 0.05; done\n"
        '  "$real" "$@"\n'
        "  rc=$?\n"
        f'  echo "{name} done" >> {shlex.quote(str(events_file))}\n'
        "  exit $rc\n"
        "fi\n"
        'exec "$real" "$@"\n'
    )
    shim.chmod(0o755)
    return shim_dir, go


def make_named_writing_claude(tmp_path, name, folder, tag):
    """A stand-in `claude`, written to its OWN file (unlike the
    `fake_claude` fixture, which always writes to the same path — fine
    for sequential use, but two of these have to exist and differ AT THE
    SAME TIME for a concurrency test). Leaves a `tag`-named marker in
    both the project and the specs root, the way `writing_claude` does."""
    path = tmp_path / f"fake-claude-{name}"
    path.write_text(
        "#!/usr/bin/env bash\n"
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "{tag}" > "$PWD/{tag}.txt"\n'
        + f'echo "{tag}" > "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'\n"
    )
    path.chmod(0o755)
    return path


def linking_claude(fake_claude, workspace, candidates):
    """A claude that records which of `candidates` was symlinked into the
    worktree it is standing in — the only moment the question can be
    asked, since the worktree goes with the run."""
    log = workspace["project"].parent / "links-seen.txt"
    body = "cat > /dev/null\n" + READ_SPECS
    for entry in candidates:
        body += f'if [ -L "$PWD/{entry}" ]; then echo "{entry}" >> {log}; fi\n'
    body += f"echo '{json.dumps(RESULT_OK)}'"
    return fake_claude(body), log


def creating_claude(fake_claude, folders=("94-a-new-spec",)):
    """A stand-in `/aide-create`: it writes the spec folders it was told
    to write, into the specs root its own working directory points at."""
    body = READ_SPECS
    for folder in folders:
        body += (
            f'mkdir -p "$specs/{folder}"\n'
            f'printf "# {folder} - Description\\n" > "$specs/{folder}/1-description.md"\n'
        )
    body += f"echo '{json.dumps(RESULT_OK)}'"
    return fake_claude(f"cat > /dev/null\n{body}")


def analyzing_claude(fake_claude, workspace, last_analyzed="2026-08-01"):
    """A stand-in `/aide-analyze` that leaves `2-analysis.md` behind with
    a Tracking info section carrying the `Last analyzed:` date field —
    unlike `writing_claude`, which writes the file with no Tracking info
    at all."""
    folder = workspace["folder"]
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "%s\\n" "# Queue - Analysis" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{folder}/\\`" "- **Last analyzed:** \\`{last_analyzed}\\`" '
        + f'> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def analyze_claude_advancing_row(fake_claude, workspace, mark):
    """A stand-in analyze step that rewrites 4-status.md's own Phase 1
    row to a mark other than not-started — implement's and archive's job,
    never analyze's own (REQ-1, REQ-2)."""
    folder = workspace["folder"]
    body = (
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{folder}/`\n"
        "- **Workflow steps completed:** create\n"
        "- **Total progress:** 0% (0 of 1 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        f"| a | {mark} | |\n"
    )
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'cat > "$specs/{folder}/4-status.md" <<\'STATUSEOF\'\n'
        + body
        + "STATUSEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def analyze_claude_naming_implement(fake_claude, workspace):
    """A stand-in analyze step that writes `implement` onto the Workflow
    steps line itself, with no project change and no row advanced — the
    shape spec 284's own `1b3748a` produced (REQ-2)."""
    folder = workspace["folder"]
    body = (
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{folder}/`\n"
        "- **Workflow steps completed:** create, analyze, implement\n"
        "- **Total progress:** 0% (0 of 1 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| a | ⬜ | |\n"
    )
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'cat > "$specs/{folder}/4-status.md" <<\'STATUSEOF\'\n'
        + body
        + "STATUSEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def analyze_claude_writing_the_line_from_nothing(fake_claude, workspace):
    """A stand-in analyze step on a spec whose 4-status.md carries NO
    steps line — which is every spec at creation — that writes the line
    itself as `create, analyze`, and advances nothing."""
    folder = workspace["folder"]
    body = (
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{folder}/`\n"
        "- **Workflow steps completed:** create, analyze\n"
        "- **Total progress:** 0% (0 of 1 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| a | ⬜ | |\n"
    )
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'cat > "$specs/{folder}/4-status.md" <<\'STATUSEOF\'\n'
        + body
        + "STATUSEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def analyze_claude_renaming_the_header(fake_claude, workspace):
    """Spec 299: a stand-in analyze step that rewrites the Phase table's
    header to non-standard column names, leaving its one row exactly
    where it was (⬜) — nothing genuinely advanced, so the header itself
    must never be counted as the row that did."""
    folder = workspace["folder"]
    body = (
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{folder}/`\n"
        "- **Workflow steps completed:** create\n"
        "- **Total progress:** 0% (0 of 1 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| REQ | Criterion | Done |\n|------|--------|-------|\n"
        "| a | ⬜ | |\n"
    )
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'cat > "$specs/{folder}/4-status.md" <<\'STATUSEOF\'\n'
        + body
        + "STATUSEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


# --- a step writes only its own spec folder in the specs repo ---------------
#
# 366's implement created two specs beside its own and deleted them again
# on its branch; the creations landed, other runs built on them, and the
# deletion landed on top of that work (2026-09-03). Under the specs root,
# nothing but the spec's own folder (and its archive/ twin) may change;
# foreign changes are discarded before the commit and the step is a
# scope violation naming them.
def specs_foreign_folder_claude(fake_claude, workspace):
    """A stand-in analyze step that also makes a spec folder of its own
    beside the one it was given."""
    folder = workspace["folder"]
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'mkdir -p "$specs/999-made-by-the-run" && echo "# 999" > "$specs/999-made-by-the-run/1-description.md"\n'
        + f'echo "analysis" >> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
