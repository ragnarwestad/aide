---
name: ai-tools-upgrade
description: >-
  How the Copilot and Codex CLIs are kept up to date on a machine, and how
  to install the daily upgrade job — plain cron on an always-on machine,
  a launchd agent on a laptop (cron silently skips runs the machine sleeps
  through). Use when: setting aide up on a new machine, the AI tools have
  gone stale, choosing between cron and launchd, editing
  core/scripts/upgrade-ai-tools. Do NOT use for: updating Claude Code
  itself (it auto-updates), checking for news (use check-news).
---

# Updating the AI tools

The CLI tools are kept up to date automatically:

- **Claude Code** updates itself (auto-update on by default).
- **Copilot and Codex** are managed by [mise](https://mise.jdx.dev/), pinned to
  `latest` in `~/.config/mise/config.toml`.

`core/scripts/upgrade-ai-tools` runs `mise upgrade` on the tools +
`claude update`. It is installed to `~/.local/bin/` by each AI installer (via
`core/scripts/_install-bin.sh`).

The script runs daily at 08:00 — set it up once per machine, and pick the
mechanism by whether the machine sleeps:

**Always-on machine (desktop, server):** plain cron.

```bash
crontab -e
# Add:
0 8 * * * ~/.local/bin/upgrade-ai-tools
```

**Laptop:** a launchd agent instead. cron silently skips any run the machine
sleeps through and never catches up, so a lid shut past 08:00 means no upgrade
that day. launchd runs a missed `StartCalendarInterval` job on the next wake.
Save as `~/Library/LaunchAgents/com.<user>.upgrade-ai-tools.plist`, then
`launchctl bootstrap gui/$(id -u) <path>`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.USER.upgrade-ai-tools</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/USER/.local/bin/upgrade-ai-tools</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>8</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/USER/Library/Logs/upgrade-ai-tools.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/USER/Library/Logs/upgrade-ai-tools.log</string>
</dict>
</plist>
```

Do not run both — remove the cron line when installing the launchd agent.

The matrix (`docs/AI_SUPPORT_MATRIX.md`) reflects the *last verified* versions and
is updated manually via `/check-news` — not by the cron job.
