#!/usr/bin/env bash
# What the tool installers need and do not install themselves: mise, with a
# node, for the tools they declare through it (install_mise_declared_tools
# in _install-bin.sh), and Claude Code. Each is installed only when it is
# missing. Sourced by install-all.sh, which calls install_prerequisites
# before the tool installers; signing in to Claude Code is left to the user.

install_prerequisites() {
  local status=0
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac

  if ! command -v mise &> /dev/null; then
    echo "Installing mise (https://mise.jdx.dev)..."
    if curl -fsSL https://mise.run | sh; then
      # An interactive zsh reaches the tools mise installs through this line.
      # shellcheck disable=SC2016 # written for zsh to expand, not us
      grep -qs 'mise activate zsh' "$HOME/.zshrc" ||
        echo 'eval "$($HOME/.local/bin/mise activate zsh)"' >> "$HOME/.zshrc"
    else
      echo "⚠️  mise could not be installed"
      status=1
    fi
  fi
  if command -v mise &> /dev/null && ! mise which node &> /dev/null; then
    echo "Installing node through mise..."
    mise use -g node@lts || status=1
  fi
  if ! command -v claude &> /dev/null; then
    echo "Installing Claude Code (https://claude.ai/install.sh)..."
    curl -fsSL https://claude.ai/install.sh | bash || status=1
  fi
  return "$status"
}
