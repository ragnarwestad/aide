#!/usr/bin/env bash
# spec-transitions.sh — the one table (core/scripts/lib/transitions.json)
# and the one function pair (spec 356) that decide whether a spec may
# move between phases and, when a move is granted, write the record of
# it. Sourced by core/scripts/aide-run-spec and core/scripts/aide-archive-
# spec; never invoked directly by a skill.
#
# may_apply_spec_transition($status_file, $event)
#   Read-only. Reads the current phase via _peek_spec_state (below —
#   not read_spec_state, spec 355's own reader, which self-heals by
#   WRITING 4-status.json; a pre-check must not write on the strength of
#   being asked), looks up [phase, event] in transitions.json, and
#   evaluates the row's named condition (if any) via
#   check_transition_condition, which a
#   caller may override/extend to reach its own condition-check code
#   (the dependency gate's resolve_dependency_folder and
#   dependency_branch_unmerged_on_origin, defined in aide-run-spec, not
#   here). On refusal sets $transition_refusal/$transition_message
#   (the row's own literal text, %s already substituted with the spec
#   folder) and returns 1. Never writes.
#
# apply_spec_transition($status_file, $event, [$value])
#   Writes the event's own prose stamp — the "Workflow steps completed"
#   line for create/analyze/implement (with $value as the new
#   comma-separated list, computed by the caller's own existing
#   completed_steps_for), the "**Archived:**" line for archive, or the
#   "**Reopened:**"/"**Reset:**" line with its boundary commit for
#   reopen/reset ($value = the boundary sha) — then mirrors it into
#   4-status.json via write_spec_state (spec 355). This is the one place
#   any of those four writes happens (REQ-2): a caller that wants a
#   pre-check without writing calls may_apply_spec_transition instead.
#   Does NOT re-run may_apply_spec_transition's condition checks — the
#   phase/event gate is the pre-check's job, run before the step starts;
#   by the time a step's outcome is being recorded here the step already
#   ran, and a write that recorded today unconditionally must keep doing
#   so (REQ-8), not refuse on a gate that has already had its say.

_spec_transitions_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRANSITIONS_JSON="${TRANSITIONS_JSON:-$_spec_transitions_lib_dir/transitions.json}"
# shellcheck source=/dev/null
[ -f "$_spec_transitions_lib_dir/spec-state.sh" ] && source "$_spec_transitions_lib_dir/spec-state.sh"

# current_phase_from($state_json) — prints the phase name. The `closed`
# stamp decides first, then `archived`: both are written (aide-close-spec,
# aide-archive-spec) before completedPhases ever gains the matching step,
# so a spec mid-close/mid-archive already reads as such the moment its
# stamp exists. Falling back to completedPhases membership (not "last
# element": the array is not guaranteed ordered) for the three phases
# before that.
current_phase_from() {
  local json="$1" closed archived completed
  closed="$(jq -r '.closed' <<<"$json" 2>/dev/null)"
  if [ -n "$closed" ] && [ "$closed" != "null" ]; then
    printf 'closed'
    return
  fi
  archived="$(jq -r '.archived' <<<"$json" 2>/dev/null)"
  if [ -n "$archived" ] && [ "$archived" != "null" ]; then
    printf 'archived'
    return
  fi
  completed="$(jq -r '(.completedPhases // []) | join(",")' <<<"$json" 2>/dev/null)"
  case ",$completed," in
    *,implement,*) printf 'implemented' ;;
    *,analyze,*) printf 'analyzed' ;;
    *) printf 'created' ;;
  esac
}

# check_transition_condition($condition, $status_file) — dispatches to a
# function named check_transition_condition_<condition>, when the caller
# has defined one (aide-run-spec defines check_transition_condition_
# dependencyArchived, using its own resolve_dependency_folder and
# dependency_branch_unmerged_on_origin). A condition named in the table
# with no such function defined is treated as satisfied: the table can
# name a condition no caller of a GIVEN script needs to re-check because
# it is already enforced elsewhere (the archive row's acceptance/test-
# record checks, which stay standalone in aide-archive-spec per
# 2-analysis.md).
check_transition_condition() {
  local condition="$1" status_file="$2"
  [ "$condition" = "null" ] || [ -z "$condition" ] && return 0
  local fn="check_transition_condition_$condition"
  if declare -f "$fn" >/dev/null 2>&1; then
    "$fn" "$status_file"
    return $?
  fi
  return 0
}

# _peek_spec_state($status_file) — sets $state_json, read-only: the
# existing 4-status.json when there is one, else a value derived
# in-memory from 4-status.md's own prose (the same fields
# write_spec_state's cold-start branch derives), without ever writing
# either file. read_spec_state (spec 355) self-heals by WRITING
# 4-status.json the first time it is asked — the right behavior for a
# caller about to use the state, wrong for a pre-check that REQ-3
# requires to leave both files byte-for-byte unchanged on a refusal.
_peek_spec_state() {
  local status_file="$1" state_file
  state_file="$(_spec_state_file_for "$status_file")"
  if [ -f "$state_file" ]; then
    state_json="$(cat "$state_file" 2>/dev/null || echo '{}')"
    return
  fi
  local prose_line completed_json archived_json closed_json
  prose_line="$(sed -n 's/^-[[:space:]]*\*\*Workflow steps completed:\*\*//p' "$status_file" 2>/dev/null | tail -1)"
  completed_json="$(printf '%s' "$prose_line" | \
    jq -R -s -c 'split(",") | map(gsub("^[ \t`]+|[ \t`]+$";"")) | map(select(length>0))')"
  archived_json="$(_spec_state_archived_json "$status_file")"
  closed_json="$(_spec_state_closed_json "$status_file")"
  state_json="$(jq -cn --argjson c "$completed_json" --argjson a "$archived_json" --argjson cl "$closed_json" \
    '{completedPhases:$c, archived:$a, closed:$cl, reopened:null, acceptanceCriteria:[], phaseCounts:{}}')"
}

may_apply_spec_transition() {   # $1 = status_file, $2 = event
  local status_file="$1" event="$2"
  transition_refusal=""; transition_message=""
  command -v jq >/dev/null 2>&1 || { transition_refusal="no-jq"; transition_message="jq is required"; return 1; }
  _peek_spec_state "$status_file"
  local phase; phase="$(current_phase_from "$state_json")"

  local row; row="$(jq -c --arg p "$phase" --arg e "$event" \
    '.rows[] | select(.phase == $p and .event == $e)' "$TRANSITIONS_JSON" 2>/dev/null)"
  local spec_label; spec_label="$(basename "$(dirname "$status_file")")"
  if [ -z "$row" ]; then
    transition_refusal="no-such-move"
    transition_message="$spec_label has no $event move from $phase"
    return 1
  fi

  local refusal; refusal="$(jq -r '.refusal' <<<"$row")"
  if [ "$refusal" != "null" ]; then
    transition_refusal="$(jq -r '.refusal.reason' <<<"$row")"
    local template; template="$(jq -r '.refusal.message' <<<"$row")"
    # shellcheck disable=SC2059  # the refusal message is a printf template with one %s
    transition_message="$(printf "$template" "$spec_label")"
    return 1
  fi

  local condition; condition="$(jq -r '.condition' <<<"$row")"
  if ! check_transition_condition "$condition" "$status_file"; then
    [ -n "$transition_refusal" ] || transition_refusal="condition-failed"
    [ -n "$transition_message" ] || transition_message="$spec_label does not satisfy $condition"
    return 1
  fi
  return 0
}

# write_phase_stamp($status_file, $kind, $value) — formats and writes
# exactly the prose grammar completed_steps_for/work_round_boundary_in
# (aide-run-spec) already parse, so no reader elsewhere has to change.
# $kind is one of: workflow-line (create/analyze/implement/archive's own
# entry on the "Workflow steps completed" line, $value = the new
# comma-separated list), archived (the "**Archived:**" stamp, no
# $value needed), closed (the "**Closed:**" stamp, $value = the reason
# typed by the person closing it), reopened/reset (the boundary mark,
# $value = the boundary sha). Deliberately NOT keyed on the table's event name:
# "archive" the EVENT and "archive" appearing in the workflow-steps list
# are two different writes at two different times (aide-archive-spec
# writes the stamp before the move; aide-run-spec's own post-step
# bookkeeping adds "archive" to the list afterward), so the caller names
# which write it means.
write_phase_stamp() {
  local status_file="$1" kind="$2" value="${3:-}"
  case "$kind" in
    reopened|reset)
      local mark today
      [ "$kind" = "reopened" ] && mark="Reopened" || mark="Reset"
      today="$(date -u +%Y-%m-%d)"
      # shellcheck disable=SC2016  # the backticks are markdown, printed as they are
      printf '\n- **%s:** %s (history before `%s` does not count)\n' \
        "$mark" "$today" "$value" >> "$status_file"
      ;;
    archived)
      local today; today="$(date -u +%Y-%m-%d)"
      printf '\n**Archived:** %s\n' "$today" >> "$status_file"
      ;;
    closed)
      local today; today="$(date -u +%Y-%m-%d)"
      printf '\n**Closed:** %s — %s\n' "$today" "$value" >> "$status_file"
      ;;
    workflow-line)
      [ -n "$value" ] || return 0
      if grep -qE '^- \*\*(Workflow steps completed|Task|TODO):\*\*' "$status_file" 2>/dev/null; then
        local tmp; tmp="$(mktemp)"
        awk -v line="- **Workflow steps completed:** $value" '
          BEGIN { written = 0 }
          /^- \*\*Workflow steps completed:\*\*/ {
            if (!written) { print line; written = 1 }
            next
          }
          !written && /^- \*\*(Task|TODO):\*\*/ { print; print line; written = 1; next }
          { print }
        ' "$status_file" > "$tmp" 2>/dev/null
        if [ -s "$tmp" ] && ! cmp -s "$tmp" "$status_file"; then
          cat "$tmp" > "$status_file"
        fi
        rm -f "$tmp"
      fi
      ;;
  esac
}

# write_round_boundary_stamp($status_file, $specs_root, [$sha]) — spec 471: the
# moment a round is mechanically known to be held back (aide-archive-
# spec's own acceptance-criteria-unticked decline), stamped once, in the
# same "**Reopened:**"/"**Reset:**" grammar write_phase_stamp already
# writes above — so a later round can tell which open AC-n rows are
# unchanged since THIS round rather than since the spec's birth, by
# diffing 1-description.md's own text at this commit against today's.
#
# Idempotent against a repeat decline of the SAME round: reads the
# newest existing "**Round boundary:**" entry (if any) and writes
# nothing when its own sha already equals $specs_root's current HEAD —
# a spec archived-and-declined twice with nothing changed in between
# gets one boundary, not two. Otherwise appended, never replaced: a
# spec declined across several real rounds keeps every earlier
# boundary, and (matching archiveHeldBackReason's own "last one wins"
# rule) only the LAST is read.
#
# $sha names the commit to stamp; without it the specs repository's HEAD
# is used, as for a decline. A keep-Reopen stamps the commit the round
# starts from (apply_spec_transition's reopen-keep event).
write_round_boundary_stamp() {
  local status_file="$1" specs_root="$2" head existing
  head="${3:-$(git -C "$specs_root" rev-parse --short HEAD 2>/dev/null)}"
  [ -n "$head" ] || return 0
  # shellcheck disable=SC2016  # the backticks are markdown, matched as they are
  existing="$(sed -n 's/.*[Rr]ound boundary:\*\*[^`]*`\([0-9a-fA-F]\{7,40\}\)`.*/\1/p' \
    "$status_file" 2>/dev/null | tail -1)"
  [ "$existing" = "$head" ] && return 0
  # shellcheck disable=SC2016  # the backticks are markdown, printed as they are
  printf '\n- **Round boundary:** %s (history before `%s` does not count)\n' \
    "$(date -u +%Y-%m-%d)" "$head" >> "$status_file"
}

# untick_failed_acceptance_rows($status_file) — spec 510: in the
# `## Acceptance criteria` section, a row whose Status cell reads Failed
# (with or without its symbol) gets `⬜` in its place. The cell's padding,
# the Notes cell and every other line stay byte for byte, so the row keeps
# its `Failed:` note and a new round can tell it changed.
untick_failed_acceptance_rows() {
  local status_file="$1" tmp
  [ -f "$status_file" ] || return 0
  tmp="$(mktemp)"
  LC_ALL=C awk '
    /^## / { in_acc = (tolower($0) ~ /^## acceptance/) ? 1 : 0 }
    in_acc && /^\|.*\|[ \t]*$/ {
      n = split($0, cells, "|")
      if (n == 5) {
        mark = cells[3]
        gsub(/^[ \t]+|[ \t]+$/, "", mark)
        if (tolower(mark) ~ /^([^ ]+ )?failed$/) {
          pad_l = cells[3]; sub(/[^ \t].*$/, "", pad_l)
          pad_r = cells[3]; sub(/^.*[^ \t]/, "", pad_r)
          print cells[1] "|" cells[2] "|" pad_l "⬜" pad_r "|" cells[4] "|" cells[5]
          next
        }
      }
    }
    { print }
  ' "$status_file" > "$tmp" 2>/dev/null
  if [ -s "$tmp" ] && ! cmp -s "$tmp" "$status_file"; then
    cat "$tmp" > "$status_file"
  fi
  rm -f "$tmp"
}

# apply_spec_transition($status_file, $event, $value) — the convenience
# wrapper for the single-path case: reopen and reset, the only two
# events where the stamp write and the state-file mirror happen at the
# SAME status_file path with nothing (a git-mv, a second script) in
# between. create/analyze/implement/archive write at two different
# points or two different paths (aide-run-spec's phase-append,
# aide-archive-spec's stamp-and-move) and call write_phase_stamp/
# write_spec_state directly instead — see each call site's own comment.
#
# "reopen-keep" is a function-level event, not a row of transitions.json:
# the phase a keep-Reopen ends in is whatever the kept files say (the
# state file's completedPhases minus `archive`), which a static `next`
# cannot name. It takes `archive` off the steps line and off
# completedPhases, and appends a `**Round boundary:**` stamp ($value = the
# sha it counts from, default the repository's HEAD). The `**Archived:**`
# or `**Closed:**` line stays as the trail; the stamp after it is what
# makes it history (spec-state.sh).
apply_spec_transition() {   # $1 = status_file, $2 = event ("reopen"|"reset"|"reopen-keep"), $3 = value (the boundary sha)
  local status_file="$1" event="$2" value="${3:-}"
  if [ "$event" = "reopen-keep" ]; then
    untick_failed_acceptance_rows "$status_file"
    _peek_spec_state "$status_file"
    local kept
    kept="$(jq -r '(.completedPhases // []) | map(select(. != "archive")) | join(",")' <<<"$state_json" 2>/dev/null)"
    [ -n "$kept" ] && write_phase_stamp "$status_file" workflow-line "${kept//,/, }"
    write_round_boundary_stamp "$status_file" "$(dirname "$status_file")" "$value"
    # "," is the "empty list" override (see below); an empty $kept must not
    # fall through to "preserve the existing value".
    write_spec_state "$status_file" "${kept:-,}"
    return
  fi
  local kind="$event"
  [ "$event" = "reopen" ] && kind="reopened"
  write_phase_stamp "$status_file" "$kind" "$value"
  # "," is not a valid override VALUE (split(",") of it yields nothing
  # but empty strings, filtered away) — it is how an override of "reset
  # completedPhases to empty" is told apart from write_spec_state's own
  # "" meaning "no override given, preserve the existing value" (spec
  # 355's ${2:-} default). A reopened/reset spec starts its new round
  # with nothing completed yet.
  write_spec_state "$status_file" ","
}
