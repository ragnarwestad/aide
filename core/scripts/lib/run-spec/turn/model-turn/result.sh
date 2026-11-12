#!/usr/bin/env bash
# run-spec/turn/model-turn/result.sh — the complete result of one model turn.

# shell variable, JSON field, representation, optional when empty
turn_result_schema() {
  cat <<'EOF'
session_out sessionId string no
subtype subtype string no
cost cost number no
cost_measured costMeasured boolean no
cost_known costKnown boolean no
terminal_reason outcome string no
error_msg error string no
error_solution errorSolution string no
error_log errorLog string no
provider_limit_out providerLimit json yes
at_capacity_out atCapacity string yes
provider_error_out providerError json yes
time_limit_json timeLimit json yes
tokens_json tokens json yes
model_id_out modelId string yes
exit_code exitCode number no
duration durationSec number no
turn_message message string no
turn_from transcriptFrom number no
turn_to transcriptTo number no
EOF
}

# Capture every result field through the schema above. Adding a field changes
# this one contract; callers neither save nor restore individual variables.
turn_result_capture() {  # <output-variable>
  local output_name="$1" captured='{}' shell_name json_name representation optional value encoded
  while read -r shell_name json_name representation optional; do
    value="${!shell_name-}"
    [ "$optional" != "yes" ] || [ -n "$value" ] || continue
    case "$representation" in
      json) captured="$(jq -c --arg key "$json_name" --argjson value "$value" '. + {($key):$value}' <<<"$captured")" ;;
      number) captured="$(jq -c --arg key "$json_name" --arg value "${value:-0}" '. + {($key):($value | tonumber)}' <<<"$captured")" ;;
      boolean) captured="$(jq -c --arg key "$json_name" --argjson value "${value:-false}" '. + {($key):$value}' <<<"$captured")" ;;
      *) captured="$(jq -c --arg key "$json_name" --arg value "$value" '. + {($key):$value}' <<<"$captured")" ;;
    esac
  done < <(turn_result_schema)
  printf -v encoded '%q' "$captured"
  eval "$output_name=$encoded"
}

# Make one deliberately selected result the compatibility view consumed by
# the existing publisher and aggregation code.
turn_result_apply() {  # <result-json>
  local result="$1" shell_name json_name representation optional value
  while read -r shell_name json_name representation optional; do
    if jq -e --arg key "$json_name" 'has($key)' <<<"$result" >/dev/null 2>&1; then
      case "$representation" in
        json) value="$(jq -c --arg key "$json_name" '.[$key]' <<<"$result")" ;;
        *) value="$(jq -r --arg key "$json_name" '.[$key]' <<<"$result")" ;;
      esac
    else
      value=""
    fi
    printf -v "$shell_name" '%s' "$value"
  done < <(turn_result_schema)
}

turn_result_field() {  # <result-json> <field>
  jq -r --arg field "$2" '.[$field] // empty' <<<"$1"
}
