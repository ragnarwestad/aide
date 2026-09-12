#!/usr/bin/env bash
# run-spec-specs-guard.sh — a step writes only its own spec folder in the specs repo.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were.
# --- a step writes only its own spec folder in the specs repo ----------------
# 366's implement created two specs beside its own and deleted them again
# on its branch; the creations landed, other runs built on them, and the
# deletion landed on top of that work (2026-09-03). Under the specs ROOT,
# nothing but the spec's own folder — and its archive/ twin, which
# archive moves it to — may change, for every step but create, whose own
# folder is the one it makes. Foreign changes are discarded here, before
# the commit loop below can put them on the branch, and the step ends as
# a scope violation naming them.
if [ "$terminal_reason" = "completed" ] && [ "$command_name" != "create" ] && [ -n "$spec_folder" ]; then
  specs_repo_wt="${specs_wt:-$project_wt}"
  specs_root_rel="${specs_root_wt#"$specs_repo_wt"}"
  specs_root_rel="${specs_root_rel#/}"
  own_prefix="${specs_root_rel:+$specs_root_rel/}$spec_folder/"
  archive_prefix="${specs_root_rel:+$specs_root_rel/}archive/$spec_folder/"
  root_prefix="${specs_root_rel:+$specs_root_rel/}"
  foreign_paths=""
  while IFS= read -r changed_path; do
    [ -z "$changed_path" ] && continue
    case "$changed_path" in
      "$own_prefix"*|"$archive_prefix"*) ;;
      "$root_prefix"*) foreign_paths="${foreign_paths}${changed_path}"$'\n' ;;
    esac
  done <<EOF_PATHS
$( { git -C "$specs_repo_wt" status --porcelain -- . ${git_add_excludes[@]+"${git_add_excludes[@]}"} 2>/dev/null \
      | cut -c4- | sed 's/^.* -> //'; \
     [ -n "${specs_ref_before:-}" ] && git -C "$specs_repo_wt" diff --name-only "$specs_ref_before" HEAD -- . 2>/dev/null; } | sort -u)
EOF_PATHS
  if [ -n "$foreign_paths" ]; then
    # Back to what the run started from: a tracked path is restored, an
    # untracked one removed. Only the foreign paths — the spec's own
    # folder is untouched.
    while IFS= read -r foreign_path; do
      [ -z "$foreign_path" ] && continue
      git -C "$specs_repo_wt" checkout -q -- "$foreign_path" 2>/dev/null || rm -rf "${specs_repo_wt:?}/${foreign_path:?}"
    done <<EOF_FOREIGN
$foreign_paths
EOF_FOREIGN
    foreign_named="$(printf '%s' "$foreign_paths" | head -3 | tr '\n' ' ' | sed 's/ $//')"
    terminal_reason="scope-violation"
    ok="false"
    suffix=" (stopped: scope-violation)"
    error_msg="The step reported success but wrote outside its own spec folder in the specs repo — $foreign_named — those changes were discarded. A step writes only $spec_folder/; press $step_button again for this step."
    echo "aide-run-spec: $error_msg" >&2
  fi
fi
