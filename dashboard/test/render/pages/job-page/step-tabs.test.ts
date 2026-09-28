// An opened step's tab is `?steptab=` in the address: one of Log, Changed
// files and Errors, and Log for anything else.

import { describe, expect, test } from "bun:test";
import { resolveStepTab } from "../../../../src/render/pages/job-page/step-tabs.ts";

describe("resolveStepTab", () => {
  test("a named tab is kept, and no address or an unknown one is Log", () => {
    expect(resolveStepTab("files")).toBe("files");
    expect(resolveStepTab("errors")).toBe("errors");
    for (const steptab of [undefined, "", "everything", "commands", "nonsense"]) {
      expect(resolveStepTab(steptab)).toBe("log");
    }
  });
});
