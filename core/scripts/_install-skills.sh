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

_CORE_SKILLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../skills" && pwd)"

install_agents_skills() {
  mkdir -p "$HOME/.agents/skills"
  local skill_dir skill
  for skill_dir in "$_CORE_SKILLS_DIR"/*/; do
    skill=$(basename "$skill_dir")
    rm -rf "${HOME:?}/.agents/skills/$skill"
    cp -R "${skill_dir%/}" "$HOME/.agents/skills/$skill"
    echo "   ✅ Installed: ~/.agents/skills/$skill"
  done
}

uninstall_agents_skills() {
  local skill_dir skill
  for skill_dir in "$_CORE_SKILLS_DIR"/*/; do
    skill=$(basename "$skill_dir")
    if [ -d "$HOME/.agents/skills/$skill" ]; then
      rm -rf "${HOME:?}/.agents/skills/$skill"
      echo "   ✅ Removed: ~/.agents/skills/$skill"
    fi
  done
}
