#!/usr/bin/env bash
# The specs root and the spec folder a spec command works on, for
# aide-archive-spec and aide-close-spec. Needs _aide-spec-lib.sh,
# lib/spec-reference.sh and lib/spec-result.sh sourced first; a refusal
# goes through aide_spec_refuse and exits.

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

# Sets $spec_folder: what aide_resolve_spec names when that folder exists,
# else the folder under archive/ by full name or by `<arg>-*`. A spelled-out
# `NN-slug` that only exists under archive/ comes back from aide_resolve_spec
# as a guess that does not exist, which is why archive/ is looked up here.
# Refuses, listing the active folders, when neither finds one.
aide_spec_command_folder() {   # <specs-root> <spec-arg>
  local root="$1" arg="$2" active
  spec_folder=""
  if declare -f aide_resolve_spec >/dev/null 2>&1; then
    spec_folder="$(aide_resolve_spec "$arg" "$root")"
  fi
  if [ -n "$spec_folder" ] && [ ! -d "$root/$spec_folder" ]; then
    spec_folder=""
  fi
  if [ -z "$spec_folder" ] && aide_find_spec_folder "$root" "$arg" archive; then
    spec_folder="archive/$found_folder"
  fi
  [ -z "$spec_folder" ] || return 0
  active="$(find "$root" -maxdepth 1 -mindepth 1 -type d ! -name archive \
    -exec basename {} \; 2>/dev/null | sort | paste -sd', ' -)"
  aide_spec_refuse "unknown spec: $arg (not under $root)${active:+ — active folders: $active}"
}
