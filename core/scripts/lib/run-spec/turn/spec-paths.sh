#!/usr/bin/env bash
# run-spec/turn/spec-paths.sh — where the spec folder is, what a step may write, and reading what came back.
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
# project repo change" (run-spec/record/status-line.sh's analyze scope-check).
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
        if git -C "$project_root" check-ignore -q -- "$rel/.aide-probe" 2>/dev/null; then
          mkdir -p "$(dirname "$project_wt/$rel")" 2>/dev/null || true
          ln -s "$specs_root" "$project_wt/$rel" 2>/dev/null || true
          git_add_excludes+=(":(exclude,top)$rel")
        else
          # Not ignored, only not committed yet — a new project's first
          # spec. It belongs on the branch like any tracked specs root:
          # a real directory here, carrying this step's own folder if the
          # main checkout already has one, and committed with the step.
          mkdir -p "$project_wt/$rel" 2>/dev/null || true
          if [ -n "${spec_folder:-}" ] && [ -d "$specs_root/$spec_folder" ] && [ ! -e "$project_wt/$rel/$spec_folder" ]; then
            cp -R "$specs_root/$spec_folder" "$project_wt/$rel/$spec_folder" 2>/dev/null || true
          fi
        fi
      fi
      # A .aide/config naming the specs root by its absolute path would
      # send every skill in this run to the main checkout's copy, which
      # nothing commits. Pointed at this worktree's own instead, as the
      # separate-specs-repo branch above does; the file is never committed.
      if [ -n "$rel" ] && [ -f "$project_root/.aide/config" ] &&
         grep -q '^AIDE_SPECS_PATH=/' "$project_root/.aide/config" 2>/dev/null; then
        cfg="$project_wt/.aide/config"
        mkdir -p "$project_wt/.aide" 2>/dev/null || true
        grep -v '^AIDE_SPECS_PATH=' "$project_root/.aide/config" > "$cfg" 2>/dev/null || true
        printf 'AIDE_SPECS_PATH=%s\n' "$specs_root_wt" >> "$cfg"
        git_add_excludes+=(":(exclude,top).aide/config")
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

# A project keeps nothing of Aide's in its repository (spec 512): an
# untracked `.aide/project.yaml` in the main checkout — the dashboard's
# derived copy of the settings it keeps, or a draft — is what
# `aide-resolve-test-cmd --project-dir .` reads inside this worktree, and
# a worktree carries tracked files only. Copied in when the worktree does
# not track one, and kept out of the commit by a pathspec whenever it was
# copied. The rule, stated once (tests/fixtures/manifest-carry.json):
# tracked in the worktree -> leave it alone; git unable to say -> leave it
# alone; untracked with a source -> copy it in and exclude it.
# STRICTLY AFTER update_branch_to_base, like repoint_specs_path: a merge
# that brings in a tracked manifest must not meet an untracked one.
carry_manifest_into_worktree() {
  local src="$project_root/.aide/project.yaml" dst="$project_wt/.aide/project.yaml" rc
  [ "$project_wt" != "$project_root" ] || return 0
  [ -f "$src" ] || return 0
  rc=0
  git -C "$project_wt" ls-files --error-unmatch -- .aide/project.yaml >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 1 ] || return 0
  mkdir -p "$project_wt/.aide" 2>/dev/null || return 0
  cp "$src" "$dst" 2>/dev/null || return 0
  git_add_excludes+=(":(exclude,top).aide/project.yaml")
  return 0
}
carry_manifest_into_worktree

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

# A create is told the one path it may write its folder under. The
# session picks the value it hands aide-create-spec, and the six runs
# before 2026-09-24 picked four different ones — the full path, "specs",
# "$SPECS_ROOT" and ".", the last of them the specs repository's top
# level, one directory above where the landing looks. Now a fact the
# prompt states, like the folder's name above it.
if [ "$command_name" = "create" ]; then
  prompt="$prompt
Create it under this specs root and nowhere else: pass --specs-root \"$specs_root_wt\" to aide-create-spec in Step 4."
fi

# A wiki build is told the one place it writes, the way a create is.
if [ "$command_name" = "wiki" ]; then
  prompt="$prompt
The wiki is kept in this specs root and nowhere else: pass --specs-root \"$specs_root_wt\" and --project-dir \"$project_wt\" to every aide-wiki call."
fi

# What the code repository's commit and pull request say (spec-free and
# tool-free: code_commit_message, run-spec/publish/publish.sh). The session knows
# what it changed and the runner does not, so the session writes it; the
# file sits in the run's own work directory, outside every repository.
commit_message_file="$work_dir/commit-message"
if [ "$command_name" != "create" ] && [ "$command_name" != "wiki" ]; then
  prompt="$prompt
If this step changes files outside the specs root, write the commit message for that change to $commit_message_file (do not commit): a subject line in the imperative mood, a blank line, then what changed and why. Write it as a developer on this project would. Do not mention the spec, the workflow step, Aide, or any AI tool or model.
The one commit you make yourself is the merge commit that finishes a merge conflict you resolved, exactly as the skill's conflict step says (git commit --no-edit); an unfinished merge leaves the step undone."
fi

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
# that decides a spec's number and its slug is landing's own, under the
# specs repo's merge lock, and a second copy of that rule here is
# precisely the mistake spec 82 was about (spec 453 moved WHERE that
# rule runs, never re-derived it a second time). A directory listing is
# also robust in a way parsing `git status` is not — the step may or may
# not have committed its own work by the time we look.
#
# Two shapes count as a spec folder: the numbered `NN-slug` an
# interactive session still makes on its own (AC-7), and the literal
# `new-<8 hex>` provisional key every headless create now makes instead
# — the same pattern `parse-request.ts`'s own `provisionalKey()` and
# `self-run.ts`'s dispatcher already match.
spec_folders_now() {
  local d base
  for d in "$specs_root_wt"/*/; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    [[ "$base" =~ ^([0-9]+-|new-[0-9a-f]{8}$) ]] && printf '%s\n' "$base"
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
# A reopen is mechanical either way, so no model runs for it. Keeping the
# files is aide-reopen-spec alone; --reset-files runs that same script and
# then aide-reset-spec over the folder it moved back, which is the pair a
# model turn was asked to imitate. The turn also cost a run and could be
# refused its own commands under a permission mode with nobody to ask —
# the reason the `reset` step stopped using one before it was removed.
reopen_keep_no_ai=""
reopen_reset_no_ai=""
if [ "$command_name" = "reopen" ]; then
  if [ "$reset_files" = "yes" ]; then reopen_reset_no_ai="yes"; else reopen_keep_no_ai="yes"; fi
fi

if [ -n "$skip_ai" ] || [ -n "$create_no_ai" ] || [ -n "$reopen_keep_no_ai" ] \
   || [ -n "$reopen_reset_no_ai" ]; then
  # No child spawned: every variable the commit loop, the phase-outcome
  # writer and the final JSON result read from a completed run is given
  # the same zero/absent shape already_landed() already uses above for
  # the same reason — a decline costs nothing.
  stopped=""; exit_code=0; duration=0
  session_out=""; subtype=""; cost="0"; cost_measured="false"; tokens_json=""
  model_id_out=""
  cost_known="true"; error_msg=""
  if [ -n "$create_no_ai" ]; then
    # Spec 453: this path is reached only from aide-run-spec, headless by
    # construction — the same literal-name mode the AI-driven skill path
    # now uses, never an auto-picked number. The real number is
    # landing's own business now, under the one lock two concurrent
    # creates cannot both miss.
    create_args=(--specs-root "$specs_root_wt" --folder-name "$spec_arg"
                  --title "$title" --description "$description")
    [ -n "$depends_on" ] && create_args+=(--depends-on "$depends_on")
    [ "$acceptance_not_required" = "yes" ] && create_args+=(--acceptance-not-required)
    create_result="$("$SCRIPT_DIR/aide-create-spec" "${create_args[@]}" 2>/dev/null)"
    if [ "$(jq -r '.ok // false' <<<"$create_result" 2>/dev/null)" = "true" ]; then
      terminal_reason="completed"
      cost_measured="true"
      tool="none"
      # No AI ran, so nothing chosen for --model/--effort means anything:
      # run-spec/checkout/cleanup.sh's model_value="$tool${model:+ $model}" would
      # otherwise read "none <configured-model>" for a create job whose
      # config still names a default model for that step.
      model=""; effort=""
    else
      # The script's own refusal, before any AI ran: not the CLI failing,
      # so nothing names a tool or a model for it.
      terminal_reason="refused"
      tool="none"; model=""; effort=""
      error_msg="$(jq -r '.error // "aide-create-spec refused"' <<<"$create_result" 2>/dev/null)"
    fi
  elif [ -n "$reopen_keep_no_ai" ] || [ -n "$reopen_reset_no_ai" ]; then
    reopen_args=(--specs-root "$specs_root_wt" --spec "$spec_folder")
    [ -n "$reopen_boundary_sha" ] && reopen_args+=(--boundary "$reopen_boundary_sha")
    reopen_result="$("$SCRIPT_DIR/aide-reopen-spec" "${reopen_args[@]}" 2>/dev/null)"
    if [ "$(jq -r '.ok // false' <<<"$reopen_result" 2>/dev/null)" = "true" ]; then
      terminal_reason="completed"
      cost_measured="true"
      tool="none"
      model=""; effort=""
      # The reset mode's second half, over the folder the line above moved
      # back out of archive/ — which is the order aide-reset-spec needs: it
      # refuses an archived folder by name. The `**Reopened:**` mark comes
      # after both, from run-spec/record/boundary.sh, over the status file this
      # writes from the template.
      if [ -n "$reopen_reset_no_ai" ]; then
        reset_result="$("$SCRIPT_DIR/aide-reset-spec" --specs-root "$specs_root_wt" --spec "$spec_folder" 2>/dev/null)"
        if [ "$(jq -r '.ok // false' <<<"$reset_result" 2>/dev/null)" != "true" ]; then
          terminal_reason="refused"
          error_msg="$(jq -r '.error // "aide-reset-spec refused"' <<<"$reset_result" 2>/dev/null)"
        fi
      fi
    else
      terminal_reason="refused"
      tool="none"; model=""; effort=""
      error_msg="$(jq -r '.error // "aide-reopen-spec refused"' <<<"$reopen_result" 2>/dev/null)"
    fi
  else
    terminal_reason="$archive_terminal_reason"; error_msg=""
  fi
else
  run_model_turn "$work_dir/prompt"
  # The analysis's session could not be continued — gone, or refused by
  # the tool: the implement starts afresh, as it would have without it.
  if [ -n "$resume_session" ] && { [ "$terminal_reason" = "cli-error" ] || [ "$terminal_reason" = "model-refused" ]; }; then
    echo "aide-run-spec: the analysis session $resume_session could not be continued; starting the implement afresh" >&2
    argv=("${fresh_argv[@]}"); resume_session=""
    session_out=""; subtype=""; cost="0"; cost_measured="false"; terminal_reason=""; error_msg=""
    run_model_turn "$work_dir/prompt"
  fi
fi
# What Aide does once the AI is done: its own test run, the commit and
# the push. A step with no AI turn goes straight on from preparing.
aide_part_close
aide_part_open "tests and commit"

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
# A create that reported success without a folder named $spec_arg under
# its specs root did not make the spec: the landing gives that exact
# folder its number and looks nowhere else (spec 453). Said here, where
# it happened, instead of as "could not assign this spec its number"
# from the landing — and the folder is left where it is: the board says
# what went wrong, it does not move things to make it right.
if [ "$command_name" = "create" ] && [ "$ok" = "true" ] && [ -z "$create_no_ai" ] \
   && [ ! -d "$specs_root_wt/$spec_arg" ]; then
  misplaced_where=""
  for misplaced_base in "${specs_wt:-}" "$project_wt"; do
    [ -n "$misplaced_base" ] || continue
    misplaced_found="$(find "$misplaced_base" -maxdepth 4 -type d -name "$spec_arg" -not -path '*/.git/*' 2>/dev/null | head -1)"
    if [ -n "$misplaced_found" ]; then
      if [ "$misplaced_base" = "${specs_wt:-}" ]; then
        misplaced_where="at ${misplaced_found#"$misplaced_base"/} in the specs repository"
      else
        misplaced_where="at ${misplaced_found#"$misplaced_base"/} in the project's own repository"
      fi
      break
    fi
  done
  specs_root_shown="${specs_root_wt#"${specs_wt:-$project_wt}"/}"
  [ "$specs_root_shown" = "$specs_root_wt" ] && specs_root_shown="the specs root"
  terminal_reason="no-progress"
  ok="false"
  suffix=" (stopped: no-progress)"
  if [ -n "$misplaced_where" ]; then
    error_msg="the step reported success but made the spec folder in the wrong place — $spec_arg is $misplaced_where, not under $specs_root_shown. Press $step_button again for this step."
  else
    error_msg="the step reported success but made no spec folder named $spec_arg under $specs_root_shown. Press $step_button again for this step."
  fi
  created_spec_folder=""
fi
# The commit message says what the work IS, so it names the spec the step
# really made rather than the tracking key that stood in for it.
commit_label="${created_spec_folder:-$spec_label}"

