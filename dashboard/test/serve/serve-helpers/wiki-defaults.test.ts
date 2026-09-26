import { describe, expect, test } from "bun:test";
import { QUEUE_DEFAULTS } from "../../../src/serve/serve-helpers/config.ts";
import { mergeQueueDefaults } from "../../../src/queue/queue.ts";

describe("the wiki step's built-in settings", () => {
  test("its timeout is 2400 seconds, the ceiling analyze has (AC-1)", () => {
    expect(QUEUE_DEFAULTS.timeoutSec.wiki).toBe(2400);
  });

  // The first build on the board stopped at every aide-wiki call: the host's
  // queue-config.json names every step but this one, and the cautious default
  // waited for an approval nobody was there to give.
  test("it may run Aide's own scripts, even when the host's config does not name it", () => {
    expect(QUEUE_DEFAULTS.permissionMode.wiki).toBe("bypassPermissions");
    const host = mergeQueueDefaults(QUEUE_DEFAULTS, {
      permissionMode: { implement: "bypassPermissions", analyze: "bypassPermissions", default: "acceptEdits" },
    });
    expect(host.permissionMode.wiki).toBe("bypassPermissions");
  });
});
