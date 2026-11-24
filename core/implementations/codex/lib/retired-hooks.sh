#!/usr/bin/env bash
# retired-hooks.sh - the command-rule scripts an earlier Codex install put in
# ~/.codex/hooks/. The rules now run from ~/.local/bin/lib/command-rules/,
# shared with Claude Code. Sourced by install.sh.

# remove_retired_codex_rules <hooks dir> <hooks.json>
#
# A retired script is removed only once the config no longer calls it: when
# the merge could not run (no jq, a file that is not JSON), the old entries
# are still there, and the script they call stays with them.
remove_retired_codex_rules() {
  local dir="$1" config="$2" retired
  for retired in aide-block-git-add-all.sh aide-block-watch-mode.sh; do
    [ -f "$dir/$retired" ] || continue
    if [ -f "$config" ] && grep -Fq "$retired" "$config"; then
      echo "   ⚠️  Kept ~/.codex/hooks/$retired: ~/.codex/hooks.json still calls it"
      continue
    fi
    rm "$dir/$retired"
    echo "   🗑️  Removed old: ~/.codex/hooks/$retired"
  done
}
