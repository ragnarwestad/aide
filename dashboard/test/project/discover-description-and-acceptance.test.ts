// Spec 394: the `Acceptance:` line — the direct mirror of
// discover-description-and-depends.test.ts's own `specDependsOn` suite,
// for the other whole-spec fact that sits above the tabs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  specAcceptanceNotRequired, stripAcceptanceLine, withAcceptanceLine,
} from "../../src/project/discover.ts";

describe("specAcceptanceNotRequired", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-accept-"));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function spec(name: string, body: string): string {
    const d = join(dir, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "1-description.md"), body);
    return d;
  }

  const TRACKING = (line: string) =>
    `# X - Description\n\n## Tracking info\n\n- **Task:** \`09-x/\`\n- **Created:** \`2026-08-19\`\n` +
    `${line}\n\n---\n\n## Description\n\nprose\n`;

  test("the line reads true", () => {
    expect(specAcceptanceNotRequired(spec("01-set", TRACKING("- **Acceptance:** not required")))).toBe(true);
  });

  // REQ-11: a spec carrying no such record behaves exactly as it does
  // today — absence means required, not "not required".
  test("no line, an empty file, or no file at all is false — never a throw", () => {
    expect(specAcceptanceNotRequired(spec("02-none", TRACKING("")))).toBe(false);
    expect(specAcceptanceNotRequired(join(dir, "nowhere"))).toBe(false);
  });

  const DESC = (line = "") =>
    `# X - Description\n\n## Tracking info\n\n- **Task:** \`09-x/\`\n- **Created:** \`2026-08-19\`\n` +
    (line ? `${line}\n` : "") +
    `\n---\n\n## Description\n\nprose\n`;

  describe("stripAcceptanceLine", () => {
    test("takes the line out and leaves everything else where it was", () => {
      expect(stripAcceptanceLine(DESC("- **Acceptance:** not required"))).toBe(DESC());
    });

    test("a text with no line at all comes back as it went in", () => {
      expect(stripAcceptanceLine(DESC())).toBe(DESC());
    });

    test("CRLF is normalised to LF, and the line goes either way", () => {
      expect(stripAcceptanceLine(DESC("- **Acceptance:** not required").replace(/\n/g, "\r\n"))).toBe(DESC());
    });
  });

  describe("withAcceptanceLine", () => {
    test("inserts right after Created when there is no existing line", () => {
      expect(withAcceptanceLine(DESC(), true)).toBe(DESC("- **Acceptance:** not required"));
    });

    test("false removes the line rather than writing one", () => {
      expect(withAcceptanceLine(DESC("- **Acceptance:** not required"), false)).toBe(DESC());
    });

    test("replaces an existing line rather than writing a second one", () => {
      const out = withAcceptanceLine(DESC("- **Acceptance:** not required"), true);
      expect(out).toBe(DESC("- **Acceptance:** not required"));
      expect(out!.match(/Acceptance/g)).toHaveLength(1);
    });

    // Nowhere to put it is a refusal for the caller to make, not a guess.
    test("no Created line to anchor on is a null, not a guess", () => {
      expect(withAcceptanceLine("# X\n\nprose\n", true)).toBeNull();
    });

    test("but removing needs no anchor — false is never a null", () => {
      expect(withAcceptanceLine("# X\n\nprose\n", false)).toBe("# X\n\nprose\n");
    });

    test("what it writes is what specAcceptanceNotRequired reads back", () => {
      const d = spec("03-roundtrip", withAcceptanceLine(DESC(), true)!);
      expect(specAcceptanceNotRequired(d)).toBe(true);
    });
  });
});
