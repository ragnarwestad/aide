// Spec 302, REQ-2: `specPageView` reads a spec's checks section from one
// `parseStatus` call, not from `parseStatus` and `parseStatusChecks`
// separately over the same text. A pure function's OUTPUT cannot tell
// "parsed once" from "parsed twice", so the property is proven
// structurally — the same "read two things as text and assert they agree"
// technique this codebase already uses for `WORKFLOW_STEPS`,
// `DEPENDENCY_GATED_STEPS` and `errorReason` (`dashboard/CLAUDE.md`).

import { describe, expect, test } from "bun:test";
import { sourceWithParts } from "../helpers/source-with-parts.ts";

// The file and the parts beside it (`spec-views/`), since it was split
// 2026-09-04: the claim is about the whole of what spec-views is, and a
// function moving into a part must not quietly stop being checked.
const SOURCE = sourceWithParts("serve/spec-views");

describe("spec-views reads a spec's checks through one call", () => {
  test("parseStatusChecks is never named in the file's own source", () => {
    expect(SOURCE).not.toContain("parseStatusChecks");
  });
});
