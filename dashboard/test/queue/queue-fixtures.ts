// The queue defaults, project resolver and request the queue's request,
// model and store tests share.

import type { QueueDefaults } from "../../src/queue/queue.ts";

export const DEFAULTS: QueueDefaults = {
  // Per step: an implement is not an analyze, and one number for both
  // stopped an implement mid-sentence with its tests green.
  timeoutSec: { default: 1200, implement: 5400 },
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  model: { implement: "opus", default: "sonnet" },
};

// The server resolves a project NAME to its real spec folders; the
// request never carries a path. Two allowlisted projects here.
export const resolve = (project: string) =>
  project === "aide"
    ? { specFolders: ["81-queue-and-runner"] }
    : project === "aide-dashboard"
      ? { specFolders: ["01-first"] }
      : null;

export const REQ = { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] };

/** Defaults with a Codex model and three providers, two of them Claude Code. */
export const PROVIDER_DEFAULTS: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "Opus" },
  modelChoices: { Opus: {}, "gpt-6": { tool: "codex" } },
  providers: {
    Claude: { name: "Claude", tool: "claude" },
    "Claude-Capra": { name: "Claude-Capra", tool: "claude", configDir: "~/.claude-capra" },
    Codex: { name: "Codex", tool: "codex" },
  },
};
