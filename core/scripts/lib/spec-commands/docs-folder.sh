#!/usr/bin/env bash
# The folder of the spec aide-generate-html and aide-generate-pdf write
# from. Needs _aide-spec-lib.sh sourced first.

# Sets SPECS_ROOT, DOCS_DIR and ISSUE_ID (the folder's own name: a spec
# under archive/ resolves with that prefix, and a slash in a file name
# breaks mktemp and the output path). With no such folder, prints where
# it looked and what is there, and exits 1.
aide_spec_docs_folder_or_exit() {   # <issue-id>
  local full_id d
  SPECS_ROOT="$(aide_specs_root)"
  full_id="$(aide_resolve_spec "$1" "$SPECS_ROOT")"
  DOCS_DIR="$SPECS_ROOT/$full_id"
  if [ -z "$full_id" ] || [ ! -d "$DOCS_DIR" ]; then
    echo -e "\033[0;31m❌ Error: No documentation found for: $1\033[0m"
    echo ""
    echo "Searched in: $SPECS_ROOT"
    echo ""
    echo "Tips:"
    echo "  - Has the spec been created (on the board, or with aide create)?"
    echo "  - Check AIDE_SPECS_PATH in .aide/config in the project root"
    echo ""
    echo "Available folders:"
    for d in "$SPECS_ROOT"/[0-9]*-*/; do [ -d "$d" ] && basename "$d"; done | head -10
    exit 1
  fi
  ISSUE_ID="${full_id##*/}"
}
