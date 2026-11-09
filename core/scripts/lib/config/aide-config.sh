#!/usr/bin/env bash

aide_config_write() {
  local key="$1" value="$2" root="${3:-.}" file tmp
  file="$root/.aide/config"
  mkdir -p "$root/.aide"
  tmp="$file.$$.tmp"
  if [ -f "$file" ]; then
    sed "/^${key}=/d" "$file" > "$tmp"
  else
    : > "$tmp"
  fi
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$file"
}
