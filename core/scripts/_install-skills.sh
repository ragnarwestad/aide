#!/usr/bin/env bash
# Shared installation/uninstallation of core/skills into ~/.agents/skills.
#
# ~/.agents/skills/ is read by BOTH Copilot CLI (personal skills; it no
# longer reads ~/.claude/skills/ — verified against 1.0.79) and Codex.
# The copilot and codex installers source this file and call
# install_agents_skills. uninstall_agents_skills is called ONLY by
# uninstall-all.sh: individual uninstallers must leave the skills alone,
# since the other tool uses them — same rule as the ~/.local/bin scripts
# in _install-bin.sh.
#
# Claude Code has its own native location (~/.claude/skills/) and is
# handled by its own installer, not here.

_CORE_SKILLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../skills" 2>/dev/null && pwd)"

# Refuse to run without a valid source dir. When this file is sourced from a
# shell without BASH_SOURCE (e.g. zsh), _CORE_SKILLS_DIR resolves to "" and
# the */ glob below would expand to the ROOT directories — which once started
# copying /Applications into ~/.agents/skills. Fail fast instead.
_require_core_skills_dir() {
  if [ -z "$_CORE_SKILLS_DIR" ] || [ ! -d "$_CORE_SKILLS_DIR" ] ||
     [ ! -f "$_CORE_SKILLS_DIR/aide-create/SKILL.md" ]; then
    echo "   ❌ _install-skills.sh: cannot locate core/skills/ (must be sourced from bash)" >&2
    return 1
  fi
}

# The name of the file every install writes on the TARGET machine,
# inside the skills directory it just wrote to. Shared so the three
# installers and the uninstaller cannot spell it differently.
AIDE_SKILL_MANIFEST_NAME=".aide-installed-manifest"

_valid_skill_name() {
  case "$1" in "" | .* | */*) return 1 ;; esac
}

_skill_is_excluded() {
  local name="$1" excluded
  shift
  for excluded in "$@"; do
    [ "$name" = "$excluded" ] && return 0
  done
  return 1
}

install_skills() {
  _require_core_skills_dir || return 1
  local target="$1" manifest skill_dir skill previous temporary
  shift
  mkdir -p "$target"
  manifest="$target/$AIDE_SKILL_MANIFEST_NAME"
  previous="${manifest}.previous"
  [ -f "$manifest" ] && cp "$manifest" "$previous" || : > "$previous"
  : > "$manifest"
  for skill_dir in "$_CORE_SKILLS_DIR"/*/; do
    [ -f "$skill_dir/SKILL.md" ] || continue
    skill="$(basename "$skill_dir")"
    _skill_is_excluded "$skill" "$@" && continue
    temporary="$target/.${skill}.aide-tmp"
    rm -rf "$temporary"
    cp -R "${skill_dir%/}" "$temporary"
    rm -rf "${target:?}/$skill"
    mv "$temporary" "$target/$skill"
    printf '%s\n' "$skill" >> "$manifest"
    echo "   ✅ Installed: $target/$skill"
  done
  while IFS= read -r skill; do
    _valid_skill_name "$skill" || continue
    grep -Fxq "$skill" "$manifest" && continue
    if [ -d "$target/$skill" ]; then
      rm -rf "${target:?}/$skill"
      echo "   🗑️  Removed retired skill: $target/$skill"
    fi
  done < "$previous"
  rm -f "$previous"
}

uninstall_skills() {
  local target="$1" manifest="$1/$AIDE_SKILL_MANIFEST_NAME" skill
  if [ ! -f "$manifest" ]; then
    echo "   No skill manifest found in $target; no skills removed."
    return 0
  fi
  while IFS= read -r skill; do
    _valid_skill_name "$skill" || continue
    if [ -d "$target/$skill" ]; then
      rm -rf "${target:?}/$skill"
      echo "   ✅ Removed: $target/$skill"
    fi
  done < "$manifest"
  rm -f "$manifest"
  echo "   ✅ Removed: $manifest"
}

# Removes an installed skill the moment its source disappears, instead
# of leaving it for a human to notice on another machine, another week.
#
# The installers copy in and never remove, and the only list that says
# what to remove — uninstall.sh's SKILLS array — is a snapshot of what
# is shipped TODAY, edited by the same commit that stops shipping the
# skill. On 2026-08-20 four skills left core/skills/ and their installed
# copies became unremovable by any script in this repo (commit ae42856).
#
# The manifest is the memory that snapshot cannot be: written on the
# target machine, naming exactly what the last install put there, read
# by the NEXT install before it is overwritten. A name in it that the
# source no longer ships is a retired skill, and goes.
#
# Args: <source core/skills dir> <target skills dir> <manifest path>.
prune_retired_skills() {
  local source_dir="$1" target_dir="$2" manifest="$3" skill
  if [ -f "$manifest" ]; then
    while IFS= read -r skill; do
      # This is an `rm -rf` driven by a file: a blank line would resolve
      # to the skills directory itself, and a name with a slash or a dot
      # in it would walk out of it. A skill name is a directory name and
      # nothing else.
      case "$skill" in
        "" | .* | */*) continue ;;
      esac
      # Still shipped: the install just (re)wrote it, and it stays.
      if [ -f "$source_dir/$skill/SKILL.md" ]; then continue; fi
      if [ -d "$target_dir/$skill" ]; then
        rm -rf "${target_dir:?}/$skill"
        echo "   🗑️  Removed retired skill: $target_dir/$skill"
      fi
    done < "$manifest"
  fi
  _write_skill_manifest "$source_dir" "$manifest"
}

# What this install shipped, one name per line, for the next one to diff
# against. The same "a directory with a SKILL.md in it" test the install
# loop uses — a name the install never copied must never reach the
# manifest, or the load after would prune a skill that was only ever a
# references/ folder.
_write_skill_manifest() {
  local source_dir="$1" manifest="$2" skill_dir
  : > "$manifest"
  for skill_dir in "$source_dir"/*/; do
    if [ -f "$skill_dir/SKILL.md" ]; then
      basename "$skill_dir" >> "$manifest"
    fi
  done
}

install_agents_skills() {
  install_skills "$HOME/.agents/skills"
}

uninstall_agents_skills() {
  _require_core_skills_dir || return 1
  uninstall_skills "$HOME/.agents/skills"
}
