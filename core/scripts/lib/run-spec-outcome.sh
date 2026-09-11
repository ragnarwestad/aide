#!/usr/bin/env bash
# run-spec-outcome.sh — this phase's own outcome record.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were.
# --- this phase's own outcome record (spec 245) ------------------------------
# `Workflow steps completed` (below) answers "did the SPEC run this step";
# this answers "how did THIS phase go" — and is written into the phase's
# own artifact file, not 4-status.md, for every one of the four phases
# (archive's own copy IS in 4-status.md, since that file is archive's own
# artifact). Independent of $status_file on purpose (spec 343 tried
# nesting this inside the same gate as the line and broke a plain
# `create` run: a brand-new spec's 1-description.md is real before
# 4-status.md exists yet, so gating THIS record on the LATTER file left a
# fresh `create` step's own phase record unwritten). Unconditional, and
# therefore still positioned before PASS 1 exactly as it always was — its
# `Result:` line reflects terminal_reason as cross-checks above left it,
# same as every terminal_reason this script already had before spec 343;
# a run that goes on to end `unpushed` (the gate below, REQ-1) is the one
# new case where this record can read stale (it was written on the
# strength of a "completed" the push did not, in the end, confirm), which
# no REQ-1 through REQ-6 asks this record to guard against — only the
# `Workflow steps completed` line itself carries that guarantee.
phase_file_for "$command_name" "$commit_label"
if [ -n "$phase_file" ]; then
  run_stamp="$(date -u -r "$started_at" +'%Y-%m-%d %H:%M UTC')"
  # Overwrites whatever value the field already had (a plain date the
  # skill wrote, or a stale placeholder) — the script is authoritative
  # for this phase's own timestamp from here on, same as it already is
  # for Workflow steps completed.
  date_field="$(date_field_for "$command_name")"
  sed -E "s/(^- \*\*${date_field}:\*\*[[:space:]]*\`)[^\`]*(\`)/\1${run_stamp}\2/" \
    "$phase_file" > "$work_dir/phase-file-dated" 2>/dev/null && \
    mv "$work_dir/phase-file-dated" "$phase_file"

  if [ "$terminal_reason" = "completed" ]; then
    result_line="completed"
  else
    result_line="stopped ($terminal_reason)"
    if [ -n "$error_msg" ]; then
      summary="$(printf '%s' "$error_msg" | tr '\n' ' ' | tr -d '\`' | cut -c1-200)"
      result_line="$result_line — $summary"
    fi
  fi
  # The STEP's own span, not the AI session's (2026-09-08): the checkout,
  # the worktree, the branch, the archive pre-check and the reading of
  # what came back all belong to the time this phase took. Only the
  # commit and push that carry this very line fall outside it — a number
  # cannot include the writing of its own file.
  step_duration=$(( $(date +%s) - ${step_started_at:-$(( $(date +%s) - duration ))} ))
  [ "$step_duration" -lt "$duration" ] && step_duration="$duration"
  time_spent_display="$(printf '%dm%02ds' $(( step_duration / 60 )) $(( step_duration % 60 )))"
  # This phase's own running count (spec 341): read the stamp's CURRENT
  # value before the block below replaces it, then add one for this run.
  # The queue's own job memory is bounded and drops the earliest attempts
  # first, so this file is the only place the true count survives.
  prior_attempts="$(grep -oE '^- \*\*Attempts:\*\*[[:space:]]*[0-9]+' "$phase_file" 2>/dev/null \
    | grep -oE '[0-9]+$')"
  # A run the archive gates turned away before anything was tried is a
  # guard, not an attempt: the count stays what it was. The same two
  # reasons the dashboard leaves out of its own count (phase-rows.ts).
  case "$terminal_reason" in
    not-implemented-yet|acceptance-criteria-unticked) attempts_display=${prior_attempts:-0} ;;
    *) attempts_display=$(( ${prior_attempts:-0} + 1 )) ;;
  esac
  cost_line=""
  if [ "$cost_known" = "true" ]; then
    cost_line="$(printf '$%.4f' "$cost")"
    [ "$cost_measured" = "false" ] && cost_line="$cost_line (unmeasured)"
  fi
  # The step's total token count, off the same `tokens_json` the result
  # JSON already carries (spec 118/125) — absent, never 0, on the same
  # "measured or not written at all" terms as Cost. Written independently
  # of Cost: a Codex phase gets Tokens with no Cost line at all.
  tokens_line=""
  [ -n "$tokens_json" ] && tokens_line="$(jq -r '.total // empty' <<<"$tokens_json" 2>/dev/null)"
  : > "$work_dir/phase-outcome"
  # `Repo` is absent for `create`: nothing has been analyzed against yet
  # (the issue itself lists only creation time as new for that phase).
  if [ "$command_name" != "create" ]; then
    i=0
    for root in "${roots[@]}"; do
      # A root this run never checked out has no head_before, and an
      # empty sha is worse than an absent line — absence over a guess,
      # the same rule already used for Model.
      if [ -n "${head_before[$i]:-}" ]; then
        printf -- '- **Repo:** `%s/%s @ %s`\n' \
          "$(basename "$root")" "$branch" "${head_before[$i]:0:8}" >> "$work_dir/phase-outcome"
      fi
      i=$(( i + 1 ))
    done
  fi
  [ -n "$model_value" ] && printf -- '- **Model:** %s\n' "$model_value" >> "$work_dir/phase-outcome"
  [ -n "$effort" ] && printf -- '- **Effort:** %s\n' "$effort" >> "$work_dir/phase-outcome"
  printf -- '- **Result:** %s\n' "$result_line" >> "$work_dir/phase-outcome"
  printf -- '- **Time spent:** %s\n' "$time_spent_display" >> "$work_dir/phase-outcome"
  [ "$attempts_display" -gt 0 ] && printf -- '- **Attempts:** %s\n' "$attempts_display" >> "$work_dir/phase-outcome"
  [ -n "$cost_line" ] && printf -- '- **Cost:** %s\n' "$cost_line" >> "$work_dir/phase-outcome"
  [ -n "$tokens_line" ] && printf -- '- **Tokens:** %s\n' "$tokens_line" >> "$work_dir/phase-outcome"
  # Scoped to INSIDE `## Tracking info` only (in_tracking), never the
  # whole file — a `Result:`-shaped bullet written by the model in
  # Findings or Risk-analysis prose is not this record and must survive.
  awk -v block="$work_dir/phase-outcome" '
    function emit_block(  ln) { while ((getline ln < block) > 0) print ln; close(block) }
    BEGIN { written = 0; in_tracking = 0 }
    /^## Tracking info/ {
      print; in_tracking = 1
      if ((getline nextline) > 0) {
        if (nextline ~ /^[ \t]*$/) { print nextline; emit_block(); written = 1 }
        else { emit_block(); written = 1; print nextline }
      } else { emit_block(); written = 1 }
      next
    }
    in_tracking && /^## / { in_tracking = 0 }
    in_tracking && /^- \*\*(Repo|Model|Effort|Result|Time spent|Attempts|Cost|Tokens):\*\*/ { next }
    { print }
  ' "$phase_file" > "$work_dir/phase-file-out" 2>/dev/null
  if [ -s "$work_dir/phase-file-out" ] && ! cmp -s "$work_dir/phase-file-out" "$phase_file"; then
    cat "$work_dir/phase-file-out" > "$phase_file" 2>/dev/null || true
  fi
fi
