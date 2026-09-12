#!/usr/bin/env bash
# run-spec-status-line.sh — writing this step into the status file, once it has actually succeeded.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were.
# Where the file's own Phase/Fase/Acceptance tables stand right now
# (spec 246, widened spec 285) — status_progress_for, sourced from
# core/scripts/lib/status-progress.sh, is the shared bash mirror of
# `dashboard/src/parse-status.ts`'s `tableCells`/`isDoneMark`. Kept in
# sync with that TypeScript rule by
# `tests/fixtures/status-row-counting.json`, read by a test on each side.
# aide-archive-spec sources the same helper for its own, narrower,
# Acceptance-only gate.

# Only the five steps the line is ABOUT write it. `explore` and
# `manifest` leave the file exactly as they found it: neither is
# a stage a spec passes through, and an explore run that today writes
# nothing at all must not start leaving a commit — and with it a branch
# no step lands — for a line it has no news about.
status_file=""
case " $WORKFLOW_ARC " in
  *" $command_name "*) status_file_for "$commit_label" ;;
esac
if [ -n "$status_file" ]; then
  # --- spec 268: a "completed" implement claim is cross-checked ------------
  # The CLI's own turn-subtype is not enough on its own: a step that reports
  # success while leaving no real trace must not count as `implement` for
  # "Workflow steps completed", or archive's own gate (which now asks only
  # whether implement ran, never what the checklist says) would let a vacuous
  # run through.
  if [ "$command_name" = "implement" ] && [ "$terminal_reason" = "completed" ]; then
    proj_changed="no"
    proj_head_now="$(git -C "$project_wt" rev-parse HEAD 2>/dev/null || echo "")"
    if [ "$proj_head_now" != "${head_before[0]}" ]; then
      proj_changed="yes"
    else
      proj_dirty="$(git -C "$project_wt" status --porcelain -- . \
        ${git_add_excludes[@]+"${git_add_excludes[@]}"} 2>/dev/null | wc -l | tr -d ' ')"
      [ "$proj_dirty" -gt 0 ] && proj_changed="yes"
    fi
    # A CHANGE IN THE PROJECT is the whole test. Whether the run also
    # ticked its own Phase rows used to be half of it, and is not any
    # more: a Phase table is the run's own record of its work, gating
    # nothing (archive's only gate is `## Acceptance criteria`), so
    # failing a step that wrote real code because its bookkeeping lagged
    # turned a record-keeping slip into a red run someone had to
    # re-drive.
    if [ "$proj_changed" != "yes" ]; then
      terminal_reason="no-progress"
      ok="false"
      suffix=" (stopped: no-progress)"
      error_msg="The step reported success but left no real progress — nothing changed in the project. Press $step_button again for this step."
    fi
  elif [ "$command_name" = "archive" ] && [ "$terminal_reason" = "completed" ]; then
    # spec 280: a "completed" archive claim is cross-checked the same
    # way spec 268 cross-checks implement. status_file_for's own
    # two-candidate resolution (active folder, then archive/) already
    # proves whether the mechanical stamp-and-move
    # (core/scripts/aide-archive-spec) actually ran in THIS worktree —
    # a claim not backed by that move must not land in 4-status.md.
    #
    # A folder that stayed put because `aide-archive-spec` REFUSED to
    # move it is that refusal, not a step that made no progress: the
    # same two gates the pre-session check answers on its own
    # (run-spec-spec-paths.sh) are asked again here, read-only, in the
    # script's own order — so a session that resolved a conflict and
    # then reported "completed" over the script's "not all ticked"
    # ends exactly as the pre-session refusal does (ok, held back),
    # rather than as a red no-progress beside a held-back row.
    case "$status_file" in
      "$specs_root_wt/archive/"*) : ;;
      *)
        archive_refusal=""
        if declare -f may_apply_spec_transition >/dev/null 2>&1 \
           && ! may_apply_spec_transition "$status_file" "archive"; then
          archive_refusal="not-implemented-yet"
        elif declare -f read_spec_state >/dev/null 2>&1; then
          read_spec_state "$status_file"
          acceptance_done="$(jq -r '[.acceptanceCriteria[] | select(.done)] | length' <<<"$state_json" 2>/dev/null || echo 0)"
          acceptance_total="$(jq -r '.acceptanceCriteria | length' <<<"$state_json" 2>/dev/null || echo 0)"
          if [ "${acceptance_total:-0}" -gt 0 ] && [ "${acceptance_done:-0}" -lt "$acceptance_total" ]; then
            archive_refusal="acceptance-criteria-unticked"
          fi
        fi
        if [ -n "$archive_refusal" ]; then
          echo "aide-run-spec: the session reported completed, but aide-archive-spec refused: $archive_refusal" >&2
          terminal_reason="$archive_refusal"
          ok="true"
          suffix=""
          error_msg=""
        else
          terminal_reason="no-progress"
          ok="false"
          suffix=" (stopped: no-progress)"
          error_msg="The step reported success but left no real progress — the spec folder was never moved to archive/. Press $step_button again for this step."
        fi
        ;;
    esac
  elif [ "$command_name" = "analyze" ] && [ "$terminal_reason" = "completed" ]; then
    # spec 288: an analyze session must never change the project repo
    # (core/rules/spec-structure.md: "analyze ... writes only the spec's
    # own folder"), must never advance a Phase-table row past "not
    # started" — that is implement's and archive's job — and must never
    # claim a step beyond itself on the Workflow-steps line. All three
    # are checked against what the run actually produced, the same way
    # spec 268/280 check implement/archive.
    #
    # spec 405: "the project repo changed" is the wrong question where
    # the specs root lives INSIDE the project repo — the step's own spec
    # folder is then part of that same checkout, and writing it is the
    # whole point of the step, not a violation. specs_root_excludes
    # (empty unless that is the layout) keeps the specs root out of this
    # check; a foreign spec folder under it is still caught, precisely,
    # by run-spec-specs-guard.sh right after this.
    proj_changed="no"; proj_dirty_list=""
    proj_head_now="$(git -C "$project_wt" rev-parse HEAD 2>/dev/null || echo "")"
    if [ "$proj_head_now" != "${head_before[0]}" ]; then
      proj_changed="yes"
    else
      proj_dirty_list="$(git -C "$project_wt" status --porcelain -- . \
        ${git_add_excludes[@]+"${git_add_excludes[@]}"} \
        ${specs_root_excludes[@]+"${specs_root_excludes[@]}"} 2>/dev/null | head -5 | tr '\n' ' ')"
      [ -n "$proj_dirty_list" ] && proj_changed="yes"
    fi

    before_advanced=0; existing_line_before=""
    if [ -n "${specs_ref_before:-}" ] && \
       git -C "$(dirname "$status_file")" show \
         "$specs_ref_before:./$(basename "$status_file")" \
         > "$work_dir/status-before" 2>/dev/null; then
      status_advanced_count_for "$work_dir/status-before"
      before_advanced="$advanced_count"
      existing_line_before="$(sed -n 's/^- \*\*Workflow steps completed:\*\*//p' \
        "$work_dir/status-before" 2>/dev/null | tail -1)"
    fi
    status_advanced_count_for "$status_file"
    rows_advanced="no"
    [ "$advanced_count" -gt "$before_advanced" ] && rows_advanced="yes"

    # Word-split each side the same way completed_steps_for's own
    # existing-line scan does (line ~1948): a raw `sed` capture keeps the
    # markdown's own leading space after the bold colon, and splicing
    # that untrimmed into a `case` pattern string breaks the substring
    # match a bare `tr` does not fix.
    # `create` is always allowed: a spec that exists has been through it,
    # whether or not the pre-session file said so. No spec carries the
    # line at creation, and a model that writes "create, analyze" onto a
    # file that had no line was refused for the one step it could not
    # have skipped (spec 348, 2026-09-02).
    allowed_steps="|analyze|create|"
    for allowed_step in $(printf '%s' "$existing_line_before" | tr ',' ' '); do
      allowed_steps="$allowed_steps$allowed_step|"
    done
    claims_extra_step="no"
    raw_line="$(sed -n 's/^- \*\*Workflow steps completed:\*\*//p' "$status_file" 2>/dev/null | tail -1)"
    for raw_step in $(printf '%s' "$raw_line" | tr ',' ' '); do
      case "$allowed_steps" in
        *"|$raw_step|"*) ;;
        *) claims_extra_step="yes" ;;
      esac
    done

    if [ "$proj_changed" = "yes" ] || [ "$rows_advanced" = "yes" ] || \
       [ "$claims_extra_step" = "yes" ]; then
      terminal_reason="scope-violation"
      ok="false"
      suffix=" (stopped: scope-violation)"
      # Says WHICH check tripped, and for a dirty project tree, what was
      # dirty: a generic sentence sent a person to guess (2026-09-03).
      scope_what=""
      [ "$proj_changed" = "yes" ] && scope_what="the project repo changed${proj_dirty_list:+ (uncommitted: $proj_dirty_list)}"
      [ "$rows_advanced" = "yes" ] && scope_what="${scope_what:+$scope_what; }a Phase-table row was ticked"
      [ "$claims_extra_step" = "yes" ] && scope_what="${scope_what:+$scope_what; }the Workflow-steps-completed line claims a step that did not run"
      error_msg="The step reported success but changed things outside analyze's scope — $scope_what. Press $step_button again for this step."
    fi
  fi
fi
