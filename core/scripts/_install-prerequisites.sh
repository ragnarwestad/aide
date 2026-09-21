#!/usr/bin/env bash
# What the tool installers need and do not install themselves: mise, with a
# node, for the tools they declare through it (install_mise_declared_tools
# in _install-bin.sh), and the CLI of an AI tool. Nothing here is installed
# for you — each missing piece is reported with the command that installs
# it, and installing it is yours to run. Sourced by install-all.sh, which
# calls check_prerequisites before the tool installers.
#
# The file keeps its `_install-` name because that prefix is what keeps it
# out of ~/.local/bin (_core_bin_scripts in _install-bin.sh copies every
# other file in this directory).

check_prerequisites() {
  local status=0
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac

  if ! command -v mise &> /dev/null; then
    echo "⚠️  mise is not installed (https://mise.jdx.dev). Install it, open a new terminal, and run this again:"
    echo "      curl https://mise.run | sh"
    echo "   mise's own installer prints the line to add to your shell's startup file."
    status=1
  elif ! mise which node &> /dev/null; then
    echo "⚠️  mise has no node installed. Install one and run this again:"
    echo "      mise use -g node@lts"
    status=1
  else
    echo "✅ mise and node are in place"
  fi

  # Not part of the status: aide installs its skills for all four AI CLIs
  # whether or not the CLI itself is there, and which one you use is your
  # choice. Each tool's own installer reports it too, through aide-preflight.
  if ! command -v claude &> /dev/null; then
    echo "ℹ️  Claude Code is not on PATH. Install it with:"
    echo "      curl -fsSL https://claude.ai/install.sh | bash"
  fi

  return "$status"
}
