#!/usr/bin/env bash
# run-spec/checkout/unlanded-archive.sh — sourced by aide-run-spec before
# run-spec/turn/spec-paths.sh, which calls restore_unlanded_archive once the
# specs root of this run's worktree is known and before the session starts.
#
# An archive moves the spec's folder into `archive/` on the spec's own
# specs branch, and only its landing brings that move to the default
# branch. A landing that stopped (red tests, a conflict) leaves the branch
# with the folder archived while the default branch still has it open, and
# the board offers Implement and Analyze for the open spec. A session on
# that branch writes into the archived copy, and every script that looks
# for the folder where the default branch has it finds nothing.
#
# So an analyze or implement on such a branch first moves the folder back
# where the default branch has it, carrying whatever was written into the
# archived copy, and commits that on the spec's branch. The move is
# aide-reopen-spec's keep-the-files reopen: `archive` leaves the steps line
# and the state file, and a round boundary makes the archive's stamp and
# its commit history, so a later Archive runs as on any implemented spec.
restore_unlanded_archive() {
  local top prefix base base_ref_here here result
  case "$command_name" in analyze|implement) ;; *) return 0 ;; esac
  [ -n "${spec_folder:-}" ] || return 0
  [ -d "$specs_root_wt/archive/$spec_folder" ] || return 0
  [ ! -e "$specs_root_wt/$spec_folder" ] || return 0
  # Only a specs root that is part of one of this run's own worktrees: a
  # specs root linked in from the main checkout is not on the branch.
  top="$(git -C "$specs_root_wt" rev-parse --show-toplevel 2>/dev/null)" || return 0
  for here in "${work_roots[@]}"; do
    [ "$(cd "$here" 2>/dev/null && pwd -P)" = "$(cd "$top" 2>/dev/null && pwd -P)" ] && top="$here" && break
    here=""
  done
  [ -n "$here" ] || return 0
  prefix="$(git -C "$specs_root_wt" rev-parse --show-prefix 2>/dev/null)"
  base="$(default_branch "$top")"
  base_ref_here="$(ref_on_origin "$top" "$base")"
  git -C "$top" cat-file -e "$base_ref_here:${prefix}$spec_folder" 2>/dev/null || return 0
  ! git -C "$top" cat-file -e "$base_ref_here:${prefix}archive/$spec_folder" 2>/dev/null || return 0
  # A commit now would finish the merge the session is to resolve.
  if git -C "$top" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    stage_error "$spec_reference is under archive/ on its branch from an archive that never merged, but a merge is open there — finish the merge in the specs checkout on the serving host"
    return 0
  fi
  result="$("$SCRIPT_DIR/aide-reopen-spec" --specs-root "$specs_root_wt" --spec "$spec_folder" \
    --boundary "$(git -C "$top" rev-parse --short HEAD 2>/dev/null)" 2>/dev/null)"
  [ "$(jq -r '.ok // false' <<<"$result" 2>/dev/null)" = "true" ] \
    || refuse_fix "$spec_reference is under archive/ on its branch from an archive that never merged into $base, and could not be moved back ($(jq -r '.error // "no answer"' <<<"$result" 2>/dev/null))" \
      "fix the specs checkout on the serving host"
  git -C "$top" commit -q -m "Move $spec_folder back out of archive/ — its archive never merged into $base" >/dev/null 2>&1 \
    || refuse "$spec_reference was moved back out of archive/ on its branch, but the move could not be committed"
  stage "$spec_reference was under archive/ on its branch from an archive that never merged — moved back where $base has it"
}
