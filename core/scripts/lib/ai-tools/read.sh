#!/usr/bin/env bash

AI_TOOLS_FILE="${AI_TOOLS_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tools.txt}"

_ai_tools_require_file() {
  if [ ! -f "$AI_TOOLS_FILE" ]; then
    echo "AI tools list not found: $AI_TOOLS_FILE" >&2
    return 1
  fi
}

_ai_tool_trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

ai_tool_ids() {
  _ai_tools_require_file || return 1
  local line id
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in "" | \#* | [[:space:]]\#*) continue ;; esac
    IFS='|' read -r id _rest <<EOF
$line
EOF
    _ai_tool_trim "$id"
    printf '\n'
  done < "$AI_TOOLS_FILE"
}

ai_tool_field() {
  _ai_tools_require_file || return 1
  local wanted="$1" field="$2" line id implementation cli name row upgrade install value
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in "" | \#* | [[:space:]]\#*) continue ;; esac
    IFS='|' read -r id implementation cli name row upgrade install <<EOF
$line
EOF
    id="$(_ai_tool_trim "$id")"
    [ "$id" = "$wanted" ] || continue
    case "$field" in
      id) value="$id" ;;
      implementation) value="$implementation" ;;
      cli) value="$cli" ;;
      name) value="$name" ;;
      row) value="$row" ;;
      upgrade) value="$upgrade" ;;
      install) value="$install" ;;
      *) echo "Unknown AI tool field: $field" >&2; return 1 ;;
    esac
    _ai_tool_trim "$value"
    printf '\n'
    return 0
  done < "$AI_TOOLS_FILE"
  echo "Unknown AI tool: $wanted" >&2
  return 1
}
