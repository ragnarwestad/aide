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
