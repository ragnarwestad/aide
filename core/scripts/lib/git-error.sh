#!/usr/bin/env bash
# What git said when a push failed, sorted for the board. Sourced by
# aide-run-spec (run-spec/publish/publish.sh) and aide-push-specs; the
# landing sorts its own pushes the same way in TypeScript
# (dashboard/src/format/git-error.ts), and core/tests/fixtures/git-errors.json
# pins both.
#
#   git_error_json <what git said> [<repo>] [<branch>]
#     {kind, message?, repo?, branch?}
#     `auth`     GitHub does not take the machine's SSH key
#     `no-write`, `https-auth`, `network` carry git's own first line
#     `github`   GitHub had an error (a 5xx)
#     `refused`  origin turned the push down (a protected branch, a hook,
#                a non-fast-forward); `message` is origin's own first line
#     `other`    anything else; `message` is git's own first line
#     `none`     git said nothing
#   git_error_detail <what git said>
#     git's text in whole lines, without colour codes, carriage returns
#     or blank lines, eight lines at most: what the row keeps behind its (?).
#
# Sorted in this order: an SSH key fault is followed by "Could not read
# from remote repository", which a network failure prints too, and
# GitHub's 500 arrives on a `[remote rejected]` line.

# The jq both functions start from: the text as clean, non-empty lines.
GIT_ERROR_LINES_JQ='[gsub("\u001b\\[[0-9;]*[A-Za-z]"; "") | split("\r\n") | join("\n") | split("\r") | join("\n")
  | split("\n")[] | gsub("^\\s+|\\s+$"; "") | select(length > 0)]'

git_error_detail() {
  jq -jn --arg said "${1:-}" "\$said | $GIT_ERROR_LINES_JQ"' | .[0:8] | join("\n")'
}

git_error_json() {
  jq -cn --arg said "${1:-}" --arg repo "${2:-}" --arg branch "${3:-}" "\$said | $GIT_ERROR_LINES_JQ"' as $lines
    | ($lines | join("\n")) as $all
    | (if ($lines | length) == 0 then "none"
       elif ($all | test("permission denied \\(publickey"; "i")) then "auth"
       elif ($all | test("permission to \\S+ denied|returned error: 403\\b"; "i")) then "no-write"
       elif ($all | test("authentication failed|could not read (username|password)|invalid username or password|returned error: 401\\b"; "i")) then "https-auth"
       elif ($all | test("internal server error|returned error: 5[0-9][0-9]\\b|http 5[0-9][0-9]\\b|\\b5[0-9][0-9] (bad gateway|service unavailable|gateway time-?out)|bad gateway|service unavailable|connection (reset|closed)|the remote end hung up unexpectedly"; "i")) then "github"
       elif ($all | test("could not resolve host|connection (timed out|refused)|operation timed out|network is unreachable|no route to host|temporary failure in name resolution"; "i")) then "network"
       elif ($all | test("\\[(remote )?rejected\\]|non-fast-forward|protected branch|\\bGH[0-9]{3}\\b|hook declined"; "i")) then "refused"
       else "other" end) as $kind
    | ([$lines[] | sub("^remote:\\s*"; "")
        | select(length > 0 and (test("^(To |hint:|error: failed to push some refs|fatal: Could not read from remote repository|Please make sure you have|and the repository exists)") | not))]
       | (.[0] // $lines[0] // "")
       | sub("^(! |error: |fatal: |ERROR: )"; "") | gsub("\\s+"; " ") | sub("\\.+$"; "")) as $first
    | ($first | if length <= 160 then . else
        .[0:160] as $cut
        | ($cut | [match(" "; "g").offset] | last // 0) as $space
        | (if $space > 80 then $cut[0:$space] else $cut end) + "…"
      end) as $message
    | {kind: $kind}
      + (if (["no-write", "https-auth", "network", "refused", "other"] | index($kind)) then {message: $message} else {} end)
      + (if $repo == "" then {} else {repo: $repo} end)
      + (if $branch == "" then {} else {branch: $branch} end)'
}
