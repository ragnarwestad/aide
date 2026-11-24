#!/usr/bin/env bash
# _install-hooks.sh - aide's hooks in a tool's config file, beside the user's.
# Sourced by the Claude Code and Codex installers and uninstallers.
#
# Both ~/.claude/settings.json and ~/.codex/hooks.json keep hooks under a
# top-level "hooks" key: event -> matcher groups -> hooks. A hook is aide's
# when its command matches the tool's pattern below. An install takes those
# out and adds the current ones from the repository; an uninstall takes them
# out. Every other hook and every other key stays as the user wrote it.
# The merge needs jq; without it, or when the file is not JSON, the file is
# left untouched.

# Codex: the shared command rules, and the scripts an earlier install put in
# ~/.codex/hooks/.
AIDE_HOOKS_PATTERN_CODEX='/\.codex/hooks/aide-|/\.local/bin/lib/command-rules/'
# Claude Code: the shared command rules, and the two inline rules an earlier
# settings template carried, known by their refusal messages.
AIDE_HOOKS_PATTERN_CLAUDE='/\.local/bin/lib/command-rules/|Blocked: Use explicit file names with git add|Blocked: Use pnpm test -- --run'

# Every hook whose command matches $pattern taken out, and any matcher group
# or event left empty by that.
_AIDE_HOOKS_STRIP='
  .hooks = ((.hooks // {})
    | with_entries(.value |= (map(.hooks |= map(select((.command // "") | test($pattern) | not)))
                              | map(select(.hooks | length > 0))))
    | with_entries(select(.value | length > 0)))'

# _aide_hooks_readable <config> <label> - jq is there and the file is JSON;
# otherwise says why the file is left as it is.
_aide_hooks_readable() {
  local config="$1" label="$2"
  if ! command -v jq &> /dev/null; then
    echo "   ⚠️  $label has content of your own, and merging aide's hooks needs jq;"
    echo "      left as it is (brew install jq, then install again)"
    return 1
  fi
  if ! jq -e 'type == "object"' "$config" &> /dev/null; then
    echo "   ⚠️  $label is not a JSON object jq can read; left as it is, so aide's hooks are not changed there"
    return 1
  fi
}

# The config path as the messages show it, ~ for $HOME.
_aide_hooks_label() {
  local tilde="~"
  printf '%s' "${1/#"$HOME"/$tilde}"
}

# install_aide_hooks <aide hooks file> <config> <pattern>
install_aide_hooks() {
  local aide="$1" config="$2" pattern="$3" label merged
  label="$(_aide_hooks_label "$config")"
  mkdir -p "$(dirname "$config")"
  if [ ! -f "$config" ] || cmp -s "$aide" "$config"; then
    cp "$aide" "$config"
    echo "   ✅ Installed aide's hooks: $label"
    return 0
  fi
  _aide_hooks_readable "$config" "$label" || return 0
  merged="$(jq --arg pattern "$pattern" --slurpfile aide "$aide" "$_AIDE_HOOKS_STRIP"'
    | .hooks = (reduce ($aide[0].hooks | to_entries[]) as $e (.hooks; .[$e.key] = ((.[$e.key] // []) + $e.value)))' "$config")"
  printf '%s\n' "$merged" > "$config"
  echo "   ✅ aide's hooks merged into $label; your own content is kept"
}

# uninstall_aide_hooks <aide hooks file> <config> <pattern>
#
# A file left with no hooks and nothing but a description is removed.
uninstall_aide_hooks() {
  local aide="$1" config="$2" pattern="$3" label stripped
  label="$(_aide_hooks_label "$config")"
  if [ ! -f "$config" ]; then
    echo "   ⏭️  Did not exist: $label"
    return 0
  fi
  if cmp -s "$aide" "$config"; then
    rm "$config"
    echo "   ✅ Removed: $label"
    return 0
  fi
  _aide_hooks_readable "$config" "$label" || return 0
  stripped="$(jq --arg pattern "$pattern" "$_AIDE_HOOKS_STRIP" "$config")"
  if [ "$(jq '(.hooks | length) == 0 and ((keys - ["hooks", "description"]) | length) == 0' <<< "$stripped")" = true ]; then
    rm "$config"
    echo "   ✅ Removed: $label"
  else
    printf '%s\n' "$stripped" > "$config"
    echo "   ✅ Removed aide's hooks from $label; your own content is kept"
  fi
}
