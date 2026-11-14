#!/usr/bin/env bash
# board-request.sh — how `aide` and `aide-hand-off` talk to the board: the
# project and the board's address, one request with its timeouts, the
# board's refusal as a sentence, and the check that a board is set and knows
# the project. Sourced by core/scripts/aide and core/scripts/aide-hand-off,
# after _aide-spec-lib.sh; each defines die() and sets project.

# The exit for "there is no board for this project here": no address, no
# curl, or a board that does not know the project. A caller tells it from a
# refusal (exit 1) by the code alone.
NO_BOARD_EXIT=3

# How long to wait for the board: the connection, then an answer. The
# reads wait CHECK_SECONDS. The specs fetch before every command asks
# origin, and a request that queues something is answered only after a
# scheduler pass, which may ask origin about each queued job's
# dependencies, so both wait longer.
CONNECT_SECONDS=3
CHECK_SECONDS=15
ANSWER_SECONDS="${AIDE_BOARD_ANSWER_SECONDS:-60}"

# ---------------------------------------------------------------------------
# The project and the board
# ---------------------------------------------------------------------------

project_root=""
own_project=""
board_url=""

find_own_project() {
  project_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  own_project="$(aide_manifest_get name "$project_root")"
  [ -n "$own_project" ] || own_project="$(basename "$project_root")"
}

read_board_url() {
  board_url="$(aide_config_get AIDE_BOARD_URL "$HOME")"
  board_url="${board_url%/}"
}

no_board() {
  echo "aide: $*" >&2
  exit "$NO_BOARD_EXIT"
}

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
  [ -n "$board_url" ] || no_board "AIDE_BOARD_URL is not set in ~/.aide/config, so there is no board to $what$tail"
  command -v curl >/dev/null 2>&1 || no_board "curl is not on this machine, so there is no way to reach the board$tail"
  # The fetch asks origin and rereads the project, which a loaded board
  # takes as long over as a queued request.
  http_or_die POST "/api/queue/projects/$project/fetch-specs" "$ANSWER_SECONDS"
  case "$http_status" in
    404) no_board "the board at $board_url does not know the project $project, so there is nothing to $what$tail" ;;
    200|400) ;;
    *) refuse ;;
  esac
}
