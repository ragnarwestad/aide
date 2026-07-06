#!/usr/bin/env bash
# Shared helper functions for aide-generate-pdf and aide-generate-html.
# Sourced by both from the same directory:
#   SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
#   source "$SCRIPT_DIR/_aide-report-lib.sh"
#
# Flat structure: all issues live as <NN>-slug/ directly under the reports root
# (same for JIRA and TODO; the JIRA key is part of the slug).

# Find the reports root: 1) AIDE_REPORTS_PATH, 2) <install>/reports, 3) reports/
aide_reports_root() {
  if [ -n "$AIDE_REPORTS_PATH" ]; then
    echo "$AIDE_REPORTS_PATH"
    return
  fi
  local lib_dir install_root
  lib_dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
  install_root="$(dirname "$lib_dir")"
  if [ -d "$install_root/reports" ]; then
    echo "$install_root/reports"
  else
    echo "reports"
  fi
}

# Resolve input to a folder name under the reports root. Echoes the folder name, possibly empty.
# Input: NN | todo-NN | PROJ-XXXX | full <NN>-slug
aide_resolve_report() {
  local input="$1" root="$2" dir="" num
  if [ -d "$root/$input" ]; then
    dir="$input"                                          # direct full-ID match
  elif echo "$input" | grep -qE '^PROJ-[0-9]+$'; then
    # JIRA: the key is part of the slug
    dir=$(find "$root" -maxdepth 1 -type d -iname "*${input}*" 2>/dev/null | head -1 | xargs basename 2>/dev/null)
  elif echo "$input" | grep -qE '^(todo-)?[0-9]+$'; then
    # Number shorthand ("27", "05" or "todo-27"); base 10 avoids octal errors
    num=$(echo "$input" | sed 's/^todo-//')
    dir=$(find "$root" -maxdepth 1 -type d -name "$(printf '%02d' "$((10#$num))")-*" 2>/dev/null | head -1 | xargs basename 2>/dev/null)
  else
    dir="$input"                                          # assume full folder ID
  fi
  echo "$dir"
}

# JIRA issue vs TODO plan based on the folder name
aide_doc_type() {
  if echo "$1" | grep -qi "PROJ-"; then echo "JIRA issue"; else echo "TODO plan"; fi
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
