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

install_agents_skills() {
  _require_core_skills_dir || return 1
  mkdir -p "$HOME/.agents/skills"
  local skill_dir skill
  for skill_dir in "$_CORE_SKILLS_DIR"/*/; do
    [ -f "$skill_dir/SKILL.md" ] || continue
    skill=$(basename "$skill_dir")
    rm -rf "${HOME:?}/.agents/skills/$skill"
    cp -R "${skill_dir%/}" "$HOME/.agents/skills/$skill"
    echo "   ✅ Installed: ~/.agents/skills/$skill"
  done
}

uninstall_agents_skills() {
  _require_core_skills_dir || return 1
  local skill_dir skill
  for skill_dir in "$_CORE_SKILLS_DIR"/*/; do
    skill=$(basename "$skill_dir")
    if [ -d "$HOME/.agents/skills/$skill" ]; then
      rm -rf "${HOME:?}/.agents/skills/$skill"
      echo "   ✅ Removed: ~/.agents/skills/$skill"
    fi
  done
}
