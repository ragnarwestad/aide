#!/bin/bash
# The dashboard's own tests, spread over several bun processes.
#
# One bun process runs one file at a time, so this suite's wall clock was
# the sum of its files: 5 min 48 s, of which `test/queue-routes/landing`
# alone — twelve files that each build real git repositories and merge
# them — was 3 min 11 s. Nothing here shares state between files (a test
# that needs a server binds port 0, a test that needs git works in its
# own temp directory), so the files are dealt round-robin to N workers
# and the wall clock becomes the slowest worker's share.
#
# Round-robin over the sorted list, rather than a hand-written grouping:
# the slow files of one directory are neighbours in that list, so they
# land on different workers, and a new file joins by existing.
#
# `test/round` stays out: each of its tests starts a real board and does
# real git work, and on a machine running other suites they lose to load
# at any per-test limit. `make test-slow` is theirs. The browser tests
# are IN, since spreading them over the workers took them from 2 min 15 s
# to 19 s and took with them the cascade that made them flaky — one
# process running all 22 files killed its own browser between them. They
# run in a pool of their own, capped and with a deadline of their own:
# see BROWSER_WORKERS below.
set -o pipefail
cd "$(dirname "$0")/.." || exit 1

# 20 s per test, not bun's 5 s: the git-backed route tests run beside
# other jobs' suites on the serving host and lose to load alone.
LIMIT=20000
# A file that starts a real browser sets its own, longer deadline —
# `test/helpers/browser-deadline.ts`, which is what a file's own
# `setDefaultTimeout` leaves this limit no say in.
# Two cores are left for whatever else the host is doing — a run's own AI
# session, another spec's suite. Override with AIDE_TEST_WORKERS.
CPUS=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
WORKERS=${AIDE_TEST_WORKERS:-$(( CPUS > 3 ? CPUS - 2 : 1 ))}
# How many of those workers may be running a browser file at once. The
# rest of the suite costs a bun process; a browser file costs a chromium
# too, and eight of those competing is what made a launch miss its
# deadline. Override with AIDE_TEST_BROWSER_WORKERS.
BROWSER_WORKERS=${AIDE_TEST_BROWSER_WORKERS:-3}

# With no argument: the suite `make test` runs. Tests live under `src/` too
# (the message catalogues' own), so both trees are collected, browser
# files included. `test/round/`, which starts a real board, is left out:
# `make test-slow` runs it. `make test-e2e` runs the browser files alone,
# passing `test/e2e` as that argument.
if [ "$#" -gt 0 ]; then
  files=$(find "$@" -name '*.test.ts' | sort)
else
  files=$(find src test -name '*.test.ts' -not -path 'test/round/*' | sort)
fi
[ -n "$files" ] || { echo "no test files found"; exit 1; }

started=$(date +%s)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

# Every temp directory a test makes goes inside this run's own, and is
# removed with it. A test that leaves its directory behind otherwise
# leaves it in the machine's shared temp directory for good: those had
# piled up to 1.9 million entries by 2026-09-22, and reading that
# directory takes minutes — which is what a board starting from it, or
# any other program reaching for temp, then waits for.
export TMPDIR="$OUT/tmp"
mkdir -p "$TMPDIR"

# Two pools, dealt separately: the files that start a browser take the
# first `BROWSER_WORKERS` workers, everything else takes the rest. Dealt
# together — one round-robin over every file — which pool a worker ended
# up carrying was decided by the file COUNT, so adding any test file
# anywhere reshuffled the browsers and a run went red for reasons that
# had nothing to do with the change.
browser=""
rest=""
for f in $files; do
  if grep -q 'from "playwright"' "$f" 2>/dev/null; then
    browser="$browser $f"
  else
    rest="$rest $f"
  fi
done
# Nothing else to run beside them (`make test-e2e` passes their own
# directory): then the browsers have the machine to themselves and the
# cap is what would slow them down, so it is lifted.
[ -z "$rest" ] && BROWSER_WORKERS="$WORKERS"
[ -z "$browser" ] && BROWSER_WORKERS=0
[ "$BROWSER_WORKERS" -ge "$WORKERS" ] && [ -n "$rest" ] && BROWSER_WORKERS=$(( WORKERS - 1 ))

i=0
for f in $browser; do
  echo "$f" >> "$OUT/list.$(( i % BROWSER_WORKERS ))"
  i=$(( i + 1 ))
done
i=0
for f in $rest; do
  echo "$f" >> "$OUT/list.$(( BROWSER_WORKERS + i % (WORKERS - BROWSER_WORKERS) ))"
  i=$(( i + 1 ))
done

pids=""
w=0
while [ "$w" -lt "$WORKERS" ]; do
  if [ -s "$OUT/list.$w" ]; then
    # shellcheck disable=SC2046  # the list is our own, one path per line
    bun test --timeout "$LIMIT" $(cat "$OUT/list.$w") > "$OUT/out.$w" 2>&1 &
    pids="$pids $!:$w"
  fi
  w=$(( w + 1 ))
done

# One process printing to the terminal became one per core printing into
# files, and a suite that says nothing for a minute reads as a hung one.
# So each worker's own line is printed the moment that worker is done, a
# failing test the moment it fails, and the rest is a heartbeat: bun heads
# only the files that have something to say, so counting those undercounts
# by four fifths and looked like a run that had stalled.
said_fails=0
beat=0
left=$(echo "$pids" | wc -w | tr -d ' ')
while :; do
  for p in $pids; do
    pid=${p%%:*}; w=${p##*:}
    kill -0 "$pid" 2>/dev/null && continue
    [ -f "$OUT/said.$w" ] && continue
    : > "$OUT/said.$w"
    left=$(( left - 1 ))
    ran=$(grep -E '^Ran [0-9]+ tests' "$OUT/out.$w" | tail -1)
    if [ -n "$ran" ] && ! grep -q '^(fail)' "$OUT/out.$w"; then
      printf -- '--- worker %s  %s  (%s still running)\n' "$w" "$ran" "$left"
    elif grep -q '^(fail)' "$OUT/out.$w"; then
      printf -- '--- worker %s is RED  (%s still running)\n' "$w" "$left"
    else
      printf -- '--- worker %s stopped before it finished  (%s still running)\n' "$w" "$left"
    fi
  done
  fails=$(grep -ch '^(fail)' "$OUT"/out.* 2>/dev/null | paste -sd+ - | bc)
  if [ "${fails:-0}" -gt "$said_fails" ]; then
    grep -h '^(fail)' "$OUT"/out.* 2>/dev/null | tail -n "$(( fails - said_fails ))"
    said_fails=$fails
  fi
  [ "$left" -le 0 ] && break
  # Something every 15 s even before the first worker is done: on eight
  # cores the quickest of them takes half a minute.
  beat=$(( beat + 2 ))
  if [ $(( beat % 15 )) -lt 2 ]; then
    [ "$left" -eq 1 ] && word=worker || word=workers
    printf -- '... %s s, %s %s running\n' "$(( $(date +%s) - started ))" "$left" "$word"
  fi
  sleep 2
done

# A worker that ended on a signal with no failing test was stopped from
# outside — the machine short of memory, another job's cleanup — and says
# nothing about the code. Its files are run once more, and only a second
# failure counts; a failing test anywhere in it is red as it stands.
failed=""
for p in $pids; do
  w=${p##*:}
  wait "${p%%:*}"; rc=$?
  [ "$rc" -eq 0 ] && continue
  if [ "$rc" -gt 128 ] && ! grep -q '^(fail)' "$OUT/out.$w"; then
    echo "--- worker $w was killed (signal $(( rc - 128 ))) without a failing test; running its files again"
    # shellcheck disable=SC2046  # the list is our own, one path per line
    if ( bun test --timeout "$LIMIT" $(cat "$OUT/list.$w") ) > "$OUT/out.$w" 2>&1; then
      echo "--- worker $w, run again: $(grep -E '^Ran [0-9]+ tests' "$OUT/out.$w" | tail -1)"
      continue
    fi
  fi
  failed="$failed $w"
done

total=0
for w in $(seq 0 $(( WORKERS - 1 ))); do
  [ -f "$OUT/out.$w" ] || continue
  ran=$(grep -E '^Ran [0-9]+ tests' "$OUT/out.$w" | tail -1)
  n=$(echo "$ran" | sed -E 's/^Ran ([0-9]+) tests.*/\1/')
  total=$(( total + ${n:-0} ))
  # A red worker's whole output, so the failing lines and their diffs are
  # here: what was printed while it ran was the one-line headline.
  if [[ " $failed " == *" $w "* ]]; then
    echo "--- worker $w, in full:"
    cat "$OUT/out.$w"
  fi
done
elapsed=$(( $(date +%s) - started ))
if [ "$elapsed" -ge 60 ]; then
  took="$(( elapsed / 60 )) min $(( elapsed % 60 )) s"
else
  took="$elapsed s"
fi
echo "--- $total tests across $WORKERS workers in $took"

if [ -n "$failed" ]; then
  echo "red: worker(s)$failed"
  exit 1
fi
