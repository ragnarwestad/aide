#!/usr/bin/env bash
# Delte hjelpefunksjoner for aide-generate-pdf og aide-generate-html.
# Source-es av begge fra samme katalog:
#   SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
#   source "$SCRIPT_DIR/_aide-report-lib.sh"
#
# Flat struktur: alle saker ligger som <NN>-slug/ direkte under reports-root
# (samme for JIRA og TODO; JIRA-nøkkelen er en del av sluggen).

# Finn reports-root: 1) AIDE_REPORTS_PATH, 2) <install>/reports, 3) reports/
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

# Resolve input til mappenavn under reports-root. Echoer mappenavnet, ev. tomt.
# Input: NN | todo-NN | PROJ-XXXX | full <NN>-slug
aide_resolve_report() {
  local input="$1" root="$2" dir="" num
  if [ -d "$root/$input" ]; then
    dir="$input"                                          # direkte full-ID-match
  elif echo "$input" | grep -qE '^PROJ-[0-9]+$'; then
    # JIRA: nøkkelen er en del av sluggen
    dir=$(find "$root" -maxdepth 1 -type d -iname "*${input}*" 2>/dev/null | head -1 | xargs basename 2>/dev/null)
  elif echo "$input" | grep -qE '^(todo-)?[0-9]+$'; then
    # Nummer-shorthand ("27", "05" eller "todo-27"); base-10 unngår oktal-feil
    num=$(echo "$input" | sed 's/^todo-//')
    dir=$(find "$root" -maxdepth 1 -type d -name "$(printf '%02d' "$((10#$num))")-*" 2>/dev/null | head -1 | xargs basename 2>/dev/null)
  else
    dir="$input"                                          # anta full mappe-ID
  fi
  echo "$dir"
}

# JIRA-sak vs TODO-plan basert på mappenavn
aide_doc_type() {
  if echo "$1" | grep -qi "PROJ-"; then echo "JIRA-sak"; else echo "TODO-plan"; fi
}

# Lesbart navn fra mappe-ID (NN-slug → Title Case)
get_display_name() {
  local id="$1" slug
  if [[ "$id" =~ ^[0-9]+-(.+)$ ]]; then
    slug="${BASH_REMATCH[1]}"
    echo "$slug" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2));}1'
  else
    echo "$id"
  fi
}
