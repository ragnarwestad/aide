#!/usr/bin/env bash
# Shared "how many rows under a matching heading are done" rule — the
# bash mirror of dashboard/src/project/parse-status.ts's
# tableCells/isDoneMark/PHASE_HEADING_RE, kept in sync via
# tests/fixtures/status-row-counting.json (spec 246, widened spec 285).
# Sourced by both aide-run-spec (unfiltered: every Phase/Fase/Checklist/
# Acceptance section) and aide-archive-spec (filtered to "Acceptance"
# only, for its narrow archive gate) so neither hand-rolls a second copy.
status_progress_for() {   # sets $progress_done, $progress_total
  local file="$1" heading_filter="${2:-}" counts
  progress_done=0; progress_total=0
  [ -f "$file" ] || return 0
  # LC_ALL=C is load-bearing, not cosmetic: macOS's system awk compares
  # two DIFFERENT multi-byte UTF-8 characters as EQUAL under a UTF-8
  # locale ("⬜" == "✅" evaluates true) — every mark ends up counted as
  # done regardless of what it actually is. Forcing the C locale makes
  # awk compare raw bytes, which is exactly what an exact-mark check
  # needs anyway. Verified directly: LC_ALL=C awk 'BEGIN{print ("⬜"=="✅")}'
  # prints 0 only with this set; without it, the mark-counting rule is
  # not just imprecise but inverted for large parts of the input.
  counts="$(LC_ALL=C awk -v filter="$heading_filter" '
    /^## / {
      heading = $0; sub(/^## /, "", heading)
      rest = heading
      sub(/^([Pp]hase|[Ff]ase|[Cc]hecklist|[Aa]cceptance)/, "", rest)
      is_match = (rest != heading && rest ~ /^([^A-Za-z0-9]|$)/) ? 1 : 0
      if (is_match && filter != "") {
        # Exact-match the matched keyword itself (e.g. "Acceptance"),
        # not a dynamic regex built from `rest` — `rest` is free-form
        # heading text and must never be spliced into a regex.
        keyword = substr(heading, 1, length(heading) - length(rest))
        is_match = (tolower(keyword) == tolower(filter)) ? 1 : 0
      }
      in_phase = is_match
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
        # The separator row proves the immediately preceding row-shaped
        # line was the header, whatever its own cells said — undo its
        # count. Only a TRUE separator (all dashes) reaches this
        # branch; a merely malformed row (empty task, handled above)
        # must never undo a real row count.
        if (prev_counted) { total--; if (prev_done) done-- }
        prev_counted = 0
        next
      }
      if (mark == "" || length(mark) > 30 || mark ~ /,/) { prev_counted = 0; next }
      total++
      low = tolower(mark)
      prev_done = (mark == "✅" || low == "completed" || low == "✅ completed") ? 1 : 0
      if (prev_done) done++
      prev_counted = 1
      next
    }
    END { printf "%d %d\n", done+0, total+0 }
  ' "$file" 2>/dev/null)"
  progress_done="${counts%% *}"
  progress_total="${counts##* }"
  return 0
}

# Sibling of status_progress_for above, same row detection, different
# predicate (spec 288): a row counts here when its Status cell is
# anything OTHER than not-started — done, in-progress, blocked, waiting,
# or their word forms all count, since none of them is a status
# `/aide-analyze` is ever allowed to leave a row in (that is
# implement's and archive's job). Used by aide-run-spec's own
# analyze-scope guard, unfiltered — no TS mirror, since nothing on the
# dashboard side ever needs "how many rows advanced", only "how many are
# done" (status_progress_for, already shared).
status_advanced_count_for() {   # sets $advanced_count
  local file="$1" counts
  advanced_count=0
  [ -f "$file" ] || return 0
  counts="$(LC_ALL=C awk '
    /^## / {
      heading = $0; sub(/^## /, "", heading)
      rest = heading
      sub(/^([Pp]hase|[Ff]ase|[Cc]hecklist|[Aa]cceptance)/, "", rest)
      is_match = (rest != heading && rest ~ /^([^A-Za-z0-9]|$)/) ? 1 : 0
      in_phase = is_match
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
        if (prev_counted) advanced--
        prev_counted = 0
        next
      }
      if (mark == "" || length(mark) > 30 || mark ~ /,/) { prev_counted = 0; next }
      low = tolower(mark)
      prev_counted = (mark != "⬜" && low != "not started") ? 1 : 0
      if (prev_counted) advanced++
      next
    }
    END { printf "%d\n", advanced+0 }
  ' "$file" 2>/dev/null)"
  advanced_count="${counts:-0}"
  return 0
}
