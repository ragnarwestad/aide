#!/usr/bin/env bash
# board-request.sh — how `aide` talks to the board: one request with its
# timeouts, the board's refusal as a sentence, and the check that a board is
# set and knows the project. Sourced by core/scripts/aide alone, which sets
# board_url, project, and the timeouts below, and defines die().

# ---------------------------------------------------------------------------
# Talking to the board
# ---------------------------------------------------------------------------

answer_file=""
http_status=""
transport_error=""

# http <method> <path> <seconds> [<json body>]
# Sets http_status and leaves the answer in $answer_file. Returns 1, with
# transport_error set, when the board could not be reached or did not answer.
http() {
  local method="$1" path="$2" limit="$3" body="${4:-}" out curl_exit connected
  : > "$answer_file"
  transport_error=""
  if [ -n "$body" ]; then
    out="$(printf '%s' "$body" | curl -s -o "$answer_file" -w '%{http_code} %{time_connect}' \
      --connect-timeout "$CONNECT_SECONDS" --max-time "$limit" -X "$method" \
      -H 'Content-Type: application/json' --data-binary @- "$board_url$path" 2>/dev/null)"
  else
    out="$(curl -s -o "$answer_file" -w '%{http_code} %{time_connect}' \
      --connect-timeout "$CONNECT_SECONDS" --max-time "$limit" -X "$method" "$board_url$path" 2>/dev/null)"
  fi
  curl_exit=$?
  http_status="${out%% *}"
  if [ "$curl_exit" -ne 0 ]; then
    connected="${out#* }"
    if [ "$curl_exit" -eq 28 ] && awk -v t="$connected" 'BEGIN { exit !(t + 0 > 0) }'; then
      transport_error="the board at $board_url did not answer within $limit seconds"
      [ "$method" = "POST" ] && transport_error="$transport_error; the request may have been queued — look at the board before running it again"
    else
      transport_error="the board at $board_url could not be reached"
    fi
    return 1
  fi
  return 0
}

http_or_die() {
  http "$@" || die "$transport_error"
}

# Print the board's own reason for a refusal and leave. A close for a spec
# the board does not know answers a plain-text 404.
refuse() {
  local reason
  reason="$(jq -r 'if type == "object" then (.error // empty | if type == "string" then . else tojson end) else empty end' \
    "$answer_file" 2>/dev/null)"
  if [ -z "$reason" ]; then
    if [ "$http_status" = "404" ] && [ -n "${refused_spec:-}" ]; then
      reason="the board has no spec $refused_spec in $project"
    else
      reason="$(grep -m1 . "$answer_file" 2>/dev/null | cut -c1-200)"
    fi
  fi
  [ -n "$reason" ] || reason="the board answered with status $http_status"
  die "$reason"
}

accepted() {
  [ "$http_status" = "200" ] && jq -e '.ok == true' "$answer_file" >/dev/null 2>&1
}

# The board must be set and must know the project before anything else.
# $1 names what the user wanted, $2 the skill to run instead ("" for status).
require_board() {
  local what="$1" instead="$2" tail=""
  [ -n "$instead" ] && tail=" — run $instead in an AI session instead"
  [ -n "$board_url" ] || die "AIDE_BOARD_URL is not set in ~/.aide/config, so there is no board to $what$tail"
  command -v curl >/dev/null 2>&1 || die "curl is not on this machine, so there is no way to reach the board$tail"
  http_or_die POST "/api/queue/projects/$project/fetch-specs" "$CHECK_SECONDS"
  case "$http_status" in
    404) die "the board at $board_url does not know the project $project, so there is nothing to $what$tail" ;;
    200|400) ;;
    *) refuse ;;
  esac
}
