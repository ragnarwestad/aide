#!/usr/bin/env bash
# The human-facing name of a numbered spec. Machine-facing paths, branches,
# commits and record fields keep the complete folder name.

aide_spec_reference() {
  local project="$1" folder="$2" number
  number="$(printf '%s' "$folder" | sed -n 's/^\([0-9][0-9]*\)\(-.*\)\{0,1\}$/\1/p')"
  [ -n "$number" ] || number="$folder"
  printf '%s:%s' "$project" "$number"
}
