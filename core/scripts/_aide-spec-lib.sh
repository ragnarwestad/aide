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
