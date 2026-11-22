#!/usr/bin/env bash
# How a status file's rows are read, once: `status_rows_in` decides which
# headings, table rows, cells and marks count, and every bash reader of a
# 4-status.md works from what it prints — `status_progress_for` and
# `status_advanced_count_for` below, and spec-state.sh's phaseCounts and
# acceptance rows. The bash mirror of dashboard/src/project/parse-status.ts's
# tableCells/isDoneMark/PHASE_HEADING_RE, kept in sync via
# core/tests/fixtures/status-row-counting.json.
#
# LC_ALL=C is load-bearing on every awk here, not cosmetic: macOS's system
# awk compares two DIFFERENT multi-byte UTF-8 characters as EQUAL under a
# UTF-8 locale ("⬜" == "✅" evaluates true), so every mark would read as
# done. The C locale makes awk compare raw bytes, which is what an exact
# mark check needs. Verified directly: LC_ALL=C awk 'BEGIN{print ("⬜"=="✅")}'
# prints 0 only with this set.

# status_rows_in <file> — prints one record per counted heading and per
# kept row, each field on a line of its own. A field never holds a newline,
# so no byte inside a cell — a tab, a control character — can split one:
#
#   HEAD, <heading>, <keyword>                  every counted `## ` heading,
#                                               in file order, empty ones too
#   ROW, <heading>, <keyword>, <task>, <mark>   every row that counts under it
#
# A reader takes a record with _STATUS_RECORD_AWK's status_record(), which
# leaves its fields in rec[1..n].
# A counted heading starts with Phase/Fase/Checklist/Acceptance (first
# letter either case) followed by a non-alphanumeric or its end; <keyword>
# is that word, lower-cased. A row is a trimmed `|…|` line of exactly
# three cells once an escaped pipe (`\|`) is read as text, with a
# non-empty task and a mark that is non-empty, at most 30 bytes and
# without a comma. A separator row (task all dashes) proves the row right
# above it was the table's header, so that row is dropped.
status_rows_in() {
  local file="$1"
  [ -f "$file" ] || return 0
  LC_ALL=C awk '
    function release() {
      if (held != "") print held
      held = ""
    }
    /^## / {
      release()
      heading = $0; sub(/^## /, "", heading)
      rest = heading
      sub(/^([Pp]hase|[Ff]ase|[Cc]hecklist|[Aa]cceptance)/, "", rest)
      in_phase = (rest != heading && rest ~ /^([^A-Za-z0-9]|$)/) ? 1 : 0
      # The matched keyword itself, cut by length — `rest` is free-form
      # heading text and is never spliced into a regex.
      keyword = tolower(substr(heading, 1, length(heading) - length(rest)))
      if (in_phase) print "HEAD\n" heading "\n" keyword
      next
    }
    !in_phase { next }
    {
      line = $0
      gsub(/^[ \t]+|[ \t]+$/, "", line)
      if (line !~ /^\|.*\|$/) { release(); next }
      gsub(/\\\|/, "\001", line)
      n = split(line, cells, "|")
      if (n != 5) { release(); next }
      task = cells[2]; mark = cells[3]
      gsub(/\001/, "\\|", task)
      gsub(/^[ \t]+|[ \t]+$/, "", task)
      gsub(/^[ \t]+|[ \t]+$/, "", mark)
      if (task == "") { release(); next }
      # Only a TRUE separator (all dashes) drops the held row; a merely
      # malformed row (empty task, above) never undoes a real one.
      if (task ~ /^-+$/) { held = ""; next }
      if (mark == "" || length(mark) > 30 || mark ~ /,/) { release(); next }
      release()
      held = "ROW\n" heading "\n" keyword "\n" task "\n" mark
      next
    }
    END { release() }
  ' "$file" 2>/dev/null
}

# Reads the rest of the record whose first line, HEAD or ROW, is $0 into
# rec[1..n], rec[1] being that first line.
# shellcheck disable=SC2016  # awk source, not a shell expansion
_STATUS_RECORD_AWK='
  function status_record(   n, i) {
    n = ($0 == "ROW") ? 5 : 3
    rec[1] = $0
    for (i = 2; i <= n; i++) getline rec[i]
  }
'

# The done-mark rule as an awk function, for the readers that ask which
# rows are done: `✅`, or the words Completed, ✅ Completed or Not verified
# in any letter case.
# shellcheck disable=SC2016  # awk source, not a shell expansion
_STATUS_DONE_MARK_AWK='
  function status_is_done(mark,   low) {
    low = tolower(mark)
    return (mark == "✅" || low == "completed" || low == "✅ completed" || low == "not verified") ? 1 : 0
  }
'

# Sets $progress_done and $progress_total: the rows under every counted
# heading, or under the one keyword given as $2 (e.g. "Acceptance"), and
# how many of them are done. Read by aide-run-spec's `Total progress` line.
status_progress_for() {   # sets $progress_done, $progress_total
  local file="$1" heading_filter="${2:-}" counts
  progress_done=0; progress_total=0
  [ -f "$file" ] || return 0
  counts="$(status_rows_in "$file" | LC_ALL=C awk -v filter="$heading_filter" \
    "$_STATUS_RECORD_AWK$_STATUS_DONE_MARK_AWK"'
    { status_record() }
    rec[1] == "ROW" && (filter == "" || rec[3] == tolower(filter)) {
      total++
      if (status_is_done(rec[5])) done++
    }
    END { printf "%d %d\n", done+0, total+0 }
  ' 2>/dev/null)"
  progress_done="${counts%% *}"
  progress_total="${counts##* }"
  return 0
}

# Sets $advanced_count: the rows whose Status cell is anything OTHER than
# not-started — done, in-progress, blocked, waiting, or their word forms
# all count, since none of them is a status `/aide-analyze` is ever
# allowed to leave a row in (that is implement's and archive's job). Used
# by aide-run-spec's own analyze-scope guard, unfiltered — no TS mirror,
# since nothing on the dashboard side ever needs "how many rows advanced".
status_advanced_count_for() {   # sets $advanced_count
  local file="$1" counts
  advanced_count=0
  [ -f "$file" ] || return 0
  counts="$(status_rows_in "$file" | LC_ALL=C awk "$_STATUS_RECORD_AWK"'
    { status_record() }
    rec[1] == "ROW" {
      mark = rec[5]
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
      if (mark != "⬜" && low != "not started" && low != "not verified" && word != "not started" && word != "not verified") advanced++
    }
    END { printf "%d\n", advanced+0 }
  ' 2>/dev/null)"
  advanced_count="${counts:-0}"
  return 0
}
