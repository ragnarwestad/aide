#!/usr/bin/env bash
# run-spec-spec-paths.sh — where the spec folder is, what a step may write, and reading what came back.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were. Split out 2026-09-04: the
# script had reached 2925 lines, five times the next largest file in
# the repo, and no reader could hold it.
# --- pointing the step at the specs worktree ---------------------------------
# Where the specs root stands FOR THIS RUN — the same path a skill inside
# the step resolves. Kept by repoint_specs_path below, in each of the
# three layouts it already knows about, because a `create` step's whole
# output is a new directory there and the only honest way to name it is
# to look (spec 93).
specs_root_wt="$specs_root"

# Spec 405: the pathspec that keeps the specs root out of "did the
# project repo change" (run-spec-status-line.sh's analyze scope-check).
# Populated below, only when the specs root sits inside THIS worktree
# (single-worktree layout) — with a separate specs worktree the project
# checkout never sees spec files in its own `git status` at all, so
# there is nothing to exclude. Kept apart from git_add_excludes, which
# answers a different question (what gets COMMITTED): a tracked specs
# root must still be committed, just not counted as "the project
# changed" for a step that is only allowed to touch its own folder.
specs_root_excludes=()

# A worktree of the PROJECT isolates nothing an `analyze` step writes:
# AIDE_SPECS_PATH is an absolute path into another repository, and it
# resolves to the shared checkout from inside a worktree just as well as
# from outside it. So the worktree's own config is re-pointed — which the
# four skills that read `.aide/config` in their working directory pick up
# without knowing anything about worktrees.
#
# STRICTLY AFTER update_branch_to_base — a lesson from when aide's own
# .aide/config was tracked and skip-worktree'd: rewriting it before that
# step could make `git merge` fail with "local changes to the following
# files would be overwritten" while `status --porcelain` read clean and
# `merge --abort` had nothing to abort — a healthy run reported as a
# conflict. No project's .aide/config is tracked anymore (spec 345), but
# the ordering is still correct, so it stays.
repoint_specs_path() {
  local rel new_specs cfg tmp_cfg
  if [ -n "$specs_wt" ]; then
    rel="${specs_root#"$specs_repo"}"; rel="${rel#/}"
    new_specs="$specs_wt"
    [ -n "$rel" ] && new_specs="$specs_wt/$rel"
    specs_root_wt="$new_specs"
    cfg="$project_wt/.aide/config"
    # A worktree checks out TRACKED files only, and .aide/config is
    # never tracked (spec 345) — so it is copied in fresh from the main
    # checkout and excluded from the commit, the same for every project.
    mkdir -p "$project_wt/.aide" 2>/dev/null || true
    [ -f "$project_root/.aide/config" ] && cp "$project_root/.aide/config" "$cfg" 2>/dev/null
    git_add_excludes+=(":(exclude,top).aide/config")
    tmp_cfg="$work_dir/aide-config"
    : > "$tmp_cfg"
    [ -f "$cfg" ] && grep -v '^AIDE_SPECS_PATH=' "$cfg" > "$tmp_cfg" 2>/dev/null
    printf 'AIDE_SPECS_PATH=%s\n' "$new_specs" >> "$tmp_cfg"
    mkdir -p "$project_wt/.aide" 2>/dev/null || true
    cat "$tmp_cfg" > "$cfg" 2>/dev/null || true
    return 0
  fi
  # No specs worktree. Either the specs root travels with the project's
  # (tracked inside it), or it is gitignored there — aide's own default,
  # `/specs/` — and a worktree checks out tracked files only, so it has
  # to be linked in at the same relative position. A specs root outside
  # every repo keeps working through its absolute path, exactly as it
  # always has.
  case "$specs_root/" in
    "$project_root"/*)
      rel="${specs_root#"$project_root"/}"
      [ -n "$rel" ] && specs_root_wt="$project_wt/$rel"
      if [ -n "$rel" ] && [ ! -e "$project_wt/$rel" ]; then
        mkdir -p "$(dirname "$project_wt/$rel")" 2>/dev/null || true
        ln -s "$specs_root" "$project_wt/$rel" 2>/dev/null || true
        git_add_excludes+=(":(exclude,top)$rel")
      fi
      # Tracked or symlinked-in, the specs root's own changes are the
      # step's real output, not "the project changed" — whether or not
      # it needed linking in above (spec 405).
      [ -n "$rel" ] && specs_root_excludes+=(":(exclude,top)$rel")
      ;;
  esac
  return 0
}
repoint_specs_path

# A passenger repo is addressed by absolute path and nothing else, so
# without this the step writes into the MAIN checkout: the commit loop
# (now on the worktree) would commit nothing, the result would report
# success, and the main tree would be left dirty so every later run
# naming that repo is refused. That is spec 83's failure recreated. The
# answer is the one the script already uses for a fact the step cannot
# infer — say it in the prompt.
i=0
for root in "${roots[@]}"; do
  if [ "$root" != "$project_root" ] && [ "$root" != "$specs_repo" ]; then
    prompt="$prompt
The repo $(basename "$root") is checked out for this run at ${work_roots[$i]}.
Work there, not in $root."
  fi
  i=$(( i + 1 ))
done

head_before=()
for wt in "${work_roots[@]}"; do
  head_before+=("$(git -C "$wt" rev-parse HEAD 2>/dev/null || echo "")")
done

# spec 288: the specs worktree's own HEAD before this step's session
# ran — `completed_steps_for`'s pre-session snapshot and the new
# `analyze` scope-check below both read `4-status.md` as it stood at
# this ref, never at whatever the session left on disk.
specs_ref_before="${head_before[0]}"
[ -n "$specs_wt" ] && specs_ref_before="${head_before[1]:-${head_before[0]}}"

# --- which folder a create step actually made --------------------------------
# Read off the disk, before and after, rather than computed: the rule
# that decides a spec's number and its slug is /aide-create's own (Step 2
# and Step 3 of its skill), and a second copy of that rule here is
# precisely the mistake spec 82 was about. A directory listing is also
# robust in a way parsing `git status` is not — the step may or may not
# have committed its own work by the time we look.
spec_folders_now() {
  local d base
  for d in "$specs_root_wt"/*/; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    [[ "$base" =~ ^[0-9]+- ]] && printf '%s\n' "$base"
  done
  return 0
}
spec_folders_before=""
[ "$command_name" = "create" ] && spec_folders_before="|$(spec_folders_now | tr '\n' '|')"

# Only if we can actually write there. Keeping a transcript is a
# convenience, and a run whose work succeeded must never be reported as
# failed because a directory was missing — which is exactly what
# redirecting claude's stdout at an unwritable path would do.
transcript="$work_dir/out"
if [ -n "$stream_file" ] && : > "$stream_file" 2>/dev/null; then
  transcript="$stream_file"
fi
printf '%s' "$prompt" > "$work_dir/prompt"

# The AI session's own start, which the deadline below is measured from:
# a timeout is about the session, not about the step around it.
started_at="$(date +%s)"

# --- the mechanical archive pre-check (spec 251) -----------------------------
# Most of what `/aide-archive` used to spend a full AI session on is pure
# logic — folder resolution, the conflict check, reading 4-status.md's
# tables to decide whether the work is done. aide-archive-spec does that
# in bash and prints a verdict; when the verdict is "nothing to do yet",
# spawning claude/codex for it would cost tokens and time on the common
# path for no judgment actually needed. Literal string `archive`, like
# every other archive-only fork in this file (update_branch_to_base
# above is the same shape) — this must run AFTER worktree setup, since
# the conflict half of the check needs MERGE_HEAD, which only exists once
# update_branch_to_base has had its chance to leave it set.
skip_ai=""; archive_terminal_reason=""; archive_note=""
if [ "$command_name" = "archive" ]; then
  archive_args=(--project-dir "$project_wt" --spec "$spec_folder")
  # specs_root_wt, not specs_wt: the former is the resolved SPECS ROOT
  # (project-name subdirectory already applied, same as aide_specs_root
  # would give), the latter is the bare specs REPO's worktree root one
  # level higher — passing that left aide-archive-spec looking for the
  # spec folder in the wrong directory the moment AIDE_SPECS_PATH names
  # a subdirectory, which every nested layout (this project's own real
  # shape) does.
  [ "$specs_root_wt" != "$project_wt" ] && archive_args+=(--specs-dir "$specs_root_wt")
  archive_check="$("$SCRIPT_DIR/aide-archive-spec" "${archive_args[@]}" 2>/dev/null)"
  archive_terminal_reason="$(jq -r '.terminalReason // empty' <<<"$archive_check" 2>/dev/null)"
  archive_note="$(jq -r '.note // empty' <<<"$archive_check" 2>/dev/null)"
  [ -n "$archive_note" ] && echo "aide-run-spec: $archive_note" >&2
  # The refusals aide-archive-spec answers on its own. Each is reported
  # ok with the refusal as the terminal reason: the dashboard reads the
  # hold-back from 4-status.md itself, and lands an archive only on
  # `completed`.
  case "$archive_terminal_reason" in
    not-implemented-yet|acceptance-criteria-unticked) skip_ai="yes" ;;
  esac
fi

# --- the mechanical create path (spec 433) -----------------------------
# `create` needs no AI session at all when the New-spec form's own
# "let AI formulate acceptance criteria" box was cleared: the title,
# description, depends-on and acceptance choice the form already posted
# are the whole of what /aide-create's Step 4 needs, and its own script
# call (aide-create-spec) is 100% mechanical file writing. Kept as its
# own variable rather than folded into $skip_ai: archive's skip_ai is
# also `ok=true` on several NON-completed terminal reasons (below), which
# create's deterministic path has no equivalent of — it either completes
# or it does not.
create_no_ai=""
if [ "$command_name" = "create" ] && [ "$no_ai_formulate" = "yes" ]; then
  create_no_ai="yes"
fi

if [ -n "$skip_ai" ] || [ -n "$create_no_ai" ]; then
  # No child spawned: every variable the commit loop, the phase-outcome
  # writer and the final JSON result read from a completed run is given
  # the same zero/absent shape already_landed() already uses above for
  # the same reason — a decline costs nothing.
  stopped=""; exit_code=0; duration=0
  session_out=""; subtype=""; cost="0"; cost_measured="false"; tokens_json=""
  cost_known="true"; error_msg=""
  if [ -n "$create_no_ai" ]; then
    slug="$(aide_slug_from_title "$title")"
    create_args=(--specs-root "$specs_root_wt" --slug "$slug"
                  --title "$title" --description "$description")
    [ -n "$depends_on" ] && create_args+=(--depends-on "$depends_on")
    [ "$acceptance_not_required" = "yes" ] && create_args+=(--acceptance-not-required)
    create_result="$("$SCRIPT_DIR/aide-create-spec" "${create_args[@]}" 2>/dev/null)"
    if [ "$(jq -r '.ok // false' <<<"$create_result" 2>/dev/null)" = "true" ]; then
      terminal_reason="completed"
      cost_measured="true"
      tool="none"
      # No AI ran, so nothing chosen for --model/--effort means anything:
      # run-spec-cleanup.sh's model_value="$tool${model:+ $model}" would
      # otherwise read "none <configured-model>" for a create job whose
      # config still names a default model for that step.
      model=""; effort=""
    else
      terminal_reason="cli-error"
      error_msg="$(jq -r '.error // "aide-create-spec refused"' <<<"$create_result" 2>/dev/null)"
    fi
  else
    terminal_reason="$archive_terminal_reason"; error_msg=""
  fi
else
  # `set -m` puts the child in its OWN process group, so the deadline can
  # take down claude's children too — a kill that only reaches the parent
  # is not a bound. No pipeline here: with one, $! is the last command and
  # the group id would be someone else's.
  set -m
  # cd into the project's WORKTREE first. A skill resolves the project from
  # its working directory, so inheriting the caller's cwd (a server's, say)
  # makes the run analyse the wrong repository — measured on the first
  # real job, 2026-08-16, which cost $0.45 to discover. Since spec 91 the
  # directory is the throwaway checkout, which is the tree this run will
  # commit from. `exec` keeps the pid, so $! is still the process group we
  # later signal.
  ( cd "$project_wt" && AIDE_HEADLESS=1 exec "${argv[@]}" ) < "$work_dir/prompt" > "$transcript" 2> "$work_dir/err" &
  child=$!
  set +m

  stopped=""
  deadline=$(( started_at + ${timeout_sec%.*} ))
  while kill -0 "$child" 2>/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      stopped="timeout"
      # SIGTERM first, always: a run being asked to stop is exactly when a
      # few extra seconds are cheapest.
      kill_group TERM
      grace_end=$(( $(date +%s) + ${kill_grace_sec%.*} ))
      while kill -0 "$child" 2>/dev/null && [ "$(date +%s)" -lt "$grace_end" ]; do sleep 0.2; done
      kill -0 "$child" 2>/dev/null && kill_group KILL
      break
    fi
    sleep 0.2
  done
  wait "$child" 2>/dev/null
  exit_code=$?
  duration=$(( $(date +%s) - started_at ))

# --- reading what came back --------------------------------------------------
session_out=""; subtype=""; cost="0"; cost_measured="false"; terminal_reason=""; error_msg=""
# The tokens the step actually metered, as a JSON object — or empty,
# which is what makes the field ABSENT rather than zero (spec 118).
tokens_json=""
# Did the tool report an outcome of its own at all? For claude this is
# the same question as "was a cost measured", which is why the branch
# below used to ask that one — but a Codex step never measures a cost
# and still finishes, so the two questions had to come apart (spec 125).
have_result="false"
# Is there a dollar figure to report? Claude sets one on every path,
# including the over-charge a killed run is billed. Codex publishes no
# dollar figure anywhere in its output and there is nothing to
# approximate one from, so the field is left out of the result entirely
# rather than defaulted to a number somebody would read as real.
cost_known="true"
[ "$tool" = "codex" ] && cost_known="false"

# The stream holds one event per line, so the result must be SELECTED by
# `type == "result"`, never taken positionally: the CLI emits shutdown
# and rate-limit events after it, and "the last line" would silently
# report the wrong cost, session and terminal reason for every run.
# `-R` + `fromjson?` reads line by line and skips anything that does not
# parse, so a half-written final line from a killed run costs nothing
# rather than discarding a result event that arrived intact.
if [ "$tool" = "codex" ]; then
  # Codex's own closing event. Selected by type for exactly the reason
  # claude's is: `codex exec --json` keeps emitting after the turn ends,
  # and "the last line" would report the wrong thing every run. A failed
  # turn is a result too — it says the step ran and did not finish,
  # which is a different answer from "the CLI never said anything".
  result_json="$(jq -Rc 'fromjson? | select(type == "object" and (.type == "turn.completed" or .type == "turn.failed"))' \
    "$transcript" 2>/dev/null | tail -n 1)"
  # The thread Codex named for itself, read back the way claude's
  # session id is. It arrives FIRST, in `thread.started`, not in the
  # closing event — so it is picked out of its own event.
  session_out="$(jq -Rr 'fromjson? | select(type == "object" and .type == "thread.started") | .thread_id // empty' \
    "$transcript" 2>/dev/null | tail -n 1)"
  if [ -n "$result_json" ]; then
    have_result="true"
    case "$(jq -r '.type' <<<"$result_json")" in
      turn.completed) subtype="success" ;;
      *) subtype="turn_failed"
         error_msg="$(jq -r '(.error.message // .error // "the turn failed") | tostring' <<<"$result_json")" ;;
    esac
    # Codex's usage block, mapped into the shape spec 118 already
    # defined. Two of the four need saying out loud: reasoning tokens
    # are BILLED AS OUTPUT and so are added to it rather than dropped,
    # and Codex exposes no separate cache-WRITE count at all — zero
    # there is the measurement, not a placeholder for a missing one.
    tokens_json="$(jq -c '
      if (.usage | type) == "object" then
        {input:         (.usage.input_tokens // 0),
         output:        ((.usage.output_tokens // 0) + (.usage.reasoning_output_tokens // 0)),
         cacheRead:     (.usage.cached_input_tokens // 0),
         cacheCreation: 0}
        | . + {total: (.input + .output + .cacheRead + .cacheCreation)}
      else empty end
    ' <<<"$result_json" 2>/dev/null)"
  fi
else
result_json="$(jq -Rc 'fromjson? | select(type == "object" and .type == "result")' \
  "$transcript" 2>/dev/null | tail -n 1)"
# `status: rejected` alone is NOT a stop: it says the subscription
# window is spent, and the very same event says whether purchased
# credit is carrying the request anyway. Measured 2026-08-25, when
# every run for two days was reported stopped while finishing its
# work — the seven-day window was spent, `overageStatus: allowed`
# and `isUsingOverage: true` covered every call, and the branch that
# wins below is ahead of the one that reads the successful result.
# A real stop has the credit refused beside it
# (`overageStatus: rejected`, `overageDisabledReason: out_of_credits`,
# `isUsingOverage: false`), so the credit in use is what tells the two
# apart. Absent means false: an older CLI emitted neither field.
provider_limit_json="$(jq -Rc 'fromjson? | select(
  type == "object" and .type == "rate_limit_event" and
  .rate_limit_info.status == "rejected" and
  (.rate_limit_info.isUsingOverage // false) == false
)' "$transcript" 2>/dev/null | tail -n 1)"

if [ -n "$result_json" ]; then
  have_result="true"
  session_out="$(jq -r '.session_id // empty' <<<"$result_json")"
  subtype="$(jq -r '.subtype // empty' <<<"$result_json")"
  cost="$(jq -r '.total_cost_usd // 0' <<<"$result_json")"
  cost_measured="true"
  # What the plan actually meters. On a subscription the dollar figure is
  # notional and this is the number that counts, so it is recorded beside
  # the cost rather than instead of it.
  #
  # `modelUsage` FIRST and summed across its models: it is the session's
  # own total, keyed by model, and a run that switched model mid-session
  # has a block each. The flat `usage` is the fallback because it holds
  # the LAST TURN alone — right shape, wrong span — and is worth reading
  # only when the per-model block is not there at all. Neither present
  # emits nothing: a token count can be measured or absent, never
  # assumed, so there is no equivalent of the over-charge rule below.
  tokens_json="$(jq -c '
    (.modelUsage // {} | if type == "object" then [.[]] else [] end) as $models
    | (if ($models | length) > 0 then
         {input:         ($models | map(.inputTokens // 0)              | add),
          output:        ($models | map(.outputTokens // 0)             | add),
          cacheRead:     ($models | map(.cacheReadInputTokens // 0)     | add),
          cacheCreation: ($models | map(.cacheCreationInputTokens // 0) | add)}
       elif (.usage | type) == "object" then
         {input:         (.usage.input_tokens // 0),
          output:        (.usage.output_tokens // 0),
          cacheRead:     (.usage.cache_read_input_tokens // 0),
          cacheCreation: (.usage.cache_creation_input_tokens // 0)}
       else empty end)
    # Cached or not, every one of these was processed — which is what
    # the plan bills against.
    | . + {total: (.input + .output + .cacheRead + .cacheCreation)}
  ' <<<"$result_json" 2>/dev/null)"
fi
fi

if [ -n "$stopped" ]; then
  terminal_reason="timeout"
  # A SIGKILLed run prints nothing, so the cost cannot be measured. The
  # accounting must over-charge what it could not measure, never under.
  cost="$budget_usd"; cost_measured="false"
  # A SIGTERM'd run DOES flush a result, usage block and all — and it is
  # no more trustworthy than the $0 beside it. The cost is over-charged
  # because it must land somewhere; the token count has no such duty, so
  # it is dropped rather than half-reported.
  tokens_json=""
  # A limit WE set, not something that happened to us — and spec 146's
  # commit below has already put the work on the branch, so the step
  # can be re-run from where it got to. The row says "press Run"
  # separately (`nextActionHint`); this sentence only has to say why
  # and that nothing was lost.
  error_msg="stopped at its own ${timeout_sec}s time limit for this step — work up to that point is committed to the branch"
# "Did the tool say how it went", not "was a cost measured" — the two
# are the same question for claude and different for codex, which
# finishes perfectly well without ever naming a dollar figure.
elif [ -n "${provider_limit_json:-}" ]; then
  terminal_reason="provider-limit"
  limit_type="$(jq -r '.rate_limit_info.rateLimitType // "provider" | gsub("_"; " ")' <<<"$provider_limit_json")"
  reset_at="$(jq -r '.rate_limit_info.resetsAt // empty | if type == "number" then todateiso8601 else tostring end' <<<"$provider_limit_json")"
  error_msg="$limit_type provider limit reached — press Run again once it resets"
  [ -n "$reset_at" ] && error_msg="$error_msg; resets $reset_at"
elif [ "$have_result" = "true" ]; then
  is_error="$(jq -r '.is_error // false' <<<"$result_json")"
  if [ "$subtype" = "error_max_budget_usd" ]; then
    terminal_reason="budget"
    error_msg="the step's budget was reached — raise the job cap in the project's .aide/config, then press Run again"
  elif [ "$is_error" = "true" ]; then
    terminal_reason="cli-error"
    error_msg="$(jq -r '(.errors // []) | join("; ")' <<<"$result_json")"
    [ -n "$error_msg" ] || error_msg="provider reported an error"
    error_msg="$error_msg — press Run again"
  elif [ "$exit_code" -ne 0 ]; then
    terminal_reason="cli-error"
    error_msg="$tool exit $exit_code — press Run again"
  else
  case "$subtype" in
    success) terminal_reason="completed" ;;
    # The codex branch above has already put the turn's own message
    # here; only claude's shape needs digging out at this point.
    *) terminal_reason="cli-error"
       [ -n "$error_msg" ] || error_msg="$(jq -r '(.errors // []) | join("; ")' <<<"$result_json")"
       error_msg="$error_msg — press Run again" ;;
  esac
  fi
else
  terminal_reason="cli-error"
  cost="$budget_usd"; cost_measured="false"
  error_msg="$(tail -c 400 "$work_dir/err" 2>/dev/null | tr '\n' ' ')"
  [ -n "$error_msg" ] || error_msg="$tool produced no result JSON (exit $exit_code)"
  error_msg="$error_msg — press Run again"
fi
fi

ok="false"
[ "$terminal_reason" = "completed" ] && ok="true"
# A mechanical decline is success with nothing more to do, the same rule
# already_landed() applies above: no judgment was needed, so nothing
# failed. The terminal reason still names the decline, which is what
# keeps the dashboard from landing it.
[ -n "$skip_ai" ] && ok="true"

# Exactly one new folder is an answer; zero or several is not, and is
# left unreported rather than guessed at. The spec still lands either
# way — what a wrong guess would cost is the job's history being attached
# to somebody else's spec.
created_spec_folder=""
if [ "$command_name" = "create" ] && [ "$ok" = "true" ]; then
  created_count=0
  while IFS= read -r folder; do
    [ -n "$folder" ] || continue
    case "$spec_folders_before" in
      *"|$folder|"*) ;;
      *) created_count=$(( created_count + 1 )); created_spec_folder="$folder" ;;
    esac
  done <<EOF
$(spec_folders_now)
EOF
  [ "$created_count" -eq 1 ] || created_spec_folder=""
fi
# The commit message says what the work IS, so it names the spec the step
# really made rather than the tracking key that stood in for it.
commit_label="${created_spec_folder:-$spec_label}"

