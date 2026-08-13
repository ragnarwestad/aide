#!/usr/bin/env bash

# install.sh - Installs aide-claude-code

set -e

echo "🔧 aide-claude-code Install"
echo "===================================="
echo ""

# Find where this script is running from (the dist package root)
DIST_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check that AIDE_PROJECTS_PATH is set
if [ -z "$AIDE_PROJECTS_PATH" ]; then
  echo "❌ Error: AIDE_PROJECTS_PATH is not set"
  echo ""
  echo "Set these in ~/.zshrc or ~/.bashrc:"
  echo "  export AIDE_PROJECTS_PATH=\"\$HOME/develop\""
  echo "  export AIDE_INSTALLATION_PATH=\"$DIST_DIR\""
  echo ""
  echo "(AIDE_INSTALLATION_PATH should point here: $DIST_DIR)"
  echo ""
  echo "Then:"
  echo "  source ~/.zshrc"
  echo "  ./install.sh"
  exit 1
fi

echo "✅ AIDE_PROJECTS_PATH: $AIDE_PROJECTS_PATH"

# Verify that the directory exists
if [ ! -d "$AIDE_PROJECTS_PATH" ]; then
  echo "❌ Directory does not exist: $AIDE_PROJECTS_PATH"
  exit 1
fi

# Check that AIDE_INSTALLATION_PATH is set
if [ -z "$AIDE_INSTALLATION_PATH" ]; then
  echo "❌ Error: AIDE_INSTALLATION_PATH is not set"
  echo ""
  echo "Set this in ~/.zshrc or ~/.bashrc:"
  echo "  export AIDE_INSTALLATION_PATH=\"$DIST_DIR\""
  echo ""
  echo "Then:"
  echo "  source ~/.zshrc"
  echo "  ./install.sh"
  exit 1
fi

echo "✅ AIDE_INSTALLATION_PATH: $AIDE_INSTALLATION_PATH"

# Verify that the installation directory exists and has templates
if [ ! -d "$AIDE_INSTALLATION_PATH/core/templates" ]; then
  echo "❌ Error: Templates not found in: $AIDE_INSTALLATION_PATH/core/templates"
  echo ""
  echo "Is AIDE_INSTALLATION_PATH set correctly?"
  exit 1
fi

echo "📂 Installing from: $DIST_DIR"
echo ""

# 1. Install scripts to ~/.local/bin/
echo "1️⃣  Installing scripts to ~/.local/bin/..."
mkdir -p ~/.local/bin

for script in aide-generate-pdf aide-generate-html aide-create; do
  if [ -f "$DIST_DIR/bin/$script" ]; then
    cp "$DIST_DIR/bin/$script" ~/.local/bin/
    chmod +x ~/.local/bin/$script
    echo "   ✅ $script"
  fi
done

echo ""

# 2. Copy configuration to projects
echo "2️⃣  Copying configuration to projects..."

# Generate settings.json with absolute paths
generate_settings() {
  local SPECS_PERMISSION=""
  if [ -n "$AIDE_SPECS_PATH" ]; then
    SPECS_PERMISSION="      \"Read($AIDE_SPECS_PATH/**)\",
      \"Write($AIDE_SPECS_PATH/**)\",
      \"Edit($AIDE_SPECS_PATH/**)\","
  fi

  cat <<EOF
{
  "permissions": {
    "defaultMode": "default",
    "allow": [
      "mcp__ide__getDiagnostics",
      "WebFetch(domain:raw.githubusercontent.com)",
      "Read($AIDE_PROJECTS_PATH/**)",
      "Write($AIDE_PROJECTS_PATH/**)",
      "Edit($AIDE_PROJECTS_PATH/**)"${SPECS_PERMISSION:+,
$SPECS_PERMISSION}
    ],
    "deny": [
      "Bash(git commit:*)",
      "Bash(git push:*)"
    ]
  }
}
EOF
}

for project in my-app my-api aide my-docs; do
  PROJECT_DIR="$AIDE_PROJECTS_PATH/$project"

  if [ ! -d "$PROJECT_DIR" ]; then
    echo "   ⏭️  $project: does not exist"
    continue
  fi

  # Remove old symlinks
  [ -L "$PROJECT_DIR/.claude" ] && rm "$PROJECT_DIR/.claude"
  [ -L "$PROJECT_DIR/CLAUDE.md" ] && rm "$PROJECT_DIR/CLAUDE.md"

  # Remove old .claude directory
  [ -d "$PROJECT_DIR/.claude" ] && rm -rf "$PROJECT_DIR/.claude"

  # Create .claude/
  mkdir -p "$PROJECT_DIR/.claude"

  # Copy commands
  if [ -d "$DIST_DIR/.claude/commands" ]; then
    cp -r "$DIST_DIR/.claude/commands" "$PROJECT_DIR/.claude/"
  fi

  # Copy skills (native Claude Code skills)
  if [ -d "$DIST_DIR/.claude/skills" ]; then
    cp -r "$DIST_DIR/.claude/skills" "$PROJECT_DIR/.claude/"
  fi

  # Copy agents
  if [ -d "$DIST_DIR/agents" ]; then
    cp -r "$DIST_DIR/agents" "$PROJECT_DIR/.claude/"
  fi

  # Generate settings.json
  generate_settings > "$PROJECT_DIR/.claude/settings.json"

  # Copy CLAUDE.md to .claude/ (not the root)
  cp "$DIST_DIR/CLAUDE.md" "$PROJECT_DIR/.claude/CLAUDE.md"

  # Remove old root CLAUDE.md if it exists
  if [ -f "$PROJECT_DIR/CLAUDE.md" ] && [ ! -L "$PROJECT_DIR/CLAUDE.md" ]; then
    rm "$PROJECT_DIR/CLAUDE.md"
  fi

  echo "   ✅ $project"
done

echo ""

# 3. Verify PATH
echo "3️⃣  Verifying PATH..."
if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
  echo "   ✅ ~/.local/bin is in PATH"
else
  echo "   ⚠️  ~/.local/bin is NOT in PATH"
  echo "   Add to ~/.zshrc:"
  echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Start Claude Code:"
echo "      cd $AIDE_PROJECTS_PATH/my-app && claude"
echo ""
echo "   2. Test:"
echo "      /aide-create PROJ-7637"
echo ""
