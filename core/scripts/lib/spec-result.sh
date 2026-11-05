#!/usr/bin/env bash
# JSON outcomes for spec commands, also written to result_file when set.

aide_spec_refuse() {
  local msg="$1" line
  line="$(jq -cn --arg e "$msg" '{ok:false, exitCode:2, terminalReason:"refused", error:$e}')"
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
