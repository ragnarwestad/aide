#!/usr/bin/env bash
# run-spec-publish.sh — committing and publishing, confirmed against origin.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were. Split out 2026-09-04: the
# script had reached 2925 lines, five times the next largest file in
# the repo, and no reader could hold it.
# --- committing and publishing the work, confirmed against origin (spec 343)
# The commit loop and the push loop below both used to run exactly once.
# Now they run as `commit_and_push_roots`, callable more than once in the
# same invocation: once, unconditionally, for the step's own content
# (every command, including `explore`/`manifest`/`reopen`/`reset`/
# `schedule`, none of which ever set $status_file); and, only for the
# four WORKFLOW_ARC commands, a second time for the `Workflow steps
# completed` line's own small commit — made only once the first pass has
# been CONFIRMED against origin, so the line is never written on the
# strength of a push that has not actually landed (REQ-1).
#
# Run-wide accumulators, initialized once, before either call — separate
# from commit_and_push_roots's own per-call locals (amend_source), so a
# second call UPDATES what the first found instead of silently losing it.
# $repos_json is assembled once, at the very end, from $head_before (the
# run's true start) and whichever call last touched each root.
head_after_per_root=(); changed_files_per_root=()
i=0
for root in "${roots[@]}"; do
  head_after_per_root[$i]="${head_before[$i]}"
  changed_files_per_root[$i]=0
  i=$(( i + 1 ))
done
repos_json="[]"
push_error=""; branch_url=""; pr_url=""; pr_error=""
branch_urls_json="[]"

# The compare page is the diff view a reviewer opens; it only exists for
# GitHub remotes, so a local or self-hosted origin simply gets no link.
github_web_url() {
  local url="$1"
  case "$url" in
    git@github.com:*) url="https://github.com/${url#git@github.com:}" ;;
    ssh://git@github.com/*) url="https://github.com/${url#ssh://git@github.com/}" ;;
    https://github.com/*) ;;
    *) return ;;
  esac
  printf '%s' "${url%.git}"
}

note_push_error() {
  [ -z "$push_error" ] && push_error="$1" || push_error="$push_error; $1"
}

# Shared by both push paths below (a plain push and REQ-2's retried
# force-with-lease): the compare link and, for the reader who wants one
# link, $branch_url — the project's own when the project changed,
# otherwise whichever repo did. Second-call safe (spec 343): the same
# root pushed in an earlier call is not appended a second time when specs
# live inside the project repo, since $branch_urls_json is no longer
# reset between calls.
record_branch_url() {
  local root="$1" web="" url=""
  jq -e --arg root "$root" 'any(.[]; .root == $root)' <<<"$branch_urls_json" >/dev/null 2>&1 && return 0
  web="$(github_web_url "$(git -C "$root" remote get-url origin 2>/dev/null)")"
  [ -n "$web" ] && url="$web/compare/$(default_branch "$root")...$branch"
  # Every repo the step pushed to gets an entry, whether or not it has a
  # web link: $branch_urls_json is the dashboard's "which repos" answer
  # (queue/types.ts's own doc comment on branchUrls), not only "which
  # repos have a clickable compare page" — a local or self-hosted origin
  # still counts as pushed, it just carries no link.
  branch_urls_json="$(jq -c --arg root "$root" --arg url "$url" \
    '. + [{root:$root, url:$url}]' <<<"$branch_urls_json")"
  if [ -n "$url" ] && { [ "$root" = "$project_root" ] || [ -z "$branch_url" ]; }; then
    branch_url="$url"
  fi
}

# REQ-2/REQ-5 (spec 359): bounded, and the same bound the TypeScript
# side (`PUSH_RETRY_WAITS_MS` in branch-merge.ts) uses — long enough to
# ride out a momentary GitHub blip (spec 314), short enough that a run
# that is really offline still finishes in seconds.
PUSH_RETRY_WAITS=(1 2)

# One push, with its own recovery (spec 359). Tries the plain push (and,
# for a root this run amended, the existing force-with-lease retry)
# exactly as before. Only on failure does it ask WHY: origin unreachable
# is retried blind (REQ-2); origin reachable but the push still rejected
# means the branch moved under us, which `pull --rebase` can settle on
# its own (REQ-1) — unless the rebase itself conflicts, which is a
# person's call and never the script's (REQ-3). Sets $push_retry_error
# on failure and $push_retry_new_head when a rebase moved local HEAD —
# the caller folds that into $head_after_per_root itself, since this
# helper has no run-wide accumulator of its own to write into.
push_with_retry() {
  local root="$1" wt="$2" amended_sha="$3" err=""
  push_retry_error=""; push_retry_new_head=""

  try_push() {
    if err="$(git -C "$wt" push -q -u origin "$branch" 2>&1)"; then return 0; fi
    [ -n "$amended_sha" ] || return 1
    err="$(git -C "$wt" push -q --force-with-lease="$branch:$amended_sha" origin "$branch" 2>&1)"
  }

  try_push && return 0

  if ! git -C "$wt" ls-remote origin >/dev/null 2>&1; then
    # REQ-2: origin itself did not answer — retry the push, not a rebase.
    local wait_s
    for wait_s in "${PUSH_RETRY_WAITS[@]}"; do
      sleep "$wait_s"
      try_push && return 0
    done
    push_retry_error="cannot reach origin for $branch in $root: $(printf '%s' "$err" | tr '\n' ' ' | tail -c 200)"
    return 1
  fi

  # REQ-1: origin answered, so the push was REJECTED — almost always
  # because something else landed a commit on this branch since this
  # worktree last looked (another run, or the landing's own cleanup).
  if git -C "$wt" pull -q --rebase origin "$branch" >/dev/null 2>&1; then
    push_retry_new_head="$(git -C "$wt" rev-parse HEAD 2>/dev/null || echo "")"
    try_push && return 0
    push_retry_error="cannot push $branch in $root after a rebase: $(printf '%s' "$err" | tr '\n' ' ' | tail -c 200)"
    return 1
  fi

  # REQ-3: the rebase itself conflicted — real, different commits on
  # both sides. Abort back to exactly where this worktree stood, and
  # name what a person has to reconcile rather than guessing.
  git -C "$wt" rebase --abort >/dev/null 2>&1 || true
  local ours theirs
  ours="$(git -C "$wt" log --oneline "origin/$branch..$branch" 2>/dev/null | tr '\n' '; ')"
  theirs="$(git -C "$wt" log --oneline "$branch..origin/$branch" 2>/dev/null | tr '\n' '; ')"
  push_retry_error="$branch has diverged from origin's copy in $root — this run has: ${ours:-(nothing)}; origin has: ${theirs:-(nothing)} — reconcile by hand"
  return 1
}

# Commits whatever is dirty in each root, then pushes every root whose
# local tip is not yet what origin has. $amend_source is per-call
# (local here) on purpose — a pass's own amend decision is only ever
# read by that same pass's own push loop, below; everything else this
# function touches is a run-wide accumulator, declared above, so a
# second call adds to what the first one found.
commit_and_push_roots() {
  local i=0 root wt changed head_now amend_source=()
  for root in "${roots[@]}"; do
    wt="${work_roots[$i]}"
    changed="$(git -C "$wt" status --porcelain -- . ${git_add_excludes[@]+"${git_add_excludes[@]}"} 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$changed" -gt 0 ]; then
      changed_files_per_root[$i]=$(( ${changed_files_per_root[$i]} + changed ))
      git -C "$wt" add -A -- . ${git_add_excludes[@]+"${git_add_excludes[@]}"} >/dev/null 2>&1
      head_now="$(git -C "$wt" rev-parse HEAD 2>/dev/null || echo "")"
      # Compared against ${head_after_per_root[$i]} — the tip as THIS
      # root stood when THIS call began — never ${head_before[$i]}, the
      # run's own absolute start (spec 343). On a first call the two are
      # identical (the run-wide accumulator seeds head_after_per_root
      # from head_before before either call). On a second call they are
      # not: head_before[$i] is now stale, still pointing at the tip
      # BEFORE the first call's own commit, so comparing against it would
      # read that first call's own ordinary commit as "the model must
      # have self-committed under a written message" and route the
      # second call's small write into a needless amend-plus-ls-remote
      # check — network traffic (and a real behavior difference) a
      # second pass has no reason to cause. Comparing against the
      # PREVIOUS call's own leftover tip means $head_now (still that same
      # tip — `add -A` never moves HEAD) equals it here on every call
      # after the first, so this whole branch is only ever reached when
      # something committed BETWEEN entering this function and this
      # point — which for the very first call can only be the model's
      # own self-commit, exactly as before.
      if [ -n "$head_now" ] && [ "$head_now" != "${head_after_per_root[$i]}" ] \
         && ! commit_already_on_origin "$root" "$head_now"; then
        # The step already committed part of its own work under a written
        # message (spec 146) — fold the leftover into THAT commit rather
        # than opening a second one under the generic subject. Only when
        # that commit is not already public (REQ-1): amending a commit
        # origin already has is what stranded spec 327's stamp on the
        # machine that ran it.
        amend_source[$i]="$head_now"
        if [ -n "$amend_note" ]; then
          # The step's own message can have a body, so gluing the note
          # onto the raw %B would land it mid-paragraph: give it a line of
          # its own and drop the leading space that only made sense
          # inline. `--no-edit` is what is left when the note has nothing
          # to say at all — since spec 217 that means neither a stop
          # reason NOR a model, so it cannot be assumed from an empty
          # $suffix alone.
          existing_message="$(git -C "$wt" log -1 --pretty=%B)"
          git -C "$wt" commit -q --amend -m "$existing_message"$'\n\n'"${amend_note# }" >/dev/null 2>&1 || true
        else
          git -C "$wt" commit -q --amend --no-edit >/dev/null 2>&1 || true
        fi
      else
        git -C "$wt" commit -q -m "Run /aide-$command_name for $commit_label (headless)$model_suffix$suffix" >/dev/null 2>&1 || true
      fi
    fi
    head_after_per_root[$i]="$(git -C "$wt" rev-parse HEAD 2>/dev/null || echo "${head_after_per_root[$i]}")"
    i=$(( i + 1 ))
  done

  if [ "$push_mode" != "none" ]; then
    i=0
    for root in "${roots[@]}"; do
      wt="${work_roots[$i]}"
      head_was="${head_before[$i]}"
      head_is="${head_after_per_root[$i]}"
      amended_sha="${amend_source[$i]:-}"
      idx=$i
      # A branch with nothing beyond the root's own default branch has
      # nothing to publish, whether this is its first run or its fifth:
      # without this check, REQ-4's widened gate below would try to push
      # it too, since a brand new branch has no ref on origin yet to
      # compare against and so never reads as "already confirmed" either.
      # Asked as containment (`tip_has_nothing_of_its_own`), so the same
      # sentence holds while another spec's landing moves that default
      # branch — the confirmation in run-spec-worktree.sh asks it the
      # same way, and the two disagreeing is what reported an untouched
      # root as unpushed work.
      i=$(( i + 1 ))
      tip_has_nothing_of_its_own "$root" "$head_is" && continue
      # REQ-4: a root this run did not move ($head_was = $head_is) is
      # STILL a candidate — but only when this run itself ended
      # `completed`. Widening this to "any root with unconfirmed content"
      # unconditionally would publish a branch's pre-existing content on
      # a run that did nothing of its own and reported it: archive giving
      # up on an unresolved conflict (`git merge --abort`, HEAD never
      # moves) must leave the branch exactly where it found it, even
      # though that branch — built up by earlier steps — already carries
      # commits origin has never seen. `terminal_reason`, not `ok`: a
      # root this run DID move is pushed regardless of terminal_reason,
      # exactly as before (a stopped run still folds its work into its
      # own commit, spec 146, and that commit still belongs on origin).
      if [ "$head_was" = "$head_is" ] && [ "$terminal_reason" != "completed" ]; then
        continue
      fi
      # Gated on whether ORIGIN already has this tip, not on whether
      # THIS call moved it — a commit a prior run's failed push left
      # stranded here, with nothing new for this run's own session to
      # commit, is retried on every later completed run until it lands,
      # not only the run that made it. Still never a root `changedFiles`
      # alone would have called dirty (dashboard/CLAUDE.md): the checks
      # above already exclude a root with nothing beyond its own default
      # branch, and a root this run neither moved nor completed.
      commit_already_on_origin "$root" "$head_is" && continue
      if ! git -C "$root" remote get-url origin >/dev/null 2>&1; then
        note_push_error "no origin remote in $root"
        continue
      fi
      if push_with_retry "$root" "$wt" "$amended_sha"; then
        record_branch_url "$root"
      else
        note_push_error "$push_retry_error"
      fi
      if [ -n "$push_retry_new_head" ]; then
        # A REQ-1 rebase can move local HEAD whether or not the retried
        # push that follows it succeeds — this array means "this call's
        # true final local tip," not "the tip it managed to push," so it
        # is folded in unconditionally rather than only on success.
        # $repos_json is built once, at the very end, straight from this
        # array (below), so nothing else needs to be told about the move.
        head_after_per_root[$idx]="$push_retry_new_head"
      fi
    done
  fi
}

