#!/usr/bin/env bash
# Shared installation/uninstallation of core/skills into ~/.agents/skills.
#
# ~/.agents/skills/ is read by BOTH Copilot CLI (personal skills; it no
# longer reads ~/.claude/skills/ — verified against 1.0.79) and Codex.
# The Claude, Copilot and Codex installers call install_skills. Individual
# uninstallers leave ~/.agents/skills alone because another tool may use them;
# uninstall-all.sh removes them through uninstall_agents_skills.
#
# Claude Code has its own native location (~/.claude/skills/) and is
# handled by its own installer, not here.
#
# A spec step's instructions (create, analyze, implement, archive, close,
# reopen) are not skills: they sit in core/scripts/lib/steps/ and are
# installed beside the runner with the rest of lib/. An install removes the
# copies an earlier install wrote here, through the manifest below.

_CORE_SKILLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../skills" 2>/dev/null && pwd)"

# Refuse to run without a valid source dir. When this file is sourced from a
# shell without BASH_SOURCE (e.g. zsh), _CORE_SKILLS_DIR resolves to "" and
# the */ glob below would expand to the ROOT directories — which once started
# copying /Applications into ~/.agents/skills. Fail fast instead.
_require_core_skills_dir() {
  if [ -z "$_CORE_SKILLS_DIR" ] || [ ! -d "$_CORE_SKILLS_DIR" ] ||
     ! compgen -G "$_CORE_SKILLS_DIR/*/SKILL.md" >/dev/null; then
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

install_agents_skills() {
  install_skills "$HOME/.agents/skills"
}

uninstall_agents_skills() {
  _require_core_skills_dir || return 1
  uninstall_skills "$HOME/.agents/skills"
}
