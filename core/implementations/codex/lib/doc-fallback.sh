#!/usr/bin/env bash
# doc-fallback.sh - Let Codex read a project's CLAUDE.md where it has no AGENTS.md.
# Sourced by core/implementations/codex/install.sh and uninstall.sh.
#
# Codex reads only AGENTS.md as a project's instructions unless
# `project_doc_fallback_filenames` names other files. A project that has only
# a CLAUDE.md would otherwise give Codex no project instructions at all.

CODEX_DOC_FALLBACK_LINE='project_doc_fallback_filenames = ["CLAUDE.md"]'
CODEX_DOC_FALLBACK_MARK='# Written by the aide Codex installer, and removed by its uninstaller.'

# install_codex_doc_fallback <config>
#
# Adds the key, under a comment naming its writer, as the file's first lines,
# where a top-level key stays outside every table. A key already there is the user's choice and is left alone.
install_codex_doc_fallback() {
  local config="$1"
  if [ -f "$config" ] && grep -qE '^[[:space:]]*project_doc_fallback_filenames[[:space:]]*=' "$config"; then
    if grep -qxF "$CODEX_DOC_FALLBACK_LINE" "$config"; then
      echo "   ✅ Codex already reads CLAUDE.md where a project has no AGENTS.md"
    else
      echo "   ⚠️  project_doc_fallback_filenames is already set in $config and was left as it is;"
      echo "      add \"CLAUDE.md\" to it for Codex to read a project's CLAUDE.md where it has no AGENTS.md"
    fi
    return 0
  fi
  mkdir -p "$(dirname "$config")"
  local rest=""
  [ -f "$config" ] && rest="$(cat "$config")"
  if [ -n "$rest" ]; then
    printf '%s\n%s\n%s\n' "$CODEX_DOC_FALLBACK_MARK" "$CODEX_DOC_FALLBACK_LINE" "$rest" > "$config"
  else
    printf '%s\n%s\n' "$CODEX_DOC_FALLBACK_MARK" "$CODEX_DOC_FALLBACK_LINE" > "$config"
  fi
  echo "   ✅ Codex reads CLAUDE.md where a project has no AGENTS.md ($config)"
}

# uninstall_codex_doc_fallback <config>
#
# Removes the comment and the key only while they are the file's first two
# lines, as the installer wrote them; a key without them was put there by hand.
uninstall_codex_doc_fallback() {
  local config="$1"
  [ -f "$config" ] || return 0
  if [ "$(head -n 2 "$config")" = "$CODEX_DOC_FALLBACK_MARK"$'\n'"$CODEX_DOC_FALLBACK_LINE" ]; then
    local rest
    rest="$(tail -n +3 "$config")"
    if [ -n "$rest" ]; then printf '%s\n' "$rest" > "$config"; else rm "$config"; fi
    echo "   ✅ Removed project_doc_fallback_filenames from $config"
  fi
}
