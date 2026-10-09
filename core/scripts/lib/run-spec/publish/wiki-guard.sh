#!/usr/bin/env bash
# run-spec/publish/wiki-guard.sh — a wiki build writes generated pages in wiki/ and nothing else.
#
# Sourced by aide-run-spec after run-spec/publish/publish.sh and before the first
# commit_and_push_roots, so every variable it reads exists.
# restore_wiki_scope takes back what the session was never to write; a run
# that would otherwise read as completed ends as a scope violation instead,
# and one that left no index, no overview or reusable-parts page, or left
# pages it should have rewritten, ends as no progress.
# A run that already ended stopped or failed keeps that ending.
#
# An `archive` run gets a narrower, precision check below instead of
# restore_wiki_scope as a whole: that function's own steps 1 and 2 assume
# the run touched nothing outside wiki/ at all, which is false for
# `archive` (it also legitimately writes its own spec folder).
if [ "$command_name" = "wiki" ]; then
  restore_wiki_scope
  if [ -n "$wiki_taken" ] && [ "$terminal_reason" = "completed" ]; then
    wiki_named="$(printf '%s' "$wiki_taken" | cut -d, -f1-3)"
    terminal_reason="scope-violation"; ok="false"; suffix=" (stopped: scope-violation)"
    error_msg="the wiki build wrote what it may not — $wiki_named — and that was taken back. A build writes only generated pages in wiki/, through aide-wiki; press $step_button again for a new build"
    echo "aide-run-spec: $error_msg" >&2
  fi
  # A build writes the index last, through aide-wiki; a run that reads as
  # completed with no index left no wiki at all — nothing was built, however
  # the session put it.
  if [ "$terminal_reason" = "completed" ] && [ -n "${specs_root_wt:-}" ] && [ ! -f "$specs_root_wt/wiki/index.md" ]; then
    terminal_reason="no-progress"; ok="false"; suffix=" (stopped: no-progress)"
    error_msg="the wiki build left no wiki — wiki/index.md was never written, so no page was built. The run's own log says why; press $step_button again once that is fixed"
    echo "aide-run-spec: $error_msg" >&2
  fi
  # Every wiki has the project's overview and its reusable parts beside its
  # index: the analysis takes the project's context from them. A run that
  # reads as completed and leaves either one out is unfinished.
  if [ "$terminal_reason" = "completed" ] && [ -n "${specs_root_wt:-}" ] && [ -n "${project_wt:-}" ]; then
    wiki_lacks="$("$SCRIPT_DIR/aide-wiki" status --specs-root "$specs_root_wt" --project-dir "$project_wt" 2>/dev/null \
      | jq -r '(.missing // []) | join(", ")' 2>/dev/null)"
    if [ -n "$wiki_lacks" ]; then
      terminal_reason="no-progress"; ok="false"; suffix=" (stopped: no-progress)"
      error_msg="the wiki build left no $wiki_lacks — every wiki has the project's overview and its reusable parts beside its index. Press $step_button again"
      echo "aide-run-spec: $error_msg" >&2
    fi
  fi
  # What a run must leave, checked rather than asked for: a refresh leaves
  # no page whose files changed since it was written, and a build rewrites
  # every generated page from the commit it ran on. Pages left behind are
  # named, and the run ends unfinished rather than as done.
  if [ "$terminal_reason" = "completed" ] && [ -n "${specs_root_wt:-}" ] && [ -n "${project_wt:-}" ]; then
    wiki_left=""
    if [ "$wiki_refresh" = "yes" ]; then
      wiki_left="$("$SCRIPT_DIR/aide-wiki" status --specs-root "$specs_root_wt" --project-dir "$project_wt" 2>/dev/null \
        | jq -r '[.pages[]? | select(.state == "changed") | .page] | join(", ")' 2>/dev/null)"
    else
      wiki_head="$(git -C "$project_wt" rev-parse HEAD 2>/dev/null)"
      for wiki_page in "$specs_root_wt"/wiki/*.md; do
        [ -f "$wiki_page" ] || continue
        # The index and the schema name no files: aide-wiki leaves one
        # whose text did not change with the commit it was written from.
        case "$(basename "$wiki_page")" in index.md|schema.md) continue ;; esac
        grep -q '^wiki: generated$' "$wiki_page" || continue
        grep -q "^commit: $wiki_head\$" "$wiki_page" && continue
        wiki_left="${wiki_left:+$wiki_left, }$(basename "$wiki_page")"
      done
    fi
    if [ -n "$wiki_left" ]; then
      terminal_reason="no-progress"; ok="false"; suffix=" (stopped: no-progress)"
      error_msg="the wiki build left pages it did not rewrite — $(printf '%s' "$wiki_left" | cut -d, -f1-5). Press $step_button again"
      echo "aide-run-spec: $error_msg" >&2
    fi
  fi
# An archive rewrites only generated pages covering its changed files.
# Recompute that scope from the project's diff and the default branch's
# page sources, never from what the session claims it wrote.
elif [ "$command_name" = "archive" ] && [ "$terminal_reason" = "completed" ] \
     && [ -n "${specs_root_wt:-}" ] && [ -n "${project_wt:-}" ] && [ -d "$specs_root_wt/wiki" ]; then
  archive_repo_wt="${specs_wt:-$project_wt}"
  archive_wiki_rel="${specs_root_wt#"$archive_repo_wt"}"; archive_wiki_rel="${archive_wiki_rel#/}"
  archive_wiki_prefix="${archive_wiki_rel:+$archive_wiki_rel/}wiki/"
  archive_default_branch="$(default_branch "$specs_repo")"
  if git -C "$specs_repo" show-ref --verify --quiet "refs/remotes/origin/$archive_default_branch"; then
    archive_wiki_tip="origin/$archive_default_branch"
  else
    archive_wiki_tip="$archive_default_branch"
  fi
  # The pages as the default branch has them: the session's own rewrite
  # drops a file this spec deleted from a page's list, and asked after it
  # that page would no longer be one this spec reaches.
  archive_wiki_allowed="$("$SCRIPT_DIR/aide-wiki" affected --specs-root "$specs_root_wt" --project-dir "$project_wt" --base-ref "$archive_wiki_tip" 2>/dev/null | jq -r '.pages[]?.page')"
  archive_wiki_excludes=()
  while IFS= read -r archive_wiki_line; do
    [ -n "$archive_wiki_line" ] && archive_wiki_excludes+=("$archive_wiki_line")
  done <<ARCHIVE_WIKI_EXCLUDES_EOF
$(link_excludes_for "$project_root")
ARCHIVE_WIKI_EXCLUDES_EOF
  # What THIS run changed: from where the branch stood before the session
  # ($specs_ref_before, run-spec/turn/spec-paths.sh), leaving aside the pages
  # the default branch changed, which the merge the session finished
  # brought in. A page an earlier archive run rewrote was checked then: on
  # a run after the code has landed, the code diff is empty, and that
  # page would otherwise read as this run's write.
  archive_wiki_since="$archive_wiki_tip...HEAD"
  archive_wiki_mains=""
  if [ -n "${specs_ref_before:-}" ] && git -C "$archive_repo_wt" cat-file -e "$specs_ref_before" 2>/dev/null; then
    archive_wiki_since="$specs_ref_before"
    archive_wiki_fork="$(git -C "$archive_repo_wt" merge-base "$specs_ref_before" "$archive_wiki_tip" 2>/dev/null || echo "")"
    [ -n "$archive_wiki_fork" ] && \
      archive_wiki_mains="$(git -C "$archive_repo_wt" diff --name-only "$archive_wiki_fork" "$archive_wiki_tip" 2>/dev/null)"
  fi
  archive_wiki_named=""; archive_wiki_rewritten=""
  # Every path this run left dirty or untracked, or that the branch
  # changed since it left the default branch (`tip...HEAD`, so a page
  # main changed while the archive ran is not read as the archive's) —
  # never a glob of what is on disk NOW, which would miss a brand-new
  # untracked page (`git diff` alone is silent about one) and a page the
  # run deleted (absent from any glob of what remains). The same
  # enumeration restore_wiki_scope's own step 2 uses for the `wiki`
  # command.
  while IFS= read -r archive_wiki_path; do
    [ -z "$archive_wiki_path" ] && continue
    case "$archive_wiki_path" in "$archive_wiki_prefix"*) ;; *) continue ;; esac
    archive_wiki_n="${archive_wiki_path#"$archive_wiki_prefix"}"
    case "$archive_wiki_n" in */*) continue ;; esac
    # Main's change only when the page is main's copy: a session that
    # also wrote into it answers for that like any other page.
    if grep -qxF "$archive_wiki_path" <<<"$archive_wiki_mains" \
       && git -C "$archive_repo_wt" diff --quiet "$archive_wiki_tip" -- "$archive_wiki_path" 2>/dev/null; then
      continue
    fi
    if grep -qxF "$archive_wiki_n" <<<"$archive_wiki_allowed"; then
      archive_wiki_rewritten="${archive_wiki_rewritten:+$archive_wiki_rewritten, }$archive_wiki_n"
      continue
    fi
    wiki_take_back "$archive_repo_wt" "$archive_wiki_tip" "$archive_wiki_path"
    archive_wiki_named="${archive_wiki_named:+$archive_wiki_named, }$archive_wiki_n"
  done < <( { git -C "$archive_repo_wt" status --porcelain --untracked-files=all -- . ${archive_wiki_excludes[@]+"${archive_wiki_excludes[@]}"} 2>/dev/null \
                | cut -c4- | sed 's/^.* -> //'; \
              git -C "$archive_repo_wt" diff --name-only "$archive_wiki_since" -- . ${archive_wiki_excludes[@]+"${archive_wiki_excludes[@]}"} 2>/dev/null; } | sort -u )
  stage "wiki pages rewritten: ${archive_wiki_rewritten:-none}"
  if [ -n "$archive_wiki_named" ]; then
    terminal_reason="scope-violation"; ok="false"; suffix=" (stopped: scope-violation)"
    error_msg="the archive rewrote a wiki page it may not — $archive_wiki_named — and that was taken back. It rewrites only the pages covering files this spec's own code changed; press $step_button again"
    echo "aide-run-spec: $error_msg" >&2
  fi
fi
