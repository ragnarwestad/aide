#!/usr/bin/env bash
# run-spec/turn/failing-tests.sh — sourced by aide-run-spec before run-spec/turn/step-tests.sh.
#
# Which tests a red run failed, read from the run's own output: the board
# names them, and a fix round hands them back to the session, instead of
# the last lines of the log. The landing reads the same output in
# TypeScript (dashboard/src/format/failing-tests.ts); the two are pinned
# by core/tests/fixtures/failing-tests.json.
#
# What each runner prints, without its colour and cursor codes:
#   Playwright  "  2 failed", then one "[project] › file:line:col › title"
#               per test, then "  2 flaky", "  151 passed (5.8m)"
#   vitest      " FAIL  file > suite > name", and "Tests  2 failed | 40 passed (42)"
#   bun         a "file.test.ts:" heading, "(fail) suite > name [5ms]", " 40 pass", " 2 fail"
#   pytest      "FAILED path::name - message", "ERROR path::name - …", "1 failed, 40 passed in 3s"
#   turbo       each line prefixed "@pkg:task: ", and "Failed:    @pkg#task"
# A turbo task stands for its tests only when no test was named.

# The awk that reads a log (cleaned: no escape codes, no carriage returns)
# and prints one "T<TAB>test<TAB>file" per failing test, in order, then
# "F<TAB>n" and "N<TAB>n" for the failed and total counts when the output
# printed them.
FAILING_TESTS_AWK='
function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
function add(kind, test, file) {
  if (test == "" || (test SUBSEP file) in seen) return
  seen[test SUBSEP file] = 1
  n++; tests[n] = test; files[n] = file; kinds[n] = kind; named[kind]++
}
function num(s, word,   t) {
  # the number in front of " <word>" in s, or -1
  if (!match(s, "[0-9]+ " word)) return -1
  t = substr(s, RSTART, RLENGTH); sub(/ .*/, "", t); return t + 0
}
{
  raw = $0
  line = trim(raw)
  # Playwright: the list under "N failed", one test per line, until a
  # line that is not one.
  if (pw_list) {
    s = line
    if (match(s, /\[[^]]*\] › /)) s = substr(s, RSTART + RLENGTH)
    if (match(s, /:[0-9]+:[0-9]+ › /) && index(substr(s, 1, RSTART - 1), " ") == 0) {
      file = substr(s, 1, RSTART - 1)
      at = substr(s, RSTART + 1, RLENGTH - 1); sub(/:.*/, "", at)
      title = substr(s, RSTART + RLENGTH)
      sub(/ \(retry #[0-9]+\)$/, "", title)
      add("playwright", file ":" at " › " trim(title), file)
      next
    }
    pw_list = 0
  }
  if (line ~ /(^|[ :])[0-9]+ failed$/) { pw_seen = 1; pw_failed += num(line, "failed"); pw_list = 1; next }
  if (line ~ /(^|[ :])[0-9]+ flaky$/) { pw_seen = 1; pw_flaky += num(line, "flaky"); next }
  if (line ~ /(^|[ :])[0-9]+ passed \([0-9.]+(ms|s|m|h)\)$/) { pw_seen = 1; pw_passed += num(line, "passed"); next }
  # vitest
  if (line ~ /^FAIL +[^ ]/) {
    s = line; sub(/^FAIL +/, "", s); sub(/ \[ .* \]$/, "", s)
    file = s; sub(/ > .*/, "", file)
    i = index(s, " > ")
    if (i > 0) s = substr(s, 1, i - 1) " › " substr(s, i + 3)
    add("vitest", s, file)
    next
  }
  if (line ~ /^Tests +[0-9]/) {
    vt_seen = 1
    f = num(line, "failed"); p = num(line, "passed")
    vt_failed += (f < 0 ? 0 : f); vt_passed += (p < 0 ? 0 : p)
    next
  }
  # bun: the heading names the file of the (fail) lines under it
  if (raw ~ /^[^ ].*\.(test|spec)\.[cm]?[jt]sx?:$/) { bun_file = substr(raw, 1, length(raw) - 1); next }
  if (line ~ /^\(fail\) /) {
    s = substr(line, 8); sub(/ \[[0-9.]+m?s\]$/, "", s)
    if (bun_file == "") { bare[s] = 1; next }
    add("bun", bun_file " › " s, bun_file)
    with_file[s] = 1
    next
  }
  if (line ~ /^[0-9]+ pass$/) { bun_pass_lines++; bun_passed = line + 0; next }
  if (line ~ /^[0-9]+ fail$/) { bun_fail_lines++; bun_failed = line + 0; next }
  # pytest
  if (line ~ /^(FAILED|ERROR) [^ ]+::/) {
    s = substr(line, index(line, " ") + 1)
    i = index(s, " - "); if (i > 0) s = substr(s, 1, i - 1)
    file = s; sub(/::.*/, "", file)
    add("pytest", trim(s), file)
    next
  }
  if (line ~ /[0-9]+ (failed|passed|errors?)/ && line ~ / in [0-9.]+s/) {
    py_seen = 1
    f = num(line, "failed"); p = num(line, "passed"); e = num(line, "error")
    py_failed += (f < 0 ? 0 : f) + (e < 0 ? 0 : e); py_passed += (p < 0 ? 0 : p)
    next
  }
  # turbo
  if (line ~ /^Failed: +[^ ]+#[^ ]+$/) { s = line; sub(/^Failed: +/, "", s); task[++tasks] = s; next }
}
END {
  # A (fail) bun printed before any heading is the same test said again
  # under its file further down; one with no file anywhere is still named.
  for (s in bare) if (!(s in with_file)) add("bun", s, "")
  if (n == 0) for (i = 1; i <= tasks; i++) add("turbo", task[i], "")
  for (i = 1; i <= n; i++) print "T\t" tests[i] "\t" files[i]
  bun_seen = (bun_pass_lines == 1 && bun_fail_lines == 1)
  # The counts each runner printed. A runner that named a test and printed
  # no count of its own leaves the total unknown.
  known = 1
  for (k in named) {
    if (k == "playwright" && pw_seen) { failed += pw_failed; continue }
    if (k == "vitest" && vt_seen) { failed += vt_failed; continue }
    if (k == "bun" && bun_seen) { failed += bun_failed; continue }
    if (k == "pytest" && py_seen) { failed += py_failed; continue }
    failed += named[k]; known = 0
  }
  if (n > 0) print "F\t" failed
  if (n > 0 && known) {
    total = 0
    if (pw_seen) total += pw_failed + pw_flaky + pw_passed
    if (vt_seen) total += vt_failed + vt_passed
    if (bun_seen) total += bun_failed + bun_passed
    if (py_seen) total += py_failed + py_passed
    print "N\t" total
  }
}
'

# $1 = a test run's log. Prints {tests, files, failed, total}: every
# failing test it names, once, in the order it named them; the file each
# is in ("" when the output does not say); and the failed and total
# counts — `failed` whenever a test is named, `total` only when every
# runner that named one also printed its count.
failing_tests() {
  local log="$1" input
  if [ ! -f "$log" ]; then
    printf '%s\n' '{"tests":[],"files":[]}'
    return 0
  fi
  input="$(sed $'s/\033\\[[0-9;?]*[A-Za-z]//g; s/\r//g' "$log")"
  # turbo prefixes each line with its task; without it the lines are the
  # runner's own. Only in a turbo run: elsewhere "path:12: Error" is no prefix.
  if printf '%s\n' "$input" | grep -qE '^Failed: +[^ ]+#[^ ]+ *$'; then
    input="$(printf '%s\n' "$input" | sed -E 's/^[@A-Za-z0-9_./-]+:[A-Za-z0-9_.:-]+: //')"
  fi
  printf '%s\n' "$input" | awk "$FAILING_TESTS_AWK" | jq -Rn '
    [inputs | split("\t")] as $rows
    | {tests: [$rows[] | select(.[0] == "T") | .[1]],
       files: [$rows[] | select(.[0] == "T") | (.[2] // "")]}
    + ([$rows[] | select(.[0] == "F") | {failed: (.[1] | tonumber)}] | add // {})
    + ([$rows[] | select(.[0] == "N") | {total: (.[1] | tonumber)}] | add // {})'
}

# $1 = failing_tests's answer (a file), $2 = the files the change touched,
# one per line. Prints {touched, untouched}: whether any failing test is in
# a file the change touched, and how many are in a file it did not. A
# file matches by the end of its path — Playwright names it from its own
# config's folder, git from the repository's root. A test with no file
# counts as neither.
failing_tests_against_change() {
  jq -c --rawfile changed "$2" '
    ($changed | split("\n") | map(select(. != ""))) as $c
    | [.files[] | select(. != "") | . as $f | any($c[]; . == $f or endswith("/" + $f))] as $hits
    | {touched: any($hits[]; .), untouched: ($hits | map(select(. | not)) | length)}' "$1"
}

# $1, $2 = failing_tests's answers for two runs in turn. True when the
# second failed a test the first did not: a fix round that mended some
# tests and left the rest is the change, not tests that fail at random.
failing_tests_varied() {
  jq -e -n --slurpfile a "$1" --slurpfile b "$2" \
    '$a[0].tests as $before | any($b[0].tests[]; . as $t | any($before[]; . == $t) | not)' >/dev/null
}

# $1 = a worktree, $2 = the ref the change is measured from. The files the
# change touched, one per line: committed since the two parted, changed in
# the working tree, and new — the session's work is not always committed
# when its tests run.
failing_tests_changed_files() {
  local wt="$1" base="$2" fork
  fork="$(git -C "$wt" merge-base "$base" HEAD 2>/dev/null)" || fork=""
  {
    [ -n "$fork" ] && git -C "$wt" diff --name-only "$fork" 2>/dev/null
    git -C "$wt" ls-files --others --exclude-standard 2>/dev/null
  } | sort -u
}

# $1 = failing_tests's answer for the last run, $2 = the touched files
# (failing_tests_changed_files), $3 = `true` when the failing tests varied
# between the step's runs. Prints the step result's `testsRed`: at most
# eight tests, the counts, whether a failing test is in a touched file and
# how many are not, and whether the runs varied. Nothing when no test is
# named.
failing_tests_summary() {
  local against
  against="$(failing_tests_against_change "$1" "$2")"
  jq -c --argjson against "$against" --argjson varied "$3" '
    if (.tests | length) == 0 then empty else
      {tests: .tests[:8], failed} + (if .total == null then {} else {total} end)
      + $against + {variedBetweenRuns: $varied}
    end' "$1"
}

# $1 = failing_tests's answer. The tests as lines for a fix round's prompt:
# at most eight, and how many more.
failing_tests_list() {
  jq -r '(.tests[:8][] | "- " + .),
    (if (.tests | length) > 8 then "- and \((.tests | length) - 8) more" else empty end)' "$1"
}
