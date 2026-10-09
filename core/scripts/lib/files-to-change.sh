#!/usr/bin/env bash
# files-to-change.sh — sourced by aide-spec-overlap and aide-wiki.
#
# Reading the `### Files to change` list of a spec's 2-analysis.md: the
# newest round of the file, the lines under a heading, and a list of bare
# paths as JSON.

# The file from its last `## Round N` heading to the end; all of it without one.
newest_round() {
  local from
  from="$(grep -n '^## Round [0-9][0-9]*' "$1" 2>/dev/null | tail -1 | cut -d: -f1)"
  tail -n +"${from:-1}" "$1" 2>/dev/null
}

# The lines under `### <heading>`, up to the next heading of any level.
section() {
  awk -v h="### $1" '$0 == h { on = 1; next } /^#+ / { on = 0 } on { print }'
}

# A list of bare paths (stdin) as a JSON array, in the order written, once each.
paths_json() {
  jq -R -s -c '
    split("\n")
    | map(capture("^\\s*-\\s*`(?<p>[^`]+)`")? | .p | sub("^\\./"; "") | sub(":[0-9]+(-[0-9]+)?$"; ""))
    | reduce .[] as $x ([]; if index([$x]) then . else . + [$x] end)'
}
