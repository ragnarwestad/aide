#!/usr/bin/env bash
# What the AI's provider said when a turn ended `cli-error`, sorted for the
# board. `run_model_turn` (run-spec/turn/model-turn.sh) calls it on the
# tool's own words, and the result carries the answer as `providerError`:
#   {kind, message}
# `kind` is `login` when the tool is not logged in on this machine (a 401
# or 403, a missing or invalid key or token, an expired session),
# `provider` when the provider's own side failed (a 5xx, overloaded, the
# network), and `other` for anything else. `message` is the tool's own
# first line, cleaned and cut at a word, which the board shows as the
# cause; the whole of what the tool said stays in the result's `error`.
#
# A status is matched only where it stands as one ("status 401",
# "API Error: 500", "502 Bad Gateway"): the request ids and cf-rays in
# Codex's messages are hex, and a bare 401 or 500 turns up in them.

# provider_error_json <what the tool said> [<HTTP status>] [<the error name the tool gave>]
provider_error_json() {
  jq -cn --arg said "${1:-}" --arg status "${2:-}" --arg name "${3:-}" '
    ($said | gsub("\u001b\\[[0-9;]*[A-Za-z]"; "")) as $plain
    | [$plain | split("\n")[] | gsub("^\\s+|\\s+$"; "") | select(length > 0)] as $lines
    | if ($lines | length) == 0 then empty else
      ($lines[0] | gsub(" — "; ", ") | gsub("\\s+"; " ") | sub("\\.+$"; "")) as $first
      | ($first | if length <= 160 then . else
          .[0:160] as $cut
          | ($cut | [match(" "; "g").offset] | last // 0) as $space
          | (if $space > 80 then $cut[0:$space] else $cut end) + "…"
        end) as $message
      | ($status | tonumber? // 0) as $code
      | (if $code == 403 or ($plain | test("api error: 403\\b|status 403\\b|\\b403 forbidden"; "i")) then "forbidden"
         elif $code == 401 or ($name | test("auth"; "i"))
            or ($plain | test("not logged in|please run /login|failed to authenticate|authentication (failed|required|error)|status 401\\b|\\b401 unauthorized|missing bearer|invalid (api[ _-]?key|x-api-key|bearer|access token|token)|api[ _-]?key (is )?(missing|invalid|not set)|(token|session|credentials?) (has |have )?(been )?(expired|revoked)|session expired"; "i"))
         then "login"
         elif $code >= 500 or ($name | test("server_error|overloaded"; "i"))
            or ($plain | test("api error: 5[0-9][0-9]\\b|status 5[0-9][0-9]\\b|\\b5[0-9][0-9] (internal server error|bad gateway|service unavailable|gateway time-?out)|internal server error|server-side|bad gateway|service unavailable|gateway time-?out"; "i"))
         then "provider"
         elif ($plain | test("enotfound|eai_again|econnrefused|connection (refused|error)|network error|fetch failed|could not resolve host"; "i")) then "network"
         elif ($name | test("api_error"; "i")) or ($plain | test("overloaded|stream disconnected|connection (reset|closed)|econnreset|etimedout|socket hang up"; "i")) then "provider"
         else "other" end) as $kind
      | {kind: $kind, message: $message}
      end'
}

provider_error_ending() {
  case "${1:-other}" in
    login) printf '%s' "log in to $2 on the serving host, then press $3 again" ;;
    forbidden) printf '%s' "check that the account may use this model, then press $3 again" ;;
    network) printf '%s' "check the network from the serving host, then press $3 again" ;;
    *) printf '%s' "press $3 again" ;;
  esac
}
