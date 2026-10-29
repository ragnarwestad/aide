#!/usr/bin/env bash
# run-spec/setup/arguments.sh — the workflow vocabulary this run is checked
# against, the command line it was given, and the refusals that follow
# straight from those two.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were.

# The workflow's own vocabulary: one file, read here and
# imported by the dashboard — see core/scripts/lib/workflow-steps.json's
# own comment for what each list is and why it is shaped the way it is
# (WORKFLOW_STEPS is the names --command accepts; DEPENDENCY_GATED_STEPS
# is narrower: create writes only the spec's own folder and needs nothing
# merged, while analyze plans against code a dependency may still change).
# A missing or unparsable
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

# The effort levels a step may be run at: the same
# shared-vocabulary pattern as workflow-steps.json above — one file, read
# here and imported by the dashboard.
_effort_levels_file="$SCRIPT_DIR/lib/effort-levels.json"
[ -f "$_effort_levels_file" ] \
  || { echo "{\"ok\":false,\"exitCode\":2,\"terminalReason\":\"refused\",\"error\":\"the shared effort-levels file is missing: $_effort_levels_file\"}"; exit 2; }
EFFORT_LEVELS="$(jq -r '.effortLevels | join(" ")' "$_effort_levels_file" 2>/dev/null)"
[ -n "$EFFORT_LEVELS" ] \
  || { echo "{\"ok\":false,\"exitCode\":2,\"terminalReason\":\"refused\",\"error\":\"could not read effortLevels from $_effort_levels_file\"}"; exit 2; }
# Directory names a build WRITES into, or that a tool locks a cache in —
# never a dependency cache a build only reads. A link is one
# symlink into the main checkout that every concurrent run shares, so two
# runs building through it overwrite each other's output. Third list of
# the same shape as the two above: the dashboard holds the second copy
# (WORKTREE_LINK_DENYLIST in dashboard/src/project-admin.ts) with no
# shared source, and
# test_the_two_copies_of_the_worktree_link_denylist_agree pins them.
WORKTREE_LINK_DENYLIST="build target dist .gradle"

# The limits of a short analysis (analyze's Step 3), set here and nowhere
# else: the prompt states them to the skill (setup/invocation.sh) and
# record/short-analysis-check.sh fails a short analysis over any of them.
# Plain assignments, so no environment variable makes them differ per run.
SHORT_ANALYSIS_GRADE="LOW"
SHORT_ANALYSIS_MAX_FILES=3

project_dir=""; command_name=""; spec_arg=""; timeout_sec=""
# Where the caller says this project's spec folders live. The dashboard
# passes it, so the run makes a folder in the same place the landing
# looks for it: the two used to work it out separately — the run from
# `.aide/config`, the landing from its own answer — and a create wrote
# its folder at the specs repo's root while the landing looked for it
# under the project's own directory. Empty means "work it out here", the
# way a run started by hand still does.
specs_root_arg=""
permission_mode=""; result_file=""; model=""; effort=""; session_id=""
kill_grace_sec="30"; do_pull="no"; dry_run="no"
# Which AI actually runs the step. Defaults to claude, so
# every caller that predates this flag — the dashboard, a run started by
# hand — is unaffected until it opts in. Everything around the
# invocation stays one path: the queue, the worktrees, the timeout and
# all the git handling never learn there is a second tool.
tool="claude"
review_tool=""; review_model=""; verify_tool=""; verify_model=""
# What a `create` step is FOR. Every other step names a folder
# that is already on disk; this one makes it, so the two things
# /aide-create needs come in as arguments instead. Required for a create
# whose --spec does not resolve, meaningless everywhere else.
title=""; description=""
# What the new spec BUILDS ON: the `Depends on:` line, which
# has a reader and no writer but a person at a shell. Comma-separated,
# exactly the shape the line has on disk — stated in the create prompt,
# meaningless everywhere else.
depends_on=""
# Why a `close` step is closing the spec: typed
# by the person closing it, stated in the close prompt so the skill can
# hand it straight to `aide-close-spec --reason`, meaningless for every
# other command.
reason=""
# Create records this choice in the description. After analyze, the
# runner reads that saved choice to mark every acceptance row Not verified.
acceptance_not_required="no"
# Whether a `create` step skips the AI session entirely: the
# New-spec form's "let AI formulate acceptance criteria" box, cleared. A
# bare flag, same shape as --acceptance-not-required: nothing to
# validate, and its absence is the byte-for-byte behaviour every caller
# before this flag existed already has.
no_ai_formulate="no"
# How strictly analyze checks the new spec's acceptance criteria, chosen
# on the New-spec form: off, warn or stop. A `create` that completes
# records it in the new spec's Tracking info, where analyze reads it.
# Empty records nothing, which analyze reads as off.
criteria_checks_arg=""
# Whether the new spec asks to choose between the approaches its analysis
# finds, from the New-spec form's "Let me choose the approach" box: yes or
# no. A `create` that completes records it in the new spec's Tracking
# info, where analyze reads it. Empty records nothing, read as no.
choose_approach_arg=""
# `reopen` only: also put the analysis, the plan and the status back to their
# templates. Without it a reopen keeps every file and runs no model.
reset_files="no"
resume_session=""
# The file whose contents become the prompt VERBATIM, for `--command
# schedule` alone. A schedule entry names no aide skill and
# no spec folder — its whole "job" is the text at this path, read from
# $project_root before the worktree is cut (see the prompt-construction
# branch below). Meaningless for every other command.
prompt_file=""
# `schedule` with Claude alone: start Claude with the browser of the
# logged-in Chrome, for a job whose prompt reads a page behind a login.
chrome="no"
# `schedule` with Claude alone: run without Claude's sandbox
# (setup/sandbox.sh), for a job whose commands start a browser.
sandbox="yes"
# Where to keep the claude transcript. Opt-in: without it the captured
# output goes with the rest of $work_dir, exactly as it always has, so
# no existing caller changes behaviour.
stream_file=""
# Repos beyond the project and its specs root that this job is expected
# to touch. An implement step once wrote to a third repository
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
# Whether that default was TYPED or merely left standing. The
# project's manifest may raise it to `pr`, and it may only do so where
# nobody said otherwise — so "explicitly passed" and "left at its
# default" have to be told apart, which the variable above cannot do on
# its own. Unlike the worktree links, whose two files never competed
# with a flag, this precedence has a command line on one side of it.
push_mode_explicit="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --project-dir) project_dir="${2:-}"; shift 2 ;;
    --specs-root) specs_root_arg="${2:-}"; shift 2 ;;
    --command) command_name="${2:-}"; shift 2 ;;
    --spec) spec_arg="${2:-}"; shift 2 ;;
    --title) title="${2:-}"; shift 2 ;;
    --description) description="${2:-}"; shift 2 ;;
    --depends-on) depends_on="${2:-}"; shift 2 ;;
    --reason) reason="${2:-}"; shift 2 ;;
    --acceptance-not-required) acceptance_not_required="yes"; shift ;;
    --no-ai-formulate) no_ai_formulate="yes"; shift ;;
    --criteria-checks) criteria_checks_arg="${2:-}"; shift 2 ;;
    --choose-approach) choose_approach_arg="${2:-}"; shift 2 ;;
    --reset-files) reset_files="yes"; shift ;;
    --prompt-file) prompt_file="${2:-}"; shift 2 ;;
    --chrome) chrome="yes"; shift ;;
    --no-sandbox) sandbox="no"; shift ;;
    --timeout-sec) timeout_sec="${2:-}"; shift 2 ;;
    --permission-mode) permission_mode="${2:-}"; shift 2 ;;
    --result-file) result_file="${2:-}"; shift 2 ;;
    --model) model="${2:-}"; shift 2 ;;
    --effort) effort="${2:-}"; shift 2 ;;
    --tool) tool="${2:-}"; shift 2 ;;
    --review-tool) review_tool="${2:-}"; shift 2 ;;
    --review-model) review_model="${2:-}"; shift 2 ;;
    --verify-tool) verify_tool="${2:-}"; shift 2 ;;
    --verify-model) verify_model="${2:-}"; shift 2 ;;
    --session-id) session_id="${2:-}"; shift 2 ;;
    --resume-session) resume_session="${2:-}"; shift 2 ;;
    --stream-file) stream_file="${2:-}"; shift 2 ;;
    --kill-grace-sec) kill_grace_sec="${2:-}"; shift 2 ;;
    --push) push_mode="${2:-}"; push_mode_explicit="yes"; shift 2 ;;
    --worktree-base) worktree_base="${2:-}"; shift 2 ;;
    --pull) do_pull="yes"; shift ;;
    --dry-run) dry_run="yes"; shift ;;
    *) printf '{"ok":false,"terminalReason":"refused","error":"unknown argument: %s"}\n' "$1"; exit 2 ;;
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
  stage_error "$msg"
  aide_part_close "stopped: refused"
  printf '%s\n' "$line"
  [ -n "$result_file" ] && printf '%s\n' "$line" > "$result_file" 2>/dev/null
  exit 2
}

# --- nothing to do ----------------------------------------------------------
# refuse()'s sibling, and deliberately a separate function.
# Every one of refuse()'s dozen-plus callers relies on it meaning failure
# and nothing else, and this is not a failure: a spec found under
# `archive/` whose branch is gone from every root is finished work, not a
# name that does not exist. Saying so is success — ok:true, exit 0 — so
# the dashboard treats the step as any other step with nothing left to
# do (Runner.complete's only two non-success branches key on
# terminalReason timeout/provider-limit and on ok:false; neither applies here).
already_landed() {
  local folder="$1" note line
  note="spec $folder is already archived and its branch is gone from origin — nothing to do"
  line="$(jq -cn --arg n "$note" \
    '{ok:true, exitCode:0, terminalReason:"already-landed", costUsd:0, costMeasured:false, note:$n}')"
  printf '%s\n' "$line"
  [ -n "$result_file" ] && printf '%s\n' "$line" > "$result_file" 2>/dev/null
  echo "aide-run-spec: $note" >&2
  aide_part_close "skipped: already landed"
  exit 0
}

# A decimal is above zero when any of its digits is not 0; bc is not on
# every Linux.
is_positive_number() { [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]] && [[ "$1" =~ [1-9] ]]; }

[ -n "$project_dir" ] || refuse "missing --project-dir"
[ -n "$command_name" ] || refuse "missing --command"
[ -n "$spec_arg" ] || refuse "missing --spec"
[ -n "$timeout_sec" ] || refuse "missing --timeout-sec"
# Never defaulted: the most dangerous knob in the stage is typed out by
# whoever starts the run, or the run does not start.
[ -n "$permission_mode" ] || refuse "missing --permission-mode"
[ -n "$result_file" ] || refuse "missing --result-file"

is_positive_number "$timeout_sec" || refuse "invalid --timeout-sec: $timeout_sec"

case " $WORKFLOW_STEPS " in
  *" $command_name "*) ;;
  *) refuse "invalid --command: $command_name (not an aide workflow step)" ;;
esac
# The word on the row's own button for this step ("Archive"): there is
# no Run button on a spec's row, so a message that tells the reader to
# press again names the button it means. awk, not ${var^}: /bin/bash is 3.2.
# A scheduled job has no Schedule button: Run now starts it.
if [ "$command_name" = "schedule" ]; then
  step_button="Run now"
else
  step_button="$(printf '%s' "$command_name" | awk '{ print toupper(substr($0, 1, 1)) substr($0, 2) }')"
fi

# Refused rather than dropped: a job that asked for the browser and ran
# without it would only fail later, saying less about why.
if [ "$chrome" = "yes" ]; then
  [ "$command_name" = "schedule" ] || refuse "--chrome is for --command schedule only, not $command_name"
  [ "${tool:-claude}" = "claude" ] || refuse "--chrome needs --tool claude, not $tool"
fi
if [ "$sandbox" = "no" ]; then
  [ "$command_name" = "schedule" ] || refuse "--no-sandbox is for --command schedule only, not $command_name"
  [ "${tool:-claude}" = "claude" ] || refuse "--no-sandbox needs --tool claude, not $tool"
fi

case "$push_mode" in
  none|branch|pr) ;;
  *) refuse "invalid --push: $push_mode (none, branch or pr)" ;;
esac

case "$criteria_checks_arg" in
  ""|off|warn|stop) ;;
  *) refuse "invalid --criteria-checks: $criteria_checks_arg (off, warn or stop)" ;;
esac

case "$choose_approach_arg" in
  ""|yes|no) ;;
  *) refuse "invalid --choose-approach: $choose_approach_arg (yes or no)" ;;
esac

# `fake-claude` is Claude Code's own path with the binary swapped: same
# command line, same event format, a script instead of a model. It is
# named rather than hidden behind AIDE_CLAUDE_BIN alone so a project
# testing the machinery says so on its rows, and so a run can refuse
# when nothing is there to stand in.
case "$tool" in
  claude|codex|opencode|fake-claude) ;;
  *) refuse "invalid --tool: $tool (claude, codex, opencode or fake-claude)" ;;
esac

# Implement's review and its verification run on the step's own tool, or
# on codex read-only beside it (run-spec/turn/side-turn.sh).
for side_tool_arg in "$review_tool" "$verify_tool"; do
  [ -z "$side_tool_arg" ] || [ "$side_tool_arg" = "$tool" ] || [ "$side_tool_arg" = "codex" ] \
    || refuse "invalid --review-tool or --verify-tool: $side_tool_arg (the step's own tool, $tool, or codex)"
done

if [ -n "$effort" ]; then
  case " $EFFORT_LEVELS " in
    *" $effort "*) ;;
    *) refuse "invalid --effort: $effort (one of: $EFFORT_LEVELS)" ;;
  esac
fi

[ -d "$project_dir" ] || refuse "no such --project-dir: $project_dir"
project_root="$(git -C "$project_dir" rev-parse --show-toplevel 2>/dev/null)" \
  || refuse "not a git repository: $project_dir"
