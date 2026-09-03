#!/usr/bin/env bash
# Shared helper functions for aide-generate-pdf and aide-generate-html.
# Sourced by both from the same directory:
#   SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
#   source "$SCRIPT_DIR/_aide-spec-lib.sh"
#
# Flat structure: all issues live as <NN>-slug/ directly under the specs root
# (same for JIRA and TODO; the JIRA key is part of the slug).

# Find the specs root for a project (spec 73: per-project config, no
# global state).
#   aide_specs_root [project-root]
# The root defaults to the git toplevel, falling back to the current
# directory. AIDE_SPECS_PATH read from <root>/.aide/config wins;
# otherwise <root>/specs. The environment variable of the same name is
# retired and deliberately ignored.
aide_specs_root() {
  local root="$1" configured
  if [ -z "$root" ]; then
    root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  fi
  configured="$(aide_config_get AIDE_SPECS_PATH "$root")"
  if [ -n "$configured" ]; then
    echo "$configured"
  else
    echo "$root/specs"
  fi
}

# Search one directory for a folder matching a find pattern; echoes the basename.
_aide_find_spec() {
  local dir="$1" flag="$2" pattern="$3"
  find "$dir" -maxdepth 1 -type d "$flag" "$pattern" 2>/dev/null | head -1 | xargs basename 2>/dev/null
}

# Resolve input to a folder name under the specs root. Echoes the folder
# name (possibly prefixed "archive/"), or nothing. Active specs win over
# archived ones with the same number.
# Input: NN | todo-NN | <JIRA-KEY> (e.g. PROJ-7637, MEL-123) | full <NN>-slug
aide_resolve_spec() {
  local input="$1" root="$2" dir="" flag="" pattern="" num
  if [ -d "$root/$input" ]; then
    echo "$input"                                         # direct full-ID match
    return
  elif echo "$input" | grep -qiE '^(todo-)?[0-9]+$'; then
    # Number shorthand ("27", "05" or "todo-27"); base 10 avoids octal errors
    num=$(echo "$input" | sed 's/^[Tt][Oo][Dd][Oo]-//')
    flag="-name"; pattern="$(printf '%02d' "$((10#$num))")-*"
  elif echo "$input" | grep -qE '^[A-Z][A-Z0-9]*-[0-9]+$'; then
    # JIRA key (any project prefix): the key is part of the slug
    flag="-iname"; pattern="*${input}*"
  else
    echo "$input"                                         # assume full folder ID
    return
  fi
  dir=$(_aide_find_spec "$root" "$flag" "$pattern")
  if [ -z "$dir" ] && [ -d "$root/archive" ]; then
    dir=$(_aide_find_spec "$root/archive" "$flag" "$pattern")
    [ -n "$dir" ] && dir="archive/$dir"
  fi
  echo "$dir"
}

# Next free spec number across the root AND archive/, zero-padded.
# Archived specs keep their number — scanning both means a number is
# never reused after its spec is archived.
aide_next_spec_number() {
  local root="$1" max
  max=$( { ls -1 "$root" 2>/dev/null; ls -1 "$root/archive" 2>/dev/null; } \
    | sed -n 's/^\([0-9][0-9]*\)-.*/\1/p' | sort -n | tail -1)
  printf '%02d\n' "$(( 10#${max:-0} + 1 ))"
}

# JIRA issue vs TODO plan based on the folder name (works for archived
# folders too, which arrive as "archive/<NN>-slug").
# JIRA folders are <NN>-<jira-key>-slug, so a key (letters, hyphen, digits)
# right after the number means JIRA. Keys deeper in the slug do not count —
# a folder like 13-upgrade-react-17-to-react-18 is a TODO plan.
aide_doc_type() {
  if echo "$1" | grep -qiE '^(archive/)?[0-9]+-[A-Za-z][A-Za-z0-9]*-[0-9]+(-|$)'; then
    echo "JIRA issue"
  else
    echo "TODO plan"
  fi
}

# Read a key from the per-project config file <project-root>/.aide/config
# (KEY=value lines, # comments). Echoes the value, or nothing if the file
# or key is missing. Usage: aide_config_get KEY [project-root]
aide_config_get() {
  local key="$1" root="${2:-.}" file
  file="$root/.aide/config"
  [ -f "$file" ] || return 0
  sed -n "s/^${key}=//p" "$file" | head -1
}

# Read a TOP-LEVEL scalar key from the project's manifest
# <project-root>/.aide/project.yaml. Echoes the value, or nothing if the
# file or the key is missing. Usage: aide_manifest_get KEY [project-root]
#
# The manifest is where a setting that travels with the REPO belongs
# (spec 184): .aide/config is dropped by a global ignore rule, so
# anything written there is lost the moment the project meets a new
# machine, while .aide/project.yaml is committed.
#
# Deliberately a sibling of aide_config_get rather than a YAML parser.
# A top-level scalar is one anchored sed away, and that is the whole
# shape this reads: `^key: value`. An indented key belongs to whatever
# block it sits under and is not this one, so the anchor is load-bearing
# rather than incidental. Nesting would need a hand-written collector —
# /bin/bash here is 3.2, with no mapfile — and a silent misparse of a
# gitignored-path list is a worktree that comes up missing what the
# project's own commands need, with nothing said about it.
aide_manifest_get() {
  local key="$1" root="${2:-.}" file
  file="$root/.aide/project.yaml"
  [ -f "$file" ] || return 0
  sed -n "s/^${key}:[[:space:]]*//p" "$file" | head -1 | sed 's/[[:space:]]*$//'
}

# Resolve a key that MAY be set in either file, `.aide/config` winning
# (spec 345) — the reverse of aide_manifest_get's own manifest-wins
# precedence for worktreeLinks. An install/test command legitimately
# differs per machine (a PATH prefix a shell needs, say), while a
# worktree link is a fact about the project itself and cannot. Echoes
# nothing if neither file sets the key.
#   aide_resolve_override CONFIG_KEY MANIFEST_KEY [project-root]
aide_resolve_override() {
  local config_key="$1" manifest_key="$2" root="${3:-.}" value
  value="$(aide_config_get "$config_key" "$root")"
  [ -n "$value" ] && { printf '%s\n' "$value"; return 0; }
  aide_manifest_get "$manifest_key" "$root"
}

# Readable name from folder ID (NN-slug → Title Case)
get_display_name() {
  local id="$1" slug
  if [[ "$id" =~ ^[0-9]+-(.+)$ ]]; then
    slug="${BASH_REMATCH[1]}"
    echo "$slug" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2));}1'
  else
    echo "$id"
  fi
}

# Origin-preferring default-branch/base-ref lookup for
# aide-resolve-test-cmd's own use only (spec 361). Self-contained and NOT
# shared with aide-run-spec's own default_branch()/base_ref_for()
# (lines ~511, ~1044 there): no requirement asks for anything in that
# script, and it carries a 6631-line test suite a "DRY" refactor would
# put at risk for no benefit this needs. A stale LOCAL branch must not
# decide what changed — origin/<branch> wins when it exists, same
# pattern aide-run-spec's own base_ref_for() already follows.
#   aide_test_scope_base_ref <project-root>
# Echoes the ref to diff against, or nothing if none could be resolved.
aide_test_scope_base_ref() {
  local root="$1" b candidate
  b="$(git -C "$root" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)"
  b="${b#origin/}"
  if [ -z "$b" ]; then
    for candidate in main master; do
      git -C "$root" show-ref --verify --quiet "refs/heads/$candidate" && { b="$candidate"; break; }
    done
  fi
  [ -n "$b" ] || b="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  [ -n "$b" ] || return 0
  if git -C "$root" show-ref --verify --quiet "refs/remotes/origin/$b"; then
    echo "origin/$b"
  else
    echo "$b"
  fi
}

# Resolves the scoped `.aide/config` keys (AIDE_TEST_SCOPE_PATHS_N /
# AIDE_TEST_SCOPE_CMD_N, spec 361) against a changed-file list, and
# echoes the command(s) that cover the whole changeset — one per line,
# in scope-DECLARATION order (never file-encounter order).
#
# The matching rule (whole-changeset, not per file in isolation):
#   1. No AIDE_TEST_SCOPE_PATHS_1 at all: echo the single legacy
#      AIDE_TEST_CMD, or the manifest's `testCmd:` when `.aide/config`
#      sets neither (spec 345), or nothing if both are unset — REQ-6,
#      unconditionally, without looking at the changed-file list.
#   2. Otherwise, classify every changed file into the scope(s) whose
#      declared paths it lies under (a directory-boundary match, never a
#      bare string prefix). A file lying under more than one scope's own
#      declared path resolves to the FIRST-declared of those scopes —
#      this tie-break is about one file matching several scope
#      DECLARATIONS at once, distinct from REQ-2's union below.
#   3. If every changed file matched at least one scope: echo the UNION
#      of every matched scope's command (REQ-2) — including when the
#      changed-file list is empty, which is vacuously "every file
#      matched", but is treated the same as step 4 below (doubt resolved
#      towards running) since an empty list is itself doubt.
#   4. If any changed file matched NO declared scope at all (or the
#      changed-file list is empty): echo EVERY declared scope's command
#      (REQ-3) — doubt, anywhere in the changeset, resolved towards
#      running everything, never towards narrowing.
#   aide_test_scope_commands <project-root> [changed-file ...]
aide_test_scope_commands() {
  local root="$1"; shift
  local -a changed_files=("$@")
  local first_paths legacy
  first_paths="$(aide_config_get AIDE_TEST_SCOPE_PATHS_1 "$root")"
  if [ -z "$first_paths" ]; then
    legacy="$(aide_resolve_override AIDE_TEST_CMD testCmd "$root")"
    [ -n "$legacy" ] && echo "$legacy"
    return 0
  fi

  local -a scope_cmds=()
  local -a scope_paths=()
  local n=1 paths cmd
  while :; do
    paths="$(aide_config_get "AIDE_TEST_SCOPE_PATHS_$n" "$root")"
    [ -n "$paths" ] || break
    cmd="$(aide_config_get "AIDE_TEST_SCOPE_CMD_$n" "$root")"
    scope_paths[$((n-1))]="$paths"
    scope_cmds[$((n-1))]="$cmd"
    n=$((n+1))
  done

  local any_unmatched="no"
  [ "${#changed_files[@]}" -eq 0 ] && any_unmatched="yes"
  local -a matched=()
  local f p idx i matched_this
  for f in ${changed_files[@]+"${changed_files[@]}"}; do
    idx=-1
    for i in "${!scope_paths[@]}"; do
      matched_this="no"
      for p in ${scope_paths[$i]}; do
        if [ "$f" = "$p" ] || [ "${f#"$p"/}" != "$f" ]; then
          matched_this="yes"
          break
        fi
      done
      if [ "$matched_this" = "yes" ]; then
        idx="$i"
        break
      fi
    done
    if [ "$idx" = "-1" ]; then
      any_unmatched="yes"
    else
      matched[$idx]="yes"
    fi
  done

  if [ "$any_unmatched" = "yes" ]; then
    for i in "${!scope_cmds[@]}"; do
      echo "${scope_cmds[$i]}"
    done
  else
    for i in "${!scope_cmds[@]}"; do
      [ "${matched[$i]:-no}" = "yes" ] && echo "${scope_cmds[$i]}"
    done
  fi
}

# The specs a spec builds on: the optional "Depends on:" line in its OWN
# 1-description.md (spec 92), echoed one identifier per line. Comma
# separated, backticks and surrounding whitespace stripped.
#   aide_spec_dependencies <specs-root> <spec-folder>
# An absent field, an empty one, or a missing file is the normal case and
# says nothing at all — same shape as aide_config_get.
aide_spec_dependencies() {
  local root="$1" folder="$2" file value
  file="$root/$folder/1-description.md"
  [ -f "$file" ] || return 0
  value="$(sed -n 's/^[[:space:]]*-[[:space:]]*\*\*Depends on:\*\*[[:space:]]*//p' "$file" | head -1)"
  [ -n "$value" ] || return 0
  echo "$value" | tr ',' '\n' | tr -d '`' \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' || true
}
