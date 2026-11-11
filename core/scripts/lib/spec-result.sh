#!/usr/bin/env bash
# JSON outcomes for spec commands, also written to result_file when set.

aide_json_escape() {
  local value="$1" escaped="" char code encoded i=0
  while [ "$i" -lt "${#value}" ]; do
    char="${value:$i:1}"
    case "$char" in
      '"') escaped="${escaped}\\\"" ;;
      '\') escaped="${escaped}\\\\" ;;
      $'\b') escaped="${escaped}\\b" ;;
      $'\f') escaped="${escaped}\\f" ;;
      $'\n') escaped="${escaped}\\n" ;;
      $'\r') escaped="${escaped}\\r" ;;
      $'\t') escaped="${escaped}\\t" ;;
      *)
        printf -v code '%d' "'$char"
        if [ "$code" -lt 32 ]; then
          printf -v encoded '\\u%04x' "$code"
          escaped="${escaped}${encoded}"
        else
          escaped="${escaped}${char}"
        fi
        ;;
    esac
    i=$((i + 1))
  done
  printf '%s' "$escaped"
}

aide_spec_refusal_json() {
  printf '{"ok":false,"exitCode":2,"terminalReason":"refused","error":"%s"}\n' \
    "$(aide_json_escape "$1")"
}

aide_spec_refuse() {
  local line
  line="$(aide_spec_refusal_json "$1")"
  printf '%s\n' "$line"
  [ -n "$result_file" ] && printf '%s\n' "$line" > "$result_file" 2>/dev/null
  exit 2
}

aide_spec_emit_ok() {
  local extra="$1" line
  line="$(jq -cn --argjson extra "$extra" '{ok:true, exitCode:0} + $extra')"
  printf '%s\n' "$line"
  [ -n "$result_file" ] && printf '%s\n' "$line" > "$result_file" 2>/dev/null
  exit 0
}
