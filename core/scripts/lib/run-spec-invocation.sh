#!/usr/bin/env bash
# run-spec-invocation.sh — finding the tool and building its command line.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were. Split out 2026-09-04: the
# script had reached 2925 lines, five times the next largest file in
# the repo, and no reader could hold it.
# --- the invocation ----------------------------------------------------------
# One resolution shape, two tools. Only the CHOSEN tool has to be on the
# machine: a host with no codex installed must still run every claude
# step, and the reverse.
find_bin() {
  local override="$1" name="$2" found=""
  if [ -n "$override" ]; then
    found="$override"
  elif [ -x "$HOME/.local/bin/$name" ]; then
    found="$HOME/.local/bin/$name"
  else
    found="$(command -v "$name" 2>/dev/null || true)"
  fi
  printf '%s' "$found"
}

claude_bin=""; codex_bin=""
if [ "$tool" = "codex" ]; then
  codex_bin="$(find_bin "${AIDE_CODEX_BIN:-}" codex)"
  [ -n "$codex_bin" ] && [ -x "$codex_bin" ] || refuse "cannot find the codex binary (set AIDE_CODEX_BIN)"
else
  # The environment wins; the project's own .aide/config is the fallback.
  # A per-machine file is where a project points its runs at a stand-in
  # binary without the whole dashboard following it there.
  claude_override="${AIDE_CLAUDE_BIN:-}"
  [ -n "$claude_override" ] || claude_override="$(aide_config_get AIDE_CLAUDE_BIN "$project_root")"
  # `--tool fake-claude` asks for the stand-in BY NAME, so a missing
  # override is a refusal rather than a silent fall-through to the real
  # CLI: a run that says it is scripted must never reach a model.
  if [ "$tool" = "fake-claude" ] && [ -z "$claude_override" ]; then
    refuse "--tool fake-claude needs a stand-in binary — set AIDE_CLAUDE_BIN in the project's .aide/config"
  fi
  claude_bin="$(find_bin "$claude_override" claude)"
  [ -n "$claude_bin" ] && [ -x "$claude_bin" ] || refuse "cannot find the claude binary (set AIDE_CLAUDE_BIN)"
fi

# Claude's safety is ONE string; Codex's is a sandbox mode and (in the
# interactive command only) an approval policy. The queue stores
# Claude's own names for the modes, so the translation lives here — the
# one place that ever has to turn an aide-level mode name into a CLI
# flag. Kept deliberately as a table with no fall-through: a mode with
# no entry REFUSES rather than being guessed at, because guessing wrong
# means a step running in the wrong sandbox and nobody finding out.
#
# Verified against codex-cli 0.147.0 (2026-08-20): `codex exec` accepts
# `--sandbox read-only|workspace-write|danger-full-access` and
# `--dangerously-bypass-approvals-and-sandbox`, and has NO
# `--ask-for-approval` — that flag belongs to the interactive command.
# `codex exec` never asks in the first place, so the sandbox mode is the
# whole of what there is to say.
#
# It SETS $safety_flags rather than printing them: `mapfile` is bash 4,
# and this script's shebang finds whatever bash the machine has — which
# on a Mac is still 3.2.
safety_flags=()
codex_safety_flags() {
  case "$1" in
    bypassPermissions) safety_flags=(--dangerously-bypass-approvals-and-sandbox) ;;
    acceptEdits)       safety_flags=(--sandbox workspace-write) ;;
    plan|default)      safety_flags=(--sandbox read-only) ;;
    *) return 1 ;;
  esac
}

# The prompt SAYS the run is headless. AIDE_HEADLESS is still exported
# (a shell step can read it), but the environment turned out to be the
# wrong place to put a fact the model has to act on: it has to remember
# to go and look. Measured 2026-08-17 — an archive run grepped the repo
# for AIDE_HEADLESS while analysing the spec that introduced it, never
# checked its own, stopped to ask a question nobody could answer, and
# reported success. Put it where the model is already reading.
headless_note="(This run is headless: no one is at a keyboard and no question can be
answered. Never stop to ask for confirmation — decide, or write down
what you would have asked, and finish the step. Never run tests or any
other work in the background and never end your turn to wait for it:
the run ends the moment you stop, and nothing resumes you. Run every
test suite in the foreground and finish the step in this same turn.)"
if [ "$command_name" = "schedule" ]; then
  # The prompt is the file's contents, verbatim — no aide skill, no spec
  # id, nothing invented on either side (spec 259). Read from
  # $project_root rather than the worktree: at this point in the script
  # the worktree has not been cut yet, and $project_root was already
  # pulled to origin/$base a few lines above, so the two are identical
  # content-wise and only one of them exists yet.
  [ -f "$project_root/$prompt_file" ] \
    || refuse "no such --prompt-file: $prompt_file (under $project_root)"
  prompt="$(cat "$project_root/$prompt_file")
$headless_note"
elif [ -n "$spec_folder" ]; then
  # Spec 386: stated to the skill, not just to the harness — a CLI flag
  # on the claude/codex binary is invisible to the skill's own
  # reasoning, and Step 8's branch has to be read out of the prompt the
  # same way depends_line already is for /aide-create.
  acceptance_line=""
  [ "$command_name" = "analyze" ] && [ "$acceptance_not_required" = "yes" ] && acceptance_line="
Acceptance ticking is not required for this run: per Step 8, do not write the acceptance-criteria table into 4-status.md — write the one-line note instead."
  prompt="/aide-$command_name $spec_id$acceptance_line
$headless_note"
else
  # `/aide-create TODO-<name> <description>` is the skill's own
  # documented argument shape ("TODO mode (with name)"), so nothing is
  # invented on either side of the contract. The slug is a throwaway
  # token for that parser and NOT the spec's folder slug — which is why
  # the title is also stated on a line of its own: a title is not
  # something to recover from a slug, and free text that happens to look
  # like a JIRA key would otherwise steer the skill's smart detection
  # somewhere nobody asked for.
  title_slug="$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-//' -e 's/-$//')"
  [ -n "$title_slug" ] || title_slug="new-spec"
  # Same voice as the title line, for the same reason: a value the skill
  # is TOLD, not one it has to infer or that a sub-format inside the
  # argument string would have to be parsed back out of. Nothing chosen
  # means the prompt says nothing about dependencies at all.
  depends_line=""
  [ -n "$depends_on" ] && depends_line="
Use exactly this Depends-on value in Tracking info: $depends_on"
  prompt="/aide-create TODO-$title_slug $description

Use exactly this title for the spec: $title$depends_line
$headless_note"
fi
if [ "$tool" = "codex" ]; then
  # `codex exec --json` is the same idea one CLI over: JSONL on stdout,
  # one event per line as it happens, the prompt read from stdin. Two
  # things are deliberately NOT here. There is no budget flag — Codex
  # has no native dollar cap, so the wall-clock timeout is the whole of
  # what stops a runaway step (`dashboard/README.md` says so where a
  # reader picking a model can see it). And there is no session
  # argument: the id the dashboard mints is fresh every time, so passing
  # it would ask Codex to resume a thread that has never existed. Codex
  # names its own thread and the result parser reads that back, exactly
  # as claude's session id is read back today.
  codex_safety_flags "$permission_mode" \
    || refuse "invalid --permission-mode for codex: $permission_mode"
  argv=("$codex_bin" exec --json)
  argv+=("${safety_flags[@]}")
  [ -n "$model" ] && argv+=(--model "$model")
else
  # stream-json, not json: `json` prints ONE object at the very end, so a
  # 25-minute run says nothing at all until it is over. stream-json emits
  # one event per line as it happens, and its last result event is the
  # same object this script already reads. In print mode the CLI REFUSES
  # stream-json without --verbose ("When using --print,
  # --output-format=stream-json requires --verbose") — verified
  # 2026-08-16, version 2.1.233.
  argv=("$claude_bin" -p --output-format stream-json --verbose
        --max-budget-usd "$budget_usd" --permission-mode "$permission_mode")
  [ -n "$model" ] && argv+=(--model "$model")
  [ -n "$effort" ] && argv+=(--effort "$effort")
  [ -n "$session_id" ] && argv+=(--session-id "$session_id")
fi

if [ "$dry_run" = "yes" ]; then
  # Build the argv array separately: jq's --args still parses a leading
  # dash as an option, and every entry here starts with one.
  argv_json="$(printf '%s\n' "${argv[@]}" | jq -Rsc 'split("\n") | map(select(length > 0))')"
  line="$(jq -cn --arg p "$prompt" --arg cwd "$project_root" --arg specs "$specs_root" \
    --argjson argv "$argv_json" \
    '{ok:true, dryRun:true, prompt:$p, projectRoot:$cwd, specsRoot:$specs, argv:$argv}')"
  printf '%s\n' "$line"
  printf '%s\n' "$line" > "$result_file"
  exit 0
fi

# EVERY root goes on the branch, not just the project. An `analyze`
# step changes only the specs repo, and branching just the project left
# that work committed on main and pushed there — the one thing `push
# branch` exists to prevent. Measured 2026-08-16 on spec 84.
branch="aide/$spec_label"

