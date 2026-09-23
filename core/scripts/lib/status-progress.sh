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
      prev_done = (mark == "✅" || low == "completed" || low == "✅ completed" || low == "not verified") ? 1 : 0
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
      # The symbol and the words are one mark: "⬜ Not started" is the
      # form the shipped 4-status template writes, and reading it as
      # anything but a start state failed a whole analyze over 27 rows
      # nobody had touched. So the leading symbol comes off and the
      # words are read on their own; a mark that is only a symbol keeps
      # its own comparison below.
      word = low
      sub(/^[^a-z0-9]+[ \t]*/, "", word)
      # "Not verified" is a done mark for the count above, but it is
      # never an advance here: it is a start state, like ⬜.
      prev_counted = (mark != "⬜" && low != "not started" && low != "not verified" && word != "not started" && word != "not verified") ? 1 : 0
      if (prev_counted) advanced++
      next
    }
    END { printf "%d\n", advanced+0 }
  ' "$file" 2>/dev/null)"
  advanced_count="${counts:-0}"
  return 0
}

# Spec 509: the start state of a "Not tested:" Acceptance row. Rewrites
# every ⬜ row of an Acceptance section whose Notes start with
# "Not tested:" to "Not verified" in <status-file>, but only on a known
# baseline: <status-before> (the file as it was before the run) must
# exist, be non-empty and carry no Acceptance rows. A missing or empty
# baseline is unknown and starts nothing; a later round (the baseline
# already has Acceptance rows) leaves every Status cell byte-for-byte.
start_not_tested_rows_not_verified() {   # <status-file> <status-before>
  local file="$1" before="$2" out
  [ -f "$file" ] && [ -s "$before" ] || return 0
  status_progress_for "$before" "Acceptance"
  [ "$progress_total" -eq 0 ] || return 0
  out="$(mktemp)" || return 0
  LC_ALL=C awk '
    /^## / {
      heading = $0; sub(/^## /, "", heading)
      rest = heading
      sub(/^([Pp]hase|[Ff]ase|[Cc]hecklist|[Aa]cceptance)/, "", rest)
      keyword = substr(heading, 1, length(heading) - length(rest))
      in_acc = (rest != heading && rest ~ /^([^A-Za-z0-9]|$)/ && tolower(keyword) == "acceptance") ? 1 : 0
    }
    in_acc && /^[ \t]*\|.*\|[ \t]*$/ {
      n = split($0, cells, "|")
      if (n == 5) {
        mark = cells[3]; notes = cells[4]
        gsub(/^[ \t]+|[ \t]+$/, "", mark)
        gsub(/^[ \t]+/, "", notes)
        if (mark == "⬜" && index(notes, "Not tested:") == 1) {
          print cells[1] "|" cells[2] "| Not verified |" cells[4] "|" cells[5]
          next
        }
      }
    }
    { print }
  ' "$file" > "$out" 2>/dev/null
  if [ -s "$out" ] && ! cmp -s "$out" "$file"; then
    cat "$out" > "$file"
  fi
  rm -f "$out"
  return 0
}
