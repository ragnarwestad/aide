#!/usr/bin/env bash
# run-spec-code-landing.sh — how this project lands its code.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were. Split out 2026-09-04: the
# script had reached 2925 lines, five times the next largest file in
# the repo, and no reader could hold it.
# --- how this project lands its code ----------------------------------------
# `codeLanding: pr` in the committed manifest says the project's code is
# reviewed before it reaches the default branch (spec 220). It forces
# `--push pr`, because the two halves have to travel together: the
# dashboard stops merging the code root for such a project, and a branch
# left open with no pull request describing it is worse than either
# behaviour on its own.
#
# A DEFAULT, never an override — a `--push` typed at a terminal is
# somebody saying what they want, and a file quietly overruling it is a
# run nobody can steer. Read after `project_root` rather than beside the
# `--push` validation above, because that is the first line at which
# there is a repository root to read a manifest out of; the flag's own
# spellings are validated before this and are unaffected by it.
#
# The manifest and nothing else, deliberately: `.aide/config` is
# gitignored, and a review policy one machine can shadow in silence is
# not a policy. `resolveCodeLanding` in dashboard/src/discover.ts is the
# other half of this pair, and
# tests/fixtures/code-landing-precedence.json is the table both are
# checked against.
if [ "$push_mode_explicit" = "no" ] && declare -f aide_manifest_get >/dev/null 2>&1; then
  code_landing="$(aide_manifest_get codeLanding "$project_root")"
  if [ "$code_landing" = "pr" ]; then
    push_mode="pr"
    echo "aide-run-spec: codeLanding: pr in project.yaml — pushing a pull request" >&2
  fi
fi

# The specs root is usually a DIFFERENT repository (AIDE_SPECS_PATH): it
# is where analyze actually writes, so every check below covers both
# roots, not just the project.
if declare -f aide_specs_root >/dev/null 2>&1; then
  specs_root="$(aide_specs_root "$project_root")"
else
  specs_root="$project_root/specs"
fi
[ -d "$specs_root" ] || refuse "no specs root at $specs_root"
# Resolved, because everything below compares it with `git rev-parse
# --show-toplevel`'s answer BY TEXT to work out where inside the specs
# repository this root sits. git resolves symlinks and a configured path
# usually does not: on macOS `$TMPDIR` is `/var/folders/...`, a link to
# `/private/var/folders/...`, so the prefix never matched, the whole
# absolute path was taken for the part inside the repo, and a spec folder
# landed under `<repo>/var/folders/.../<repo>/NN-slug`.
specs_root="$(cd "$specs_root" 2>/dev/null && pwd -P || printf '%s' "$specs_root")"

# Computed here rather than after the resolver below: the archive
# fallback in it asks origin, in every root, whether a spec's branch is
# still open. Neither line reads $spec_folder or $spec_arg, so the move
# is an ordering change and nothing else.
specs_repo="$(git -C "$specs_root" rev-parse --show-toplevel 2>/dev/null || true)"

roots=("$project_root")
[ -n "$specs_repo" ] && [ "$specs_repo" != "$project_root" ] && roots+=("$specs_repo")

spec_folder=""
spec_folder_archived="no"
if [ -d "$specs_root/$spec_arg" ]; then
  spec_folder="$spec_arg"
else
  for candidate in "$specs_root"/*/; do
    base="$(basename "$candidate")"
    case "$base" in "$spec_arg"-*) spec_folder="$base"; break ;; esac
  done
fi

# The way out of an unlanded spec (spec 202). An `archive` step whose
# landing never finished leaves the folder under `archive/` — its own
# Step 5 moved it — with the branch still on origin, and the dashboard
# offers Archive again for exactly that row. Resolved here, that row is
# recoverable without anything typed in a terminal.
#
# Gated twice, and both gates matter. On the literal string `archive`,
# like every other archive-only exception in this script: an archived
# spec is finished work, and no other step may resolve one. And on the
# branch still being on origin: a spec that DID land has nothing left to
# archive, and is reported as such by `already_landed` below — before any
# money is spent, and told apart from a name that does not exist at all
# (spec 211).
#
# The fourth "try the active folder, then try archive/" in this codebase
# (aide_resolve_spec, resolve_dependency_folder, status_file_for), and
# duplicated rather than shared for the same reason those three are.
if [ -z "$spec_folder" ] && [ "$command_name" = "archive" ] && [ -d "$specs_root/archive" ]; then
  archived_candidate=""
  if [ -d "$specs_root/archive/$spec_arg" ]; then
    archived_candidate="$spec_arg"
  else
    for candidate in "$specs_root/archive"/*/; do
      base="$(basename "$candidate")"
      case "$base" in "$spec_arg"-*) archived_candidate="$base"; break ;; esac
    done
  fi
  if [ -n "$archived_candidate" ]; then
    # ls-remote, not the remote-tracking refs: a merged-and-deleted
    # branch leaves a stale ref behind in every checkout that ever
    # fetched it, and believing one here would re-open a spec that is
    # genuinely done.
    for root in "${roots[@]}"; do
      if [ -n "$(git -C "$root" ls-remote --heads origin "refs/heads/aide/$archived_candidate" 2>/dev/null)" ]; then
        spec_folder="$archived_candidate"
        break
      fi
    done
    # Every root answered, and none of them has the branch: the spec is
    # finished, not missing (spec 211). Left to fall through, this got
    # the same "unknown spec" refusal below that a typo gets — the folder
    # is right there under archive/ and the runner called it unknown.
    # Told apart here, and only here: a candidate found nowhere never
    # reaches this line, so a typo is still a typo.
    if [ -z "$spec_folder" ]; then
      already_landed "$archived_candidate"
    fi
  fi
fi

# One step looks in the archive, and it is the step that exists to take a
# spec back out of it (spec 198). An archived spec is otherwise not
# runnable at all — "unknown spec" is the right answer for every other
# command — so this is a named exemption, the way `create` is the named
# exemption from "the folder must already exist", and never a general
# relaxation of the gate.
#
# The folder is recorded WITHOUT its `archive/` prefix. The branch, the
# worktree and the commit subject are all named after $spec_label, and an
# `aide/archive/<slug>` branch is a different spec as far as every reader
# of the commit grammar is concerned. Where the folder actually stands is
# a question `status_file_for` below already answers on its own, by
# trying both addresses.
if [ -z "$spec_folder" ] && [ "$command_name" = "reopen" ] && [ -d "$specs_root/archive" ]; then
  for candidate in "$specs_root/archive"/*/; do
    base="$(basename "$candidate")"
    case "$base" in "$spec_arg" | "$spec_arg"-*) spec_folder="$base"; spec_folder_archived="yes"; break ;; esac
  done
fi
# A `create` step is the one that MAKES the folder, so it is the one
# step for which "no such folder" is the normal case rather than a
# refusal (spec 93; spec 87 named this and left it alone). What it gets
# instead is a caller-supplied tracking key — the branch and the worktree
# are named after it, and nothing else is. It is NOT a folder name, and
# nothing here may turn it into one: the rule that decides a spec's
# number and slug lives in /aide-create's own skill run and nowhere else,
# which is what keeps this from repeating spec 82's mistake of one rule
# written down twice.
if [ -z "$spec_folder" ] && [ "$command_name" = "create" ]; then
  [[ "$spec_arg" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || refuse "invalid --spec: $spec_arg"
  # Refused here, before a worktree exists, like every other required
  # argument — a create without these two has nothing to create.
  [ -n "$title" ] || refuse "missing --title (required for create)"
  [ -n "$description" ] || refuse "missing --description (required for create)"
elif [ -z "$spec_folder" ] && [ "$command_name" = "schedule" ]; then
  # A second, unrelated exemption from "the folder must already exist"
  # (spec 259) — not a copy of `create`'s, which is a different shape
  # entirely: a schedule entry never becomes a spec folder, so its
  # tracking key names only a branch and a worktree, for as long as the
  # entry exists.
  [[ "$spec_arg" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || refuse "invalid --spec: $spec_arg"
  [ -n "$prompt_file" ] || refuse "missing --prompt-file (required for schedule)"
else
  [ -n "$spec_folder" ] || refuse "unknown spec: $spec_arg (not under $specs_root)"
fi
spec_id="${spec_folder%%-*}"
# What the branch, the worktree and the commit message are named after:
# the real folder when there is one, the tracking key while there is not.
spec_label="${spec_folder:-$spec_arg}"

# `reopen` exists to bring a spec back OUT of archive/ — a spec the
# resolver above found active is not its target, only a stale board row
# or a run started by hand against the wrong spec (spec 270: this is
# what let a running round's files get reset and its branch deleted on
# 2026-08-27). Checked here, before anything below touches a worktree or
# a branch — in particular before the branch-deletion block a few
# hundred lines down, which `refuse`'s own `exit 2` never lets the run
# reach.
if [ "$command_name" = "reopen" ] && [ "$spec_folder_archived" != "yes" ]; then
  refuse "$spec_folder is already active — nothing to reopen"
fi

# A run reaches its project and its specs root, and nothing else.
# --extra-project-dir named a third repo to watch, branch, commit and
# push alongside them (spec 83, after spec 81's implement wrote into a
# repository nobody had told the run about). The dashboard's tick box
# for it went unused by every one of the 200 jobs the queue held, so
# box, field and flag are gone together. A spec that has to change two
# projects needs the naming built back, deliberately.

