// Spec 302, REQ-2: `specPageView` reads a spec's checks section from one
// `parseStatus` call, not from `parseStatus` and `parseStatusChecks`
// separately over the same text. A pure function's OUTPUT cannot tell
// "parsed once" from "parsed twice", so the property is proven
// structurally — the same "read two things as text and assert they agree"
// technique this codebase already uses for `WORKFLOW_STEPS`,
// `DEPENDENCY_GATED_STEPS` and `errorReason` (`dashboard/CLAUDE.md`).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(
  join(import.meta.dir, "../../src/serve/spec-views.ts"),
  "utf-8",
);

describe("spec-views.ts reads a spec's checks through one call", () => {
  test("parseStatusChecks is never named in the file's own source", () => {
    expect(SOURCE).not.toContain("parseStatusChecks");
  });
});
