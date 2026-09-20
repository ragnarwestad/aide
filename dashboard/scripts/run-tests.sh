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
# `test/e2e` and `test/round` stay out, as they were out of the single
# command this replaces: they start a real browser and a real board, and
# they have `make test-e2e` and `make test-slow`.
set -o pipefail
cd "$(dirname "$0")/.." || exit 1

# 20 s per test, not bun's 5 s: the git-backed route tests run beside
# other jobs' suites on the serving host and lose to load alone.
LIMIT=20000
# Two cores are left for whatever else the host is doing — a run's own AI
# session, another spec's suite. Override with AIDE_TEST_WORKERS.
CPUS=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
WORKERS=${AIDE_TEST_WORKERS:-$(( CPUS > 3 ? CPUS - 2 : 1 ))}

# Tests live under `src/` too (the message catalogues' own), so both trees
# are collected.
files=$(find src test -name '*.test.ts' \
  -not -path 'test/e2e/*' -not -path 'test/round/*' | sort)
[ -n "$files" ] || { echo "no test files found"; exit 1; }

OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

i=0
for f in $files; do
  echo "$f" >> "$OUT/list.$(( i % WORKERS ))"
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

failed=""
for p in $pids; do
  wait "${p%%:*}" || failed="$failed ${p##*:}"
done

total=0
for w in $(seq 0 $(( WORKERS - 1 ))); do
  [ -f "$OUT/out.$w" ] || continue
  if [[ " $failed " == *" $w "* ]]; then
    echo "--- worker $w: RED"
    cat "$OUT/out.$w"
  else
    ran=$(grep -E '^Ran [0-9]+ tests' "$OUT/out.$w" | tail -1)
    n=$(echo "$ran" | sed -E 's/^Ran ([0-9]+) tests.*/\1/')
    total=$(( total + ${n:-0} ))
    printf -- '--- worker %s  %s\n' "$w" "$ran"
  fi
done
echo "--- $total tests across $WORKERS workers"

if [ -n "$failed" ]; then
  echo "red: worker(s)$failed"
  exit 1
fi
