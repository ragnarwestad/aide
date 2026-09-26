#!/usr/bin/env bash
# run-spec-wiki-guard.sh — a wiki build writes generated pages in wiki/ and nothing else.
#
# Sourced by aide-run-spec after run-spec-publish.sh and before the first
# commit_and_push_roots, so every variable it reads exists.
# restore_wiki_scope takes back what the session was never to write; a run
# that would otherwise read as completed ends as a scope violation instead,
# and one that left no index ends as no progress.
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
fi
