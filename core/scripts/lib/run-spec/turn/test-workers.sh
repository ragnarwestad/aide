#!/usr/bin/env bash
# Only live test recorders share test capacity. AI turns and lock waits
# have no marker. All board callers use the same queue-mirror namespace.
host_cores() {
  getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 1
}

test_worker_marker=""
test_workers_now() {
  [ -n "${AIDE_QUEUE_MIRROR:-}" ] || return 0
  local dir="${AIDE_QUEUE_MIRROR}.test-runs" marker pid busy=0 cores
  for marker in "$dir"/run.*; do
    [ -f "$marker" ] || continue
    pid="${marker##*/run.}"
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    if kill -0 "$pid" 2>/dev/null; then
      busy=$((busy + 1))
    else
      rm -f "$marker"
    fi
  done
  [ "$busy" -gt 0 ] || busy=1
  cores="$(host_cores)"
  [ "$cores" -ge "$busy" ] && echo "$((cores / busy))" || echo 1
}

test_workers_begin() {
  [ -n "${AIDE_QUEUE_MIRROR:-}" ] || return 0
  local dir="${AIDE_QUEUE_MIRROR}.test-runs"
  mkdir -p "$dir" || return 1
  test_worker_marker="$dir/run.$$"
  : > "$test_worker_marker" || return 1
  AIDE_TEST_WORKERS="$(test_workers_now)"
  export AIDE_TEST_WORKERS
}

test_workers_end() {
  [ -z "$test_worker_marker" ] || rm -f "$test_worker_marker"
}
