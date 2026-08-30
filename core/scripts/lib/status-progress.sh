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
  counts="$(awk -v filter="$heading_filter" '
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
      next
    }
    !in_phase { next }
    {
      line = $0
      gsub(/^[ \t]+|[ \t]+$/, "", line)
      if (line !~ /^\|.*\|$/) next
      n = split(line, cells, "|")
      if (n != 5) next
      task = cells[2]; mark = cells[3]
      gsub(/^[ \t]+|[ \t]+$/, "", task)
      gsub(/^[ \t]+|[ \t]+$/, "", mark)
      if (task == "" || task ~ /^-+$/) next
      if (mark == "" || length(mark) > 30 || mark ~ /,/ || tolower(mark) == "status") next
      total++
      low = tolower(mark)
      if (mark == "✅" || low == "completed" || low ~ /^(✅[ \t]*)?completed$/) done++
    }
    END { printf "%d %d\n", done+0, total+0 }
  ' "$file" 2>/dev/null)"
  progress_done="${counts%% *}"
  progress_total="${counts##* }"
  return 0
}
