#!/usr/bin/env bash
# hooks-merge.sh - aide's Codex hooks in ~/.codex/hooks.json, beside the user's.
# Sourced by core/implementations/codex/install.sh and uninstall.sh.
#
# A hook is aide's when its command runs a script from ~/.codex/hooks/aide-*.
# An install takes those out and adds the current ones from the repository;
# an uninstall takes them out. Every other hook stays as the user wrote it.
# The merge needs jq; without it a file of the user's own is left untouched.

# Every hook whose command is aide's taken out, and any matcher group or event
# left empty by that.
_AIDE_CODEX_HOOKS_STRIP='
  .hooks = ((.hooks // {})
    | with_entries(.value |= (map(.hooks |= map(select((.command // "") | test("/\\.codex/hooks/aide-") | not)))
                              | map(select(.hooks | length > 0))))
    | with_entries(select(.value | length > 0)))'

# install_codex_hooks <aide hooks.json> <config>
install_codex_hooks() {
  local aide="$1" config="$2" merged
  mkdir -p "$(dirname "$config")"
  if [ ! -f "$config" ] || cmp -s "$aide" "$config"; then
    cp "$aide" "$config"
    return 0
  fi
  if ! command -v jq &> /dev/null; then
    echo "   ⚠️  ~/.codex/hooks.json has hooks of your own, and merging aide's in needs jq;"
    echo "      left as it is, so aide's hooks are not installed (brew install jq, then install again)"
    return 0
  fi
  merged="$(jq --slurpfile aide "$aide" "$_AIDE_CODEX_HOOKS_STRIP"'
    | .hooks = (reduce ($aide[0].hooks | to_entries[]) as $e (.hooks; .[$e.key] = ((.[$e.key] // []) + $e.value)))' "$config")"
  printf '%s\n' "$merged" > "$config"
  echo "   ✅ aide's hooks merged into ~/.codex/hooks.json; your own hooks are kept"
}

# uninstall_codex_hooks <aide hooks.json> <config>
#
# A file left with no hooks and nothing but a description is removed.
uninstall_codex_hooks() {
  local aide="$1" config="$2" stripped
  if [ ! -f "$config" ]; then
    echo "   ⏭️  Did not exist: ~/.codex/hooks.json"
    return 0
  fi
  if cmp -s "$aide" "$config"; then
    rm "$config"
    echo "   ✅ Removed: ~/.codex/hooks.json"
    return 0
  fi
  if ! command -v jq &> /dev/null; then
    echo "   ⚠️  ~/.codex/hooks.json has hooks of your own, and taking aide's out needs jq — left in place"
    return 0
  fi
  stripped="$(jq "$_AIDE_CODEX_HOOKS_STRIP" "$config")"
  if [ "$(jq '(.hooks | length) == 0 and ((keys - ["hooks", "description"]) | length) == 0' <<< "$stripped")" = true ]; then
    rm "$config"
    echo "   ✅ Removed: ~/.codex/hooks.json"
  else
    printf '%s\n' "$stripped" > "$config"
    echo "   ✅ Removed aide's hooks from ~/.codex/hooks.json; your own hooks are kept"
  fi
}
