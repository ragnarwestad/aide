// Split out of discover.test.ts by theme.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverProjects, specDependsOn, specDescription, stripDependsOnLine, withDependsOnLine,
} from "../../src/project/discover.ts";
import { useDiscoverRoot } from "./discover-fixtures.ts";

const fx = useDiscoverRoot();

// Criterion 1 (spec 02): what a job IS. The title alone says "83-multi-
// project-jobs"; the description says what that spec is about, and
// today a reader has to leave the dashboard to read it.
describe("specDescription", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-desc-"));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function spec(name: string, body: string): string {
    const d = join(dir, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "1-description.md"), body);
    return d;
  }

  test("returns the prose under ## Description, up to the next heading", () => {
    const d = spec(
      "01-plain",
      "# A thing - Description\n\n## Table of contents\n\n- [Description](#description)\n\n---\n\n" +
        "## Description\n\nThe queue shows a job's state.\n\nIt shows nothing about what the job IS.\n\n" +
        "---\n\n## Related documents\n\n- [2-analysis.md](./2-analysis.md)\n",
    );
    const got = specDescription(d)!;
    expect(got).toContain("The queue shows a job's state.");
    expect(got).toContain("It shows nothing about what the job IS.");
    expect(got).not.toContain("Related documents");
    expect(got).not.toContain("Table of contents");
  });

  test("the template's own editing note is not part of the description", () => {
    const d = spec(
      "02-note",
      "# X - Description\n\n## Description\n\nReal prose here.\n\n" +
        "_(This field can be edited manually to add extra context or clarifications " +
        "and will not be overwritten by aide commands)_\n\n---\n",
    );
    const got = specDescription(d)!;
    expect(got).toContain("Real prose here.");
    expect(got).not.toContain("edited manually");
  });

  test("a description section with nothing in it is null, not an empty string", () => {
    const d = spec("03-empty", "# X - Description\n\n## Description\n\n---\n\n## Related documents\n");
    expect(specDescription(d)).toBeNull();
  });

  test("no Description heading, or no file at all, is null rather than a throw", () => {
    expect(specDescription(spec("04-noheading", "# X - Description\n\nloose prose\n"))).toBeNull();
    expect(specDescription(join(dir, "nowhere"))).toBeNull();
  });

  test("discoverProjects carries the description alongside the title", () => {
    const a = discoverProjects(fx.root).find((p) => p.name === "proj-a")!;
    const first = a.specs.find((s) => s.folder === "01-first-thing")!;
    expect(first.description).toBe("It does the first thing, thoroughly.");
  });
});

// Spec 110: the `Depends on:` line (spec 92) has had a reader on the
// shell side since the day it existed. The page reads it too now — the
// row says what the spec builds on, in the same words the run's own
// refusal uses.
describe("specDependsOn", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-deps-"));
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

  test("every identifier on the line, in the order written, backticks stripped", () => {
    const d = spec("01-two", TRACKING("- **Depends on:** `105`, `92-a-spec-can-depend`"));
    expect(specDependsOn(d)).toEqual(["105", "92-a-spec-can-depend"]);
  });

  test("a single dependency is a one-item list", () => {
    expect(specDependsOn(spec("02-one", TRACKING("- **Depends on:** `105`")))).toEqual(["105"]);
  });

  test("no line, an empty one, or no file at all is an empty list — never a throw", () => {
    expect(specDependsOn(spec("03-none", TRACKING("")))).toEqual([]);
    expect(specDependsOn(spec("04-empty", TRACKING("- **Depends on:**")))).toEqual([]);
    expect(specDependsOn(join(dir, "nowhere"))).toEqual([]);
  });

  test("discoverProjects carries it alongside the title and the description", () => {
    const a = discoverProjects(fx.root).find((p) => p.name === "proj-a")!;
    expect(a.specs.find((s) => s.folder === "01-first-thing")!.dependsOn).toEqual([]);
  });

  // Spec 166: the same line gets a WRITER, so a dependency can be named
  // after the spec exists. Pure string surgery, in the module that
  // already owns the line's shape — the Edit page's Save is what calls
  // it, and the runtime gate reads the result unchanged.
  //
  // Its own fixture rather than `TRACKING`: that one leaves a blank
  // line where the dependency line would be, which is fine for a reader
  // asserting a parsed list but would make every exact-text assertion
  // here about the blank line instead of the write.
  const DESC = (line = "") =>
    `# X - Description\n\n## Tracking info\n\n- **Task:** \`09-x/\`\n- **Created:** \`2026-08-19\`\n` +
    (line ? `${line}\n` : "") +
    `\n---\n\n## Description\n\nprose\n`;

  describe("stripDependsOnLine", () => {
    test("takes the line out and leaves everything else where it was", () => {
      expect(stripDependsOnLine(DESC("- **Depends on:** `105`"))).toBe(DESC());
    });

    test("a text with no line at all comes back as it went in", () => {
      expect(stripDependsOnLine(DESC())).toBe(DESC());
    });

    // A textarea posts CRLF whatever the file had, and `asFileText`
    // normalises the same way — the two passes have to agree, or a
    // strip that missed the line would leave the write keeping it.
    test("CRLF is normalised to LF, and the line goes either way", () => {
      expect(stripDependsOnLine(DESC("- **Depends on:** `105`").replace(/\n/g, "\r\n"))).toBe(DESC());
    });
  });

  describe("withDependsOnLine", () => {
    test("inserts right after Created when there is no existing line", () => {
      expect(withDependsOnLine(DESC(), ["164"])).toBe(DESC("- **Depends on:** `164`"));
    });

    test("replaces an existing line rather than writing a second one", () => {
      const out = withDependsOnLine(DESC("- **Depends on:** `105`"), ["164", "92-a-spec"]);
      expect(out).toBe(DESC("- **Depends on:** `164`, `92-a-spec`"));
      expect(out!.match(/Depends on/g)).toHaveLength(1);
    });

    test("an empty list removes the line", () => {
      expect(withDependsOnLine(DESC("- **Depends on:** `105`"), [])).toBe(DESC());
    });

    // Nowhere to put it is a refusal for the caller to make, not a
    // guess about where Tracking info would have been.
    test("no Created line to anchor on is a null, not a guess", () => {
      expect(withDependsOnLine("# X\n\nprose\n", ["164"])).toBeNull();
    });

    test("but removing needs no anchor — an empty list is never a null", () => {
      expect(withDependsOnLine("# X\n\nprose\n", [])).toBe("# X\n\nprose\n");
    });

    test("what it writes is what specDependsOn reads back", () => {
      const d = spec("05-roundtrip", withDependsOnLine(DESC(), ["164", "165"])!);
      expect(specDependsOn(d)).toEqual(["164", "165"]);
    });
  });
});
