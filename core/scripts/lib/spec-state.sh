#!/usr/bin/env bash
# spec-state.sh — the one place a spec's machine-read state is derived
# from 4-status.md's prose and written to 4-status.json beside it
# (spec 355). Sourced by the three scripts that already own the
# machine-read lines — aide-run-spec, aide-archive-spec,
# aide-write-spec — never invoked directly by a skill or a --file
# argument. Reuses status_progress_for's row-shape/done-mark rule
# (core/scripts/lib/status-progress.sh) rather than a third
# implementation of "is this row done".
#
# write_spec_state($status_file, [$completed_phases_override])
#   Derives every field from $status_file's current prose and writes
#   $status_file with 4-status.md replaced by 4-status.json alongside
#   it, atomically (mktemp + mv, same pattern as aide-write-spec).
#   completedPhases is the one field that is NOT re-derived from prose
#   on every write: with no override, a write PRESERVES whatever
#   completedPhases the existing state file already has, and only
#   falls back to reading the prose "Workflow steps completed" line
#   once, when no state file exists yet at all (the cold-start case).
#   The override, a comma-separated list, is how aide-run-spec — the
#   only caller that ever discovers a genuinely new completed phase —
#   supplies the freshly computed value.
#
# read_spec_state($status_file)
#   Sets $state_json to the contents of 4-status.json beside
#   $status_file, self-healing (deriving it once, via write_spec_state
#   with no override) if the file does not exist yet. Never a second,
#   independently-maintained parsing path: the self-heal calls the
#   exact function every writer calls.

# shellcheck disable=SC2034  # state_json is set for the caller, not used here
_spec_state_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$_spec_state_lib_dir/status-progress.sh" ] && source "$_spec_state_lib_dir/status-progress.sh"

_spec_state_file_for() {   # $1 = status_file path; prints the sibling state-file path
  printf '%s' "${1%4-status.md}4-status.json"
}

# One pass over $1, deriving BOTH the per-heading task-row counts
# (phaseCounts) and, for whichever heading's own keyword is
# "acceptance" (case-insensitive — matches status_progress_for's own
# "Acceptance" filter), the row-by-row acceptance-criteria list. Same
# heading-match rule, same row-shape/done-mark rule, same
# header-row-undo-on-separator rule as status_progress_for — just
# collecting rows instead of only counting them, and doing every
# heading in one pass instead of one filtered call per heading.
_spec_state_phase_and_acceptance_rows() {
  local file="$1"
  [ -f "$file" ] || return 0
  LC_ALL=C awk '
    function flush(   i, mark, low, done, total, is_done) {
      if (!in_phase) return
      total = nrows
      done = 0
      for (i = 0; i < nrows; i++) {
        mark = rowMark[i]
        low = tolower(mark)
        is_done = (mark == "✅" || low == "completed" || low == "✅ completed") ? 1 : 0
        if (is_done) done++
        if (is_acceptance) printf "ACC\t%d\t%s\n", is_done, rowTask[i]
      }
      printf "PHASE\t%s\t%d\t%d\n", heading, done, total
    }
    /^## / {
      flush()
      heading = $0; sub(/^## /, "", heading)
      rest = heading
      sub(/^([Pp]hase|[Ff]ase|[Cc]hecklist|[Aa]cceptance)/, "", rest)
      in_phase = (rest != heading && rest ~ /^([^A-Za-z0-9]|$)/) ? 1 : 0
      keyword = substr(heading, 1, length(heading) - length(rest))
      is_acceptance = (tolower(keyword) == "acceptance") ? 1 : 0
      nrows = 0
      prev_counted = 0
      next
    }
    !in_phase { next }
    {
      line = $0
      gsub(/^[ \t]+|[ \t]+$/, "", line)
      if (line !~ /^\|.*\|$/) { prev_counted = 0; next }
      n = split(line, cells, "|")
      if (n != 5) { prev_counted = 0; next }
      task = cells[2]; mark = cells[3]
      gsub(/^[ \t]+|[ \t]+$/, "", task)
      gsub(/^[ \t]+|[ \t]+$/, "", mark)
      if (task == "") { prev_counted = 0; next }
      if (task ~ /^-+$/) {
        if (prev_counted) nrows--
        prev_counted = 0
        next
      }
      if (mark == "" || length(mark) > 30 || mark ~ /,/) { prev_counted = 0; next }
      rowTask[nrows] = task
      rowMark[nrows] = mark
      nrows++
      prev_counted = 1
      next
    }
    END { flush() }
  ' "$file" 2>/dev/null
}

# The `**Archived:** <date>` stamp, last match wins — mirrors
# discover/spec-files.ts's own reader on the dashboard side.
_spec_state_archived_json() {
  local file="$1" date
  date="$(sed -n 's/^[[:space:]]*-\{0,1\}[[:space:]]*\*\*Archived:\*\*[[:space:]]*\([0-9-]*\).*/\1/p' \
    "$file" 2>/dev/null | tail -1)"
  if [ -n "$date" ]; then
    jq -cn --arg d "$date" '{date:$d}'
  else
    printf 'null'
  fi
}

# The `**Reopened:**`/`**Reset:**` stamp with its boundary commit —
# same grammar and same "last mark wins" rule as
# aide-run-spec's work_round_boundary_in.
_spec_state_reopened_json() {
  local file="$1" line date sha
  line="$(sed -n \
    -e 's/^[[:space:]]*-\{0,1\}[[:space:]]*\*\*Reopened:\*\*[[:space:]]*\([0-9-]*\).*history before `\([0-9a-fA-F]\{7,40\}\)`.*/\1\t\2/p' \
    -e 's/^[[:space:]]*-\{0,1\}[[:space:]]*\*\*Reset:\*\*[[:space:]]*\([0-9-]*\).*history before `\([0-9a-fA-F]\{7,40\}\)`.*/\1\t\2/p' \
    "$file" 2>/dev/null | tail -1)"
  if [ -n "$line" ]; then
    date="${line%%$'\t'*}"
    sha="${line##*$'\t'}"
    jq -cn --arg d "$date" --arg s "$sha" '{date:$d, boundaryCommit:$s}'
  else
    printf 'null'
  fi
}

write_spec_state() {   # $1 = resolved 4-status.md path, $2 = optional completedPhases override (comma-separated)
  local status_file="$1" completed_override="${2:-}"
  local state_file
  state_file="$(_spec_state_file_for "$status_file")"
  [ -f "$status_file" ] || return 1
  command -v jq >/dev/null 2>&1 || return 1

  local completed_json
  if [ -n "$completed_override" ]; then
    completed_json="$(printf '%s' "$completed_override" | \
      jq -R -c 'split(",") | map(gsub("^[ \t`]+|[ \t`]+$";"")) | map(select(length>0))')"
  elif [ -f "$state_file" ]; then
    completed_json="$(jq -c '.completedPhases // []' "$state_file" 2>/dev/null)"
    [ -n "$completed_json" ] || completed_json="[]"
  else
    local prose_line
    prose_line="$(sed -n 's/^-[[:space:]]*\*\*Workflow steps completed:\*\*//p' "$status_file" 2>/dev/null | tail -1)"
    completed_json="$(printf '%s' "$prose_line" | \
      jq -R -s -c 'split(",") | map(gsub("^[ \t`]+|[ \t`]+$";"")) | map(select(length>0))')"
  fi

  local archived_json reopened_json
  archived_json="$(_spec_state_archived_json "$status_file")"
  reopened_json="$(_spec_state_reopened_json "$status_file")"

  local phasecounts_json acceptance_json rows_tmp
  rows_tmp="$(mktemp)"
  _spec_state_phase_and_acceptance_rows "$status_file" > "$rows_tmp"

  phasecounts_json="$(awk -F'\t' '$1=="PHASE"' "$rows_tmp" | \
    jq -R -c -s '
      split("\n") | map(select(length > 0) | split("\t")) |
      map({(.[1]): {done: (.[2] | tonumber), total: (.[3] | tonumber)}}) |
      add // {}
    ')"
  acceptance_json="$(awk -F'\t' '$1=="ACC"' "$rows_tmp" | \
    jq -R -c -s '
      split("\n") | map(select(length > 0) | split("\t")) |
      map({task: .[2], done: (.[1] == "1")})
    ')"
  rm -f "$rows_tmp"

  local tmp
  tmp="$(mktemp)"
  jq -cn \
    --argjson completedPhases "$completed_json" \
    --argjson archived "$archived_json" \
    --argjson reopened "$reopened_json" \
    --argjson acceptanceCriteria "$acceptance_json" \
    --argjson phaseCounts "$phasecounts_json" \
    '{completedPhases:$completedPhases, archived:$archived, reopened:$reopened,
      acceptanceCriteria:$acceptanceCriteria, phaseCounts:$phaseCounts}' \
    > "$tmp" && mv "$tmp" "$state_file"
}

read_spec_state() {   # $1 = resolved 4-status.md path; sets $state_json
  local status_file="$1" state_file
  state_file="$(_spec_state_file_for "$status_file")"
  [ -f "$state_file" ] || write_spec_state "$status_file"
  state_json="$(cat "$state_file" 2>/dev/null || echo '{}')"
}

# read_spec_state_at_ref($dir, $ref, $status_basename) — sets $state_json
# and $state_json_found ("yes"/"no"), read-only, never writes. For a
# HISTORICAL git ref rather than the live worktree (aide-run-spec's own
# "how did this spec's state stand before this session" comparisons):
# reads 4-status.json from that ref directly when it is there, and falls
# back to deriving completedPhases from that ref's own 4-status.md prose
# otherwise — the one-time self-heal write_spec_state applies to a live
# file, applied here to a ref's content instead, since there is no live
# file at a historical commit to write a state file onto.
#
# $state_json_found is "no" when NEITHER the JSON nor the prose could be
# read at $dir's OWN path under $ref at all (not merely empty) — the
# archive step's own git-mv is exactly this case: the folder's path at
# the pre-session ref is the OLD (active) location, but $dir by the time
# this runs is already the NEW (archived) one, so a lookup "at that ref,
# under this dir's current relative path" correctly finds nothing. The
# caller falls back to the LIVE file's own state — see the two-level
# fallback in completed_steps_for — the same job the original prose-only
# version of this read did with its own `git show ... || <current file>`
# chain.
read_spec_state_at_ref() {
  local dir="$1" ref="$2" status_base="$3" state_base
  state_base="${status_base%4-status.md}4-status.json"
  state_json_found="yes"
  state_json="$(git -C "$dir" show "$ref:./$state_base" 2>/dev/null)"
  if [ -z "$state_json" ]; then
    local prose prose_line completed_json
    prose="$(git -C "$dir" show "$ref:./$status_base" 2>/dev/null)"
    if [ -z "$prose" ]; then
      state_json_found="no"
      prose_line=""
    else
      prose_line="$(printf '%s\n' "$prose" | \
        sed -n 's/^-[[:space:]]*\*\*Workflow steps completed:\*\*//p' | tail -1)"
    fi
    completed_json="$(printf '%s' "$prose_line" | \
      jq -R -s -c 'split(",") | map(gsub("^[ \t`]+|[ \t`]+$";"")) | map(select(length>0))')"
    state_json="$(jq -cn --argjson c "$completed_json" \
      '{completedPhases:$c, archived:null, reopened:null, acceptanceCriteria:[], phaseCounts:{}}')"
  fi
}
