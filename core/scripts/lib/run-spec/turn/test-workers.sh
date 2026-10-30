#!/usr/bin/env bash
# run-spec/turn/test-workers.sh — sourced by aide-run-spec before run-spec/turn/model-turn.sh.
#
# How many test workers a run may use: the host's cores divided among the
# steps and landings running on the board at this moment, rounded down and
# at least one. The board hands over its queue mirror as AIDE_QUEUE_MIRROR;
# a runner started by hand has none and works out no share. `testWorkerShare`
# (dashboard/src/queue/test-workers.ts) makes the same decision for the
# landing; core/tests/fixtures/test-workers.json pins both.

host_cores() {
  getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 1
}

# $1 = the host's cores, $2 = the queue mirror. A mirror that cannot be read
# counts as this step alone.
test_workers_share() {
  local busy share
  busy="$(jq '[if type == "array" then .[] else empty end
    | select(type == "object" and (.state == "running" or .landing == true))] | length' "$2" 2>/dev/null)"
  [ "${busy:-0}" -ge 1 ] 2>/dev/null || busy=1
  share=$(( $1 / busy ))
  [ "$share" -ge 1 ] || share=1
  echo "$share"
}

# The share now, or nothing when the board named no mirror.
test_workers_now() {
  [ -n "${AIDE_QUEUE_MIRROR:-}" ] || return 0
  test_workers_share "$(host_cores)" "$AIDE_QUEUE_MIRROR"
}
