#!/usr/bin/env bash
# The specs root and the spec folder a spec command works on. Needs
# _aide-spec-lib.sh sourced first; aide_spec_command_root and
# aide_spec_command_folder (aide-archive-spec, aide-close-spec) also need
# lib/spec-reference.sh and lib/spec-result.sh, and a refusal goes through
# aide_spec_refuse and exits.

# Sets $specs_root. `--specs-dir`, when the caller names one that exists,
# IS the specs root, not one more place to look: a headless run passes its
# own worktree there, already rebased onto the base branch, which holds the
# step's commits and the person's ticks. The configured root (AIDE_SPECS_PATH
# in <project>/.aide/config, else <project>/specs) is the shared checkout
# every other command reads for display, and may be behind it.
aide_spec_command_root() {   # <project-dir> <specs-dir or empty>
  if [ -n "$2" ] && [ -d "$2" ]; then
    specs_root="$2"
  elif declare -f aide_specs_root >/dev/null 2>&1; then
    specs_root="$(aide_specs_root "$1")"
  else
    specs_root="$1/specs"
  fi
  [ -d "$specs_root" ] || aide_spec_refuse "no specs root at $specs_root"
}

# Prints where the existing spec <arg> is under <root>: `<folder>` or
# `archive/<folder>`, active before archived, by what aide_resolve_spec
# accepts (an existing path, a number, an issue key) or by the full name
# under archive/. aide_resolve_spec gives a spelled-out `NN-slug` back
# unchecked, which is why the folder must exist and archive/ is looked up
# here. Fails, printing nothing, when no folder exists. The lookup
# aide-archive-spec, aide-close-spec, aide-reopen-spec and aide-reset-spec
# share; each keeps its own refusal.
aide_existing_spec() {   # <specs-root> <spec-arg>
  local root="$1" arg="$2" location
  [ -n "$arg" ] || return 1
  location="$(aide_resolve_spec "$arg" "$root")"
  if [ -n "$location" ] && [ -d "$root/$location" ]; then
    printf '%s\n' "$location"
    return 0
  fi
  [ -d "$root/archive/$arg" ] || return 1
  printf 'archive/%s\n' "$arg"
}

# Sets $spec_folder: what aide_existing_spec finds, else the first
# `<arg>-*` under archive/. Refuses, listing the active folders, when
# neither finds one.
aide_spec_command_folder() {   # <specs-root> <spec-arg>
  local root="$1" arg="$2" active
  spec_folder="$(aide_existing_spec "$root" "$arg")"
  if [ -z "$spec_folder" ] && aide_find_spec_folder "$root" "$arg" archive; then
    spec_folder="archive/$found_folder"
  fi
  [ -z "$spec_folder" ] || return 0
  active="$(find "$root" -maxdepth 1 -mindepth 1 -type d ! -name archive \
    -exec basename {} \; 2>/dev/null | sort | paste -sd', ' -)"
  aide_spec_refuse "unknown spec: $arg (not under $root)${active:+ — active folders: $active}"
}
