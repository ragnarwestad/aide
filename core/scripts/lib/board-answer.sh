#!/usr/bin/env bash
# board-answer.sh — the sentences `aide` prints from what the board's JSON
# answers hold. Sourced by core/scripts/aide alone.
#
# The board words its answers in its own TypeScript catalogue, which is not
# installed beside the scripts, so a job held back arrives as a message KEY
# with values (`runner.dependencyNotArchived`, {dependency: "aide:721"}).
# The keys worded here are every hold a spec's own job can meet; any other
# key is said as "held back on the board", never left out.
#
# board_models_phrase  <job-json>                 " on Opus" / " on create Opus, analyze Sonnet" / ""
# board_wait_phrase    <job-json> <jobs-json>     what the job waits for, or that it starts now
# board_answer_sentence <what> <job-json> <jobs-json | ->
#                                                 "Queued <what> on <model>; <wait>."
# board_job_clause     <job-json> <jobs-json>     what a spec's newest job is doing, for `aide status`
#
# <job-json> is a job record as the board stores it; <jobs-json> is the
# list of every job (used to find another job of the same spec). Either
# may be empty when a read failed, and the part it would have written is
# left out.

# The AI behind each model choice, from the queue config on this machine
# (the board's host has it); a choice with no tool runs on claude. Empty
# object when this machine has no such file.
board_tools_json() {
  local file="$HOME/.aide/dashboard/queue-config.json"
  [ -f "$file" ] || { echo '{}'; return 0; }
  jq -c '(.modelChoices // {}) | with_entries(.value = (.value.tool // "claude"))' "$file" 2>/dev/null || echo '{}'
}

# The model each step runs on with its AI when known, and the provider when
# the job carries one.
board_models_phrase() {
  local job="$1"
  [ -n "$job" ] || return 0
  jq -r --argjson tools "$(board_tools_json)" '
    def with_ai: . as $m | $m + (if $tools[$m] then " (\($tools[$m]))" else "" end);
    . as $job
    | ([($job.steps // [])[] as $s | {s: $s, m: ($job.model[$s] // null)}] | map(select(.m != null))) as $per
    | (if ($per | length) == 0 then ""
       elif ([$per[].m] | unique | length) == 1 then " on " + ($per[0].m | with_ai)
       else " on " + ($per | map("\(.s) \(.m | with_ai)") | join(", ")) end) as $on
    | (($job.provider // null) | if . == null then ""
       elif type == "object" then (([.[]] | unique | join(", ")) as $p | if $p == "" then "" else " via " + $p end)
       else " via " + tostring end) as $via
    | $on + $via' <<<"$job" 2>/dev/null
}

# What a job waits for. A hold-back is a message key; a queued job with no
# hold waits for another job of its spec, or for a free place.
board_wait_phrase() {
  local job="$1" jobs="${2:-[]}"
  [ -n "$job" ] || return 0
  [ -n "$jobs" ] || jobs="[]"
  jq -r --argjson all "$jobs" '
    . as $j
    | if $j.state == "running" then "it starts now"
      elif $j.state == "queued" then
        ($j.error // null) as $e
        | if ($j.errorReason == "held-back") and ($e | type == "object") then
            ($e.key // "") as $k | ($e.values // {}) as $v
            | if $k == "runner.dependencyNotArchived" then "it waits for \($v.dependency // "its dependency") to be archived"
              elif $k == "runner.archiveRunning" then "it waits for the archive already running in \($j.project)"
              elif $k == "runner.notAnalyzed" then "it waits until the spec has been analyzed"
              elif $k == "runner.approachChoice" then "it waits for an approach to be chosen on the board"
              elif ($k == "runner.usageLimitHeld" or $k == "runner.usageLimitHeldProbe") then "it waits for \($v.provider // "the provider")'"'"'s usage limit to reset"
              elif $k == "runner.providerSwitchedOff" then "it waits for \($v.provider // "the provider") to be switched on"
              else "it is held back on the board" end
          else
            ([$all[] | select(.id != $j.id and .project == $j.project and .specFolder == $j.specFolder
                              and (.state == "running" or .landing == true))] | first // null) as $o
            | if $o != null then "it waits for \(($o.steps // [])[$o.stepIndex // 0] // "another step") of the same spec to finish"
              else "it waits for a free place in the queue" end
          end
      else "it has already ended \($j.state)" end' <<<"$job" 2>/dev/null
}

board_answer_sentence() {
  local what="$1" job="${2:-}" jobs="${3:-[]}" models wait
  models="$(board_models_phrase "$job")"
  # "-" says the wait could not be read: the sentence then stops at the model.
  wait=""
  [ "$jobs" = "-" ] || wait="$(board_wait_phrase "$job" "$jobs")"
  if [ -n "$wait" ]; then
    printf 'Queued %s%s; %s.\n' "$what" "$models" "$wait"
  else
    printf 'Queued %s%s.\n' "$what" "$models"
  fi
}

# What the newest job of a spec is doing, as the tail of a sentence:
# "its job is running implement on Sonnet".
board_job_clause() {
  local job="${1:-}" jobs="${2:-[]}" models wait
  [ -n "$job" ] || { printf 'there is no job on the board'; return 0; }
  models="$(board_models_phrase "$job")"
  wait="$(board_wait_phrase "$job" "$jobs")"
  jq -r --arg models "$models" --arg wait "$wait" '
    . as $j
    | (($j.results // []) | last // null) as $last
    | (if $j.state == "running" or $j.state == "queued" then ($j.steps // [])[$j.stepIndex // 0]
       else ($last.step // ($j.steps // [])[$j.stepIndex // 0]) end // "a step") as $step
    | if $j.state == "running" then "its job is running \($step)\($models)"
      elif $j.state == "queued" then "its job is queued for \($step)\($models); \($wait)"
      else "its newest job ended \($j.state) at \($step)"
           + (if $j.stopReason then " (\($j.stopReason))" else "" end)
           + (if $last.tool then " on \($last.tool)" else "" end) end' <<<"$job" 2>/dev/null
}
