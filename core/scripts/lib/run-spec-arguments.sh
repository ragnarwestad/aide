#!/usr/bin/env bash
# run-spec-arguments.sh — the workflow vocabulary this run is checked
# against, the command line it was given, and the refusals that follow
# straight from those two.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were.

# The workflow's own vocabulary (spec 349): one file, read here and
# imported by the dashboard — see core/scripts/lib/workflow-steps.json's
# own comment for what each list is and why it is shaped the way it is
# (WORKFLOW_STEPS is the names --command accepts; DEPENDENCY_GATED_STEPS
# is narrower, since analyze and create write only the spec's own folder
# in the specs repo and conflict with nothing). A missing or unparsable
# file refuses loudly rather than leaving these names unset under `set -u`.
_workflow_steps_file="$SCRIPT_DIR/lib/workflow-steps.json"
[ -f "$_workflow_steps_file" ] \
  || { echo "{\"ok\":false,\"exitCode\":2,\"terminalReason\":\"refused\",\"error\":\"the shared workflow-step file is missing: $_workflow_steps_file\"}"; exit 2; }
WORKFLOW_STEPS="$(jq -r '.workflowSteps | join(" ")' "$_workflow_steps_file" 2>/dev/null)"
DEPENDENCY_GATED_STEPS="$(jq -r '.dependencyGatedSteps | join(" ")' "$_workflow_steps_file" 2>/dev/null)"
WORKFLOW_ARC="$(jq -r '.workflowArc | join(" ")' "$_workflow_steps_file" 2>/dev/null)"
WORKFLOW_ARC_RETIRED="$(jq -r '.workflowArcRetired | join(" ")' "$_workflow_steps_file" 2>/dev/null)"
[ -n "$WORKFLOW_STEPS" ] \
  || { echo "{\"ok\":false,\"exitCode\":2,\"terminalReason\":\"refused\",\"error\":\"could not read workflowSteps from $_workflow_steps_file\"}"; exit 2; }

# The effort levels a step may be run at (spec 364): the same
# shared-vocabulary pattern as workflow-steps.json above — one file, read
# here and imported by the dashboard.
_effort_levels_file="$SCRIPT_DIR/lib/effort-levels.json"
[ -f "$_effort_levels_file" ] \
  || { echo "{\"ok\":false,\"exitCode\":2,\"terminalReason\":\"refused\",\"error\":\"the shared effort-levels file is missing: $_effort_levels_file\"}"; exit 2; }
EFFORT_LEVELS="$(jq -r '.effortLevels | join(" ")' "$_effort_levels_file" 2>/dev/null)"
[ -n "$EFFORT_LEVELS" ] \
  || { echo "{\"ok\":false,\"exitCode\":2,\"terminalReason\":\"refused\",\"error\":\"could not read effortLevels from $_effort_levels_file\"}"; exit 2; }
# Directory names a build WRITES into, or that a tool locks a cache in —
# never a dependency cache a build only reads (spec 186). A link is one
# symlink into the main checkout that every concurrent run shares, so two
# runs building through it overwrite each other's output. Third list of
# the same shape as the two above: the dashboard holds the second copy
# (WORKTREE_LINK_DENYLIST in dashboard/src/project-admin.ts) with no
# shared source, and
# test_the_two_copies_of_the_worktree_link_denylist_agree pins them.
WORKTREE_LINK_DENYLIST="build target dist .gradle"

project_dir=""; command_name=""; spec_arg=""; budget_usd=""; timeout_sec=""
permission_mode=""; result_file=""; model=""; effort=""; session_id=""
kill_grace_sec="30"; do_pull="no"; dry_run="no"
# Which AI actually runs the step (spec 125). Defaults to claude, so
# every caller that predates this flag — the dashboard, a run started by
# hand — is unaffected until it opts in. Everything around the
# invocation stays one path: the queue, the worktrees, the timeout and
# all the git handling never learn there is a second tool.
tool="claude"
# What a `create` step is FOR (spec 93). Every other step names a folder
# that is already on disk; this one makes it, so the two things
# /aide-create needs come in as arguments instead. Required for a create
# whose --spec does not resolve, meaningless everywhere else.
title=""; description=""
# What the new spec BUILDS ON (spec 110): the `Depends on:` line spec 92
# gave a reader and no writer but a person at a shell. Comma-separated,
# exactly the shape the line has on disk — stated in the create prompt,
# meaningless everywhere else.
depends_on=""
# Why a `close` step is closing the spec (spec 406, REQ-3/REQ-5): typed
# by the person closing it, stated in the close prompt so the skill can
# hand it straight to `aide-close-spec --reason`, meaningless for every
# other command.
reason=""
# Whether this run's analyze step should skip the acceptance-criteria
# table in 4-status.md (spec 386). A bare flag, like --pull/--dry-run:
# there is nothing to validate, and its absence is the byte-for-byte
# behaviour every caller before this flag existed already has (REQ-3).
acceptance_not_required="no"
# Whether a `create` step skips the AI session entirely (spec 433): the
# New-spec form's "let AI formulate acceptance criteria" box, cleared. A
# bare flag, same shape as --acceptance-not-required: nothing to
# validate, and its absence is the byte-for-byte behaviour every caller
# before this flag existed already has.
no_ai_formulate="no"
# The file whose contents become the prompt VERBATIM, for `--command
# schedule` alone (spec 259). A schedule entry names no aide skill and
# no spec folder — its whole "job" is the text at this path, read from
# $project_root before the worktree is cut (see the prompt-construction
# branch below). Meaningless for every other command.
prompt_file=""
# Where to keep the claude transcript. Opt-in: without it the captured
# output goes with the rest of $work_dir, exactly as it always has, so
# no existing caller changes behaviour.
stream_file=""
# Repos beyond the project and its specs root that this job is expected
# to touch. Spec 81's own implement step wrote to a third repository
# the run knew nothing about: that half was left uncommitted on the
# machine while the result reported success.
# Where the throwaway checkouts live. Outside every repo, keyed by
# project AND spec: two projects can share one specs repo (aide-specs
# holds both `aide/` and `aide-dashboard/`), and a path keyed by spec
# alone would put their runs in the same directory — which the sweep
# below would then delete out from under a live run.
worktree_base=""
# Default `none`: a run started by hand publishes nothing nobody asked
# for. The queue passes the mode from its config, where the default is
# `branch`.
push_mode="none"
# Whether that default was TYPED or merely left standing (spec 220). The
# project's manifest may raise it to `pr`, and it may only do so where
# nobody said otherwise — so "explicitly passed" and "left at its
# default" have to be told apart, which the variable above cannot do on
# its own. Unlike the worktree links, whose two files never competed
# with a flag, this precedence has a command line on one side of it.
push_mode_explicit="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --project-dir) project_dir="${2:-}"; shift 2 ;;
    --command) command_name="${2:-}"; shift 2 ;;
    --spec) spec_arg="${2:-}"; shift 2 ;;
    --title) title="${2:-}"; shift 2 ;;
    --description) description="${2:-}"; shift 2 ;;
    --depends-on) depends_on="${2:-}"; shift 2 ;;
    --reason) reason="${2:-}"; shift 2 ;;
    --acceptance-not-required) acceptance_not_required="yes"; shift ;;
    --no-ai-formulate) no_ai_formulate="yes"; shift ;;
    --prompt-file) prompt_file="${2:-}"; shift 2 ;;
    --budget-usd) budget_usd="${2:-}"; shift 2 ;;
    --timeout-sec) timeout_sec="${2:-}"; shift 2 ;;
    --permission-mode) permission_mode="${2:-}"; shift 2 ;;
    --result-file) result_file="${2:-}"; shift 2 ;;
    --model) model="${2:-}"; shift 2 ;;
    --effort) effort="${2:-}"; shift 2 ;;
    --tool) tool="${2:-}"; shift 2 ;;
    --session-id) session_id="${2:-}"; shift 2 ;;
    --stream-file) stream_file="${2:-}"; shift 2 ;;
    --kill-grace-sec) kill_grace_sec="${2:-}"; shift 2 ;;
    --push) push_mode="${2:-}"; push_mode_explicit="yes"; shift 2 ;;
    --worktree-base) worktree_base="${2:-}"; shift 2 ;;
    --pull) do_pull="yes"; shift ;;
    --dry-run) dry_run="yes"; shift ;;
    *) printf '{"ok":false,"terminalReason":"refused","error":"Unknown argument: %s"}\n' "$1"; exit 2 ;;
  esac
done

# --- refusal ----------------------------------------------------------------
# One place, one shape: a refusal is still a JSON line, so a caller never
# has to parse two formats.
refuse() {
  local msg="$1" reason="${2:-}"
  local line
  line="$(jq -cn --arg e "$msg" --arg r "$reason" \
    '{ok:false, exitCode:2, terminalReason:"refused", costUsd:0, costMeasured:false, error:$e}
     + (if $r == "" then {} else {errorReason:$r} end)')"
  printf '%s\n' "$line"
  [ -n "$result_file" ] && printf '%s\n' "$line" > "$result_file" 2>/dev/null
  exit 2
}

# --- nothing to do ----------------------------------------------------------
# refuse()'s sibling, and deliberately a separate function (spec 211).
# Every one of refuse()'s dozen-plus callers relies on it meaning failure
# and nothing else, and this is not a failure: a spec found under
# `archive/` whose branch is gone from every root is finished work, not a
# name that does not exist. Saying so is success — ok:true, exit 0 — so
# the dashboard treats the step as any other step with nothing left to
# do (Runner.complete's only two non-success branches key on
# terminalReason budget/timeout and on ok:false; neither applies here).
already_landed() {
  local folder="$1" note line
  note="spec $folder is already archived and its branch is gone from origin — nothing to do"
  line="$(jq -cn --arg n "$note" \
    '{ok:true, exitCode:0, terminalReason:"already-landed", costUsd:0, costMeasured:false, note:$n}')"
  printf '%s\n' "$line"
  [ -n "$result_file" ] && printf '%s\n' "$line" > "$result_file" 2>/dev/null
  echo "aide-run-spec: $note" >&2
  exit 0
}

is_positive_number() { [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]] && (( $(echo "$1 > 0" | bc -l) )); }

[ -n "$project_dir" ] || refuse "Missing --project-dir"
[ -n "$command_name" ] || refuse "Missing --command"
[ -n "$spec_arg" ] || refuse "Missing --spec"
[ -n "$budget_usd" ] || refuse "Missing --budget-usd"
[ -n "$timeout_sec" ] || refuse "Missing --timeout-sec"
# Never defaulted: the most dangerous knob in the stage is typed out by
# whoever starts the run, or the run does not start.
[ -n "$permission_mode" ] || refuse "Missing --permission-mode"
[ -n "$result_file" ] || refuse "Missing --result-file"

is_positive_number "$budget_usd" || refuse "Invalid --budget-usd: $budget_usd"
is_positive_number "$timeout_sec" || refuse "Invalid --timeout-sec: $timeout_sec"

case " $WORKFLOW_STEPS " in
  *" $command_name "*) ;;
  *) refuse "Invalid --command: $command_name (not an aide workflow step)" ;;
esac
# The word on the row's own button for this step ("Archive"): there is
# no Run button on a spec's row, so a message that tells the reader to
# press again names the button it means. awk, not ${var^}: /bin/bash is 3.2.
step_button="$(printf '%s' "$command_name" | awk '{ print toupper(substr($0, 1, 1)) substr($0, 2) }')"

case "$push_mode" in
  none|branch|pr) ;;
  *) refuse "Invalid --push: $push_mode (none, branch or pr)" ;;
esac

# `fake-claude` is Claude Code's own path with the binary swapped: same
# command line, same event format, a script instead of a model. It is
# named rather than hidden behind AIDE_CLAUDE_BIN alone so a project
# testing the machinery says so on its rows, and so a run can refuse
# when nothing is there to stand in.
case "$tool" in
  claude|codex|fake-claude) ;;
  *) refuse "Invalid --tool: $tool (claude, codex or fake-claude)" ;;
esac

if [ -n "$effort" ]; then
  case " $EFFORT_LEVELS " in
    *" $effort "*) ;;
    *) refuse "Invalid --effort: $effort (one of: $EFFORT_LEVELS)" ;;
  esac
fi

[ -d "$project_dir" ] || refuse "No such --project-dir: $project_dir"
project_root="$(git -C "$project_dir" rev-parse --show-toplevel 2>/dev/null)" \
  || refuse "Not a git repository: $project_dir"
