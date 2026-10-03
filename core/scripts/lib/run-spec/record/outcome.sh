#!/usr/bin/env bash
# run-spec/record/outcome.sh — this phase's own outcome record.
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
  # The phase's total cost, like Attempts its count: this run's cost is
  # added to what the file already holds, so an archived spec's cost is
  # every run of it, as the board summed it while the spec was live. A
  # total with an unmeasured part is unmeasured; a run with no cost of its
  # own (Codex), or a run the archive gates turned away, leaves the
  # earlier total as it was.
  turned_away="false"
  case "$terminal_reason" in
    not-implemented-yet|acceptance-criteria-unticked) turned_away="true" ;;
  esac
  run_has_cost="$cost_known"
  [ "$turned_away" = "true" ] && run_has_cost="false"
  prior_cost_bullet="$(grep -E '^- \*\*Cost:\*\*[[:space:]]*\$[0-9]' "$phase_file" 2>/dev/null | head -1)"
  prior_cost="$(printf '%s' "$prior_cost_bullet" | grep -oE '\$[0-9]+(\.[0-9]+)?' | tr -d '$')"
  prior_unmeasured="false"
  case "$prior_cost_bullet" in *"(unmeasured)"*) prior_unmeasured="true" ;; esac
  cost_line=""
  if [ "$run_has_cost" = "true" ]; then
    cost_line="$(awk -v a="${prior_cost:-0}" -v b="$cost" 'BEGIN { printf "$%.4f", a + b }')"
    if [ "$cost_measured" = "false" ] || [ "$prior_unmeasured" = "true" ]; then
      cost_line="$cost_line (unmeasured)"
    fi
  elif [ -n "$prior_cost" ]; then
    cost_line="$(printf '$%.4f' "$prior_cost")"
    [ "$prior_unmeasured" = "true" ] && cost_line="$cost_line (unmeasured)"
  fi
  # The phase's total token count, added to across runs like Cost, off the
  # same `tokens_json` the result JSON already carries (spec 118/125) —
  # absent, never 0, on the same "measured or not written at all" terms.
  # Written independently of Cost: a Codex phase gets Tokens with no Cost
  # line at all.
  prior_tokens="$(grep -oE '^- \*\*Tokens:\*\*[[:space:]]*[0-9]+' "$phase_file" 2>/dev/null \
    | head -1 | grep -oE '[0-9]+$')"
  run_tokens=""
  if [ "$turned_away" = "false" ] && [ -n "$tokens_json" ]; then
    run_tokens="$(jq -r '.total // empty' <<<"$tokens_json" 2>/dev/null)"
  fi
  tokens_line="$prior_tokens"
  [ -n "$run_tokens" ] && tokens_line=$(( ${prior_tokens:-0} + run_tokens ))
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
        # shellcheck disable=SC2016  # the backticks are markdown, printed as they are
        printf -- '- **Repo:** `%s/%s @ %s`\n' \
          "$(basename "$root")" "$branch" "${head_before[$i]:0:8}" >> "$work_dir/phase-outcome"
      fi
      i=$(( i + 1 ))
    done
  fi
  [ -n "$model_value" ] && printf -- '- **Model:** %s\n' "$model_value" >> "$work_dir/phase-outcome"
  [ -n "${model_id_out:-}" ] && printf -- '- **Model id:** %s\n' "$model_id_out" >> "$work_dir/phase-outcome"
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
    in_tracking && /^- \*\*(Repo|Model|Model id|Effort|Result|Time spent|Attempts|Cost|Tokens):\*\*/ { next }
    { print }
  ' "$phase_file" > "$work_dir/phase-file-out" 2>/dev/null
  if [ -s "$work_dir/phase-file-out" ] && ! cmp -s "$work_dir/phase-file-out" "$phase_file"; then
    cat "$work_dir/phase-file-out" > "$phase_file" 2>/dev/null || true
  fi
  # The acceptance criteria checks level the New-spec form chose, recorded
  # in a completed create's own description, where analyze reads it.
  # Written here rather than by the create session, so both create paths
  # record it the same way.
  if [ "$command_name" = "create" ] && [ "$terminal_reason" = "completed" ] && [ -n "${criteria_checks_arg:-}" ]; then
    if ! { declare -f aide_spec_record_criteria_checks >/dev/null 2>&1 \
      && aide_spec_record_criteria_checks "$phase_file" "$criteria_checks_arg"; }; then
      stage "could not record the acceptance criteria checks level $criteria_checks_arg: the description has no Created line, so analyze reads it as off"
    fi
  fi
fi
