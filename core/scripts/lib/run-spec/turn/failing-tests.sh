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
# and prints one "T<TAB>test<TAB>file<TAB>error" per failing test, in order, then
# "F<TAB>n" and "N<TAB>n" for the failed and total counts when the output
# printed them.
FAILING_TESTS_AWK='
function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
function is_error_line(s) { return s ~ /^([A-Za-z]*Error: |Test timeout of .* exceeded\.$)/ }
function add(kind, test, file, error,   key) {
  key = test SUBSEP file
  if (test == "") return
  if (key in seen) { last = seen[key]; return }
  n++; seen[key] = n; last = n
  tests[n] = test; files[n] = file; errors[n] = error; kinds[n] = kind; named[kind]++
}
function num(s, word,   t) {
  # the number in front of " <word>" in s, or -1
  if (!match(s, "[0-9]+ " word)) return -1
  t = substr(s, RSTART, RLENGTH); sub(/ .*/, "", t); return t + 0
}
{
  raw = $0
  line = trim(raw)
  # Playwright: numbered failure blocks precede the final failed-test list.
  if (match(line, /^[0-9]+\) /)) {
    s = substr(line, RSTART + RLENGTH)
    if (match(s, /\[[^]]*\] › /)) s = substr(s, RSTART + RLENGTH)
    sub(/ ─+$/, "", s)
    if (match(s, /:[0-9]+:[0-9]+ › /)) {
      file = substr(s, 1, RSTART - 1)
      at = substr(s, RSTART + 1, RLENGTH - 1); sub(/:.*/, "", at)
      title = substr(s, RSTART + RLENGTH)
      pw_error_test = file ":" at " › " trim(title)
    }
    next
  }
  if (pw_error_test != "" && is_error_line(line)) {
    if (!(pw_error_test in pw_errors)) pw_errors[pw_error_test] = line
    pw_error_test = ""
    next
  }
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
      test = file ":" at " › " trim(title)
      add("playwright", test, file, pw_errors[test])
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
    add("vitest", s, file, "")
    vitest_pending[last] = 1
    next
  }
  if (is_error_line(line)) {
    pending = 0
    for (i in vitest_pending) {
      pending = 1
      if (errors[i] == "") errors[i] = line
      delete vitest_pending[i]
    }
    if (!pending && bun_error == "") bun_error = line
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
  if (line ~ /^error: / || line ~ /^expect\(/) {
    if (bun_error == "") bun_error = line
    next
  }
  if (line ~ /^\(fail\) /) {
    s = substr(line, 8); sub(/ \[[0-9.]+m?s\]$/, "", s)
    if (bun_file == "") { bare[s] = bun_error; bun_error = ""; next }
    add("bun", bun_file " › " s, bun_file, bun_error)
    bun_error = ""
    with_file[s] = 1
    next
  }
  if (line ~ /^[0-9]+ pass$/) { bun_pass_lines++; bun_passed = line + 0; next }
  if (line ~ /^[0-9]+ fail$/) { bun_fail_lines++; bun_failed = line + 0; next }
  # pytest
  if (line ~ /^(FAILED|ERROR) [^ ]+::/) {
    s = substr(line, index(line, " ") + 1)
    error = ""; i = index(s, " - ")
    if (i > 0) { error = substr(s, i + 3); s = substr(s, 1, i - 1) }
    file = s; sub(/::.*/, "", file)
    add("pytest", trim(s), file, trim(error))
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
  for (s in bare) if (!(s in with_file)) add("bun", s, "", bare[s])
  if (n == 0) for (i = 1; i <= tasks; i++) add("turbo", task[i], "", "")
  for (i = 1; i <= n; i++) print "T\t" tests[i] "\t" files[i] "\t" errors[i]
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

# $1 = a test run's log. Prints {tests, files, errors, failed, total}: every
# failing test it names, once, in the order it named them; the file each
# is in ("" when the output does not say); and the failed and total
# counts — `failed` whenever a test is named, `total` only when every
# runner that named one also printed its count.
failing_tests() {
  local log="$1" input
  if [ ! -f "$log" ]; then
    printf '%s\n' '{"tests":[],"files":[],"errors":[]}'
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
       files: [$rows[] | select(.[0] == "T") | (.[2] // "")],
       errors: [$rows[] | select(.[0] == "T") | (.[3] // "")]}
    + ([$rows[] | select(.[0] == "F") | {failed: (.[1] | tonumber)}] | add // {})
    + ([$rows[] | select(.[0] == "N") | {total: (.[1] | tonumber)}] | add // {})'
}

# $1 = failing_tests's answer. Prints its distinct nonempty files in order.
failing_tests_files() {
  jq -r '.files[] | select(. != "")' "$1" | awk '!seen[$0]++'
}

# $1 = one isolated file run's output. Print explicit passing and failing
# identities for Bun and verbose pytest; silence never proves a pass.
test_results() {
  sed $'s/\033\\[[0-9;?]*[A-Za-z]//g; s/\r//g' "$1" | awk '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    /^[^ ].*\.(test|spec)\.[cm]?[jt]sx?:$/ { file=substr($0,1,length($0)-1); next }
    /^\((pass|fail)\) / && file {
      kind=substr($0,2,4); s=substr($0,8); sub(/ \[[0-9.]+m?s\]$/, "", s)
      print (kind == "pass" ? "P" : "F") "\t" file " › " s
      next
    }
    /::/ && /(^| )(PASSED|FAILED|ERROR)( |$)/ {
      s=$0
      sub(/^\[gw[0-9]+\] +\[[^]]+\] +/, "", s)
      if (s ~ /^(PASSED|FAILED|ERROR) +/) {
        status=s; sub(/ .*/, "", status)
        sub(/^(PASSED|FAILED|ERROR) +/, "", s)
      } else {
        status=(s ~ / PASSED( |$)/ ? "PASSED" : (s ~ / FAILED( |$)/ ? "FAILED" : "ERROR"))
        sub(/ +(PASSED|FAILED|ERROR).*$/, "", s)
      }
      print (status == "PASSED" ? "P" : "F") "\t" trim(s)
    }' | jq -Rn '[inputs | split("\t")] | {
      passedTests:[.[] | select(.[0] == "P") | .[1]],
      failedTests:[.[] | select(.[0] == "F") | .[1]]}'
}

# $1 = failing_tests's answer for the last run, $2 = a JSON array whose
# entries say whether each file passed when run again alone. Tests in a
# green file are separated from tests that remain red.
failing_tests_summary() {
  jq -c --slurpfile again "$2" '
    . as $last
    | ($again[0] // []) as $runs
    | [range(0; .tests | length) as $i
       | {test:.tests[$i], file:.files[$i], error:(.errors[$i] // "")}
       | . as $entry
       | . + {passed:(.file != "" and any($runs[];
           .file == $entry.file and
           (.passed == true or
            ((.passedTests // []) | index($entry.test)) != null and
            ((.failedTests // []) | index($entry.test)) == null)))}] as $all
    | [$all[] | select(.passed) | .test] as $passed
    | [$all[] | select(.passed) | .error] as $passedErrors
    | [$all[] | select(.passed | not) | .test] as $failedTests
    | [$all[] | select(.passed | not) | .error] as $failedErrors
    | if ($all | length) == 0 then empty else
        {tests:$failedTests[:8], errors:$failedErrors[:8], failed:($failedTests | length)}
        + (if .total == null then {} else {total} end)
        + (if ($passed | length) == 0 then {passedAlone:[], passedAloneErrors:[], passedAloneCount:0}
           else {passedAlone:$passed[:8], passedAloneErrors:$passedErrors[:8], passedAloneCount:($passed | length)} end)
      end' "$1"
}

# $1 = failing_tests's answer. The tests as lines for a fix round's prompt:
# at most eight, and how many more.
failing_tests_list() {
  jq -r '(.tests[:8][] | "- " + .),
    (if (.tests | length) > 8 then "- and \((.tests | length) - 8) more" else empty end)' "$1"
}
