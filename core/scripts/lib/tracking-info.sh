#!/usr/bin/env bash
# lib/tracking-info.sh — reading and writing the bullets in a spec file's
# `## Tracking info`, which the runner decides by.
#
# Sourced by aide-run-spec beside _aide-spec-lib.sh, before the first phase of
# the run, because run-spec/setup/invocation.sh (the analyze prompt) reads a
# description's Tracking info before any worktree exists and
# run-spec/record/sent-back-check.sh and run-spec/record/short-analysis-check.sh
# read the files the turn left. core/tests/fixtures/analysis-line.json and
# core/tests/fixtures/sent-back-line.json are the tables of cases the
# dashboard's parsePhaseOutcome reads too.

# The value after `- **<label>:**` in the Tracking info of a spec file; empty
# when there is none. Scoped to `## Tracking info` like the writer's own awk.
#   tracking_info_field <file> <label>
tracking_info_field() {
  awk -v label="$2" '
    /^## / { on = ($0 == "## Tracking info"); next }
    on {
      prefix = "- **" label ":**"
      if (index($0, prefix) == 1) { v = substr($0, length(prefix) + 1); sub(/^[ \t]+/, "", v); print v; exit }
    }' "$1" 2>/dev/null
}

# Whether the analysis a 2-analysis.md records is `short` or `full`: only a
# lower-case `short`, then the end or a non-word character, is short; no
# bullet, or any other value, is full.
#   spec_analysis <2-analysis file>
spec_analysis() {
  local value short_re='^short([^[:alnum:]_]|$)'
  value="$(tracking_info_field "$1" "Analysis")"
  if [[ "$value" =~ $short_re ]]; then echo "short"; else echo "full"; fi
}

# Record that implement sent a spec back to a full analysis: drop any
# "Sent back to a full analysis:" line in the description, and write the new
# one directly after its "Let me choose the approach:" line, else its
# "Acceptance criteria checks:" line, else its "Created:" line. Fails,
# writing nothing, when there is no Created line. The sentence reaches awk
# through the environment, so a backslash in it stays as written.
#   record_sent_back <description-file> <sentence>
record_sent_back() {
  local file="$1" anchor tmp
  [ -f "$file" ] || return 1
  grep -q '^[[:space:]]*-[[:space:]]*\*\*Created:\*\*' "$file" || return 1
  anchor='Created'
  grep -q '^[[:space:]]*-[[:space:]]*\*\*Acceptance criteria checks:\*\*' "$file" && anchor='Acceptance criteria checks'
  grep -q '^[[:space:]]*-[[:space:]]*\*\*Let me choose the approach:\*\*' "$file" && anchor='Let me choose the approach'
  tmp="$(mktemp "${file}.XXXXXX")" || return 1
  SENT_BACK_SENTENCE="$2" awk -v anchor="**$anchor:**" '
    /^[[:space:]]*-[[:space:]]*\*\*Sent back to a full analysis:\*\*/ { next }
    { print }
    !done && /^[[:space:]]*-[[:space:]]*\*\*/ && index($0, anchor) {
      print "- **Sent back to a full analysis:** " ENVIRON["SENT_BACK_SENTENCE"]; done = 1
    }
  ' "$file" > "$tmp" || { rm -f "$tmp"; return 1; }
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

# The time from an epoch to now (AIDE_NOW_EPOCH, when a test hands in the
# clock), as `NmSSs`. Fails, printing nothing, for an epoch in the future.
#   session_time_spent <start-epoch>
session_time_spent() {
  local elapsed=$(( ${AIDE_NOW_EPOCH:-$(date +%s)} - $1 ))
  [ "$elapsed" -ge 0 ] || return 1
  printf '%dm%02ds' $(( elapsed / 60 )) $(( elapsed % 60 ))
}

# Write `- **Model:**` (when a model is given) and `- **Time spent:**` right
# under `## Tracking info` and the blank line after it, after removing the
# bullets of that section named in <fields>, a `|`-separated list of labels
# (`Model|Time spent`). Anything else in the section stays. Fails, writing
# nothing, when the file has no such heading.
#
# The block is passed to awk in a file: the macOS awk rejects a newline
# inside a -v value.
#   stamp_model_and_time_spent <file> <model> <time-spent> <fields>
stamp_model_and_time_spent() {
  local file="$1" model="$2" time_spent="$3" fields="$4" block_file
  grep -q '^## Tracking info' "$file" 2>/dev/null || return 1
  block_file="$(mktemp)" || return 1
  [ -n "$model" ] && printf -- '- **Model:** %s\n' "$model" >> "$block_file"
  printf -- '- **Time spent:** %s\n' "$time_spent" >> "$block_file"
  awk -v block="$block_file" -v fields="$fields" '
    function emit_block(  ln) { while ((getline ln < block) > 0) print ln; close(block) }
    BEGIN { stale = "^- \\*\\*(" fields "):\\*\\*" }
    /^## Tracking info/ {
      print; in_tracking = 1
      if ((getline nextline) > 0) {
        if (nextline ~ /^[ \t]*$/) { print nextline; emit_block() } else { held = nextline; has_held = 1; emit_block() }
      } else { emit_block() }
      # The held line goes through the same filter as any other line of
      # the section: a hand-edited file with no blank line after the
      # heading must not let a stale bullet escape because it was read ahead.
      if (has_held && held !~ stale) print held
      next
    }
    in_tracking && /^## / { in_tracking = 0 }
    in_tracking && $0 ~ stale { next }
    { print }
  ' "$file" > "$file.stamp-tmp" && mv "$file.stamp-tmp" "$file" || { rm -f "$block_file" "$file.stamp-tmp"; return 1; }
  rm -f "$block_file"
}
