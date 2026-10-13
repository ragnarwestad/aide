#!/usr/bin/env bash
# run-spec/turn/time-limit.sh — sourced by aide-run-spec before run-spec/turn/model-turn.sh.
#
# A step's time limit as its stop sentence says it: in minutes, the unit the
# Settings page sets it in ("40-minute"). A limit that is not whole minutes,
# a test's or a hand-written config's, is said in seconds ("90-second").
time_limit_words() {
  local sec="$1"
  if [ "$sec" -gt 0 ] && [ $((sec % 60)) -eq 0 ]; then
    echo "$((sec / 60))-minute"
  else
    echo "${sec}-second"
  fi
}
