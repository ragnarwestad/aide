#!/usr/bin/env bash

_CORE_RULES_DIR="${_CORE_RULES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../rules" && pwd)}"
AIDE_RULE_MANIFEST_NAME=".aide-installed-manifest"

_valid_rule_name() {
  case "$1" in
    "" | .* | */*) return 1 ;;
    *.md) return 0 ;;
    *) return 1 ;;
  esac
}

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

install_rules() {
  local target="$1" manifest previous rule filename
  mkdir -p "$target"
  manifest="$target/$AIDE_RULE_MANIFEST_NAME"
  previous="${manifest}.previous"
  [ -f "$manifest" ] && cp "$manifest" "$previous" || : > "$previous"
  : > "$manifest"
  for rule in $(rule_names); do
    filename="$rule.md"
    cp "$_CORE_RULES_DIR/$filename" "$target/$filename"
    printf '%s\n' "$filename" >> "$manifest"
  done
  while IFS= read -r filename; do
    _valid_rule_name "$filename" || continue
    grep -Fxq "$filename" "$manifest" && continue
    if [ -f "$target/$filename" ]; then
      rm "$target/$filename"
      echo "   🗑️  Removed retired rule: $target/$filename"
    fi
  done < "$previous"
  rm -f "$previous"
}

uninstall_rules() {
  local target="$1" manifest="$1/$AIDE_RULE_MANIFEST_NAME" filename rule
  if [ ! -f "$manifest" ]; then
    for rule in $(rule_names); do
      filename="$rule.md"
      if [ -f "$target/$filename" ]; then
        rm "$target/$filename"
        echo "   ✅ Removed: $target/$filename"
      fi
    done
    return 0
  fi
  while IFS= read -r filename; do
    _valid_rule_name "$filename" || continue
    if [ -f "$target/$filename" ]; then
      rm "$target/$filename"
      echo "   ✅ Removed: $target/$filename"
    fi
  done < "$manifest"
  rm -f "$manifest"
  echo "   ✅ Removed: $manifest"
}
