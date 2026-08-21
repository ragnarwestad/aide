#!/usr/bin/env bash
# notify-slack.sh — the queue's notification wrapper (spec 81, slice
# 81c). Reads ONE line of JSON on stdin (the notifier's payload) and
# posts one line to a Slack incoming webhook.
#
# The notifier knows nothing about Slack: it runs whatever argv the
# queue config names, with no shell. Swapping the target is therefore an
# edit to that one config line, and this script is the only place that
# knows what a webhook is.
#
# The webhook URL is a SECRET — anyone holding it can post to the
# channel — so it lives in a file outside both repos, never in an
# argument (`ps` shows arguments to every user on the machine).
#
#   echo '{"event":"finished",...}' | notify-slack.sh
#
# Env: AIDE_SLACK_WEBHOOK_FILE (default ~/aide-dashboard/slack-webhook)
#
# Exits 0 whatever happens: a failed notification must never be treated
# as a failed run.
set -u

webhook_file="${AIDE_SLACK_WEBHOOK_FILE:-$HOME/aide-dashboard/slack-webhook}"
[ -r "$webhook_file" ] || exit 0
webhook="$(tr -d '[:space:]' < "$webhook_file")"
[ -n "$webhook" ] || exit 0

command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

payload="$(cat)"
[ -n "$payload" ] || exit 0

# One line, in the order a reader needs it: which project, which spec,
# what happened, what it cost, where to look.
text="$(printf '%s' "$payload" | jq -r '
  def money: if (.costUsd // 0) > 0 then " · $" + ((.costUsd * 100 | round) / 100 | tostring) else "" end;
  def what:
    if .event == "finished" then ((.step // "the last step") + " done")
    elif .event == "stopped" then ("stopped: " + (.reason // "a cap"))
    else ("failed: " + (.reason // "unknown")) end;
  (.project // "?") + " · " + (.spec // "?") + " · " + what + money
  + (if .branchUrl then " · " + .branchUrl else "" end)
' 2>/dev/null)"
[ -n "$text" ] || exit 0

curl -s --max-time 5 -X POST -H 'content-type: application/json' \
  --data "$(jq -cn --arg t "$text" '{text: $t}')" "$webhook" >/dev/null 2>&1
exit 0
