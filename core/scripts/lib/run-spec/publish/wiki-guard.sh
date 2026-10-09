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
fi
