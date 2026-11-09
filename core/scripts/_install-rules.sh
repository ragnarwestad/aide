#!/usr/bin/env bash

_CORE_RULES_DIR="${_CORE_RULES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../rules" && pwd)}"

rule_names() {
  local scope="${1:-all}" file first
  for file in "$_CORE_RULES_DIR"/*.md; do
    [ -f "$file" ] || continue
    if [ "$scope" = "every-turn" ]; then
      first="$(head -n 1 "$file")"
      if [ "$first" = "---" ] && sed -n '2,/^---$/p' "$file" | grep -q '^paths:'; then
        continue
      fi
    fi
    basename "$file" .md
  done
}
