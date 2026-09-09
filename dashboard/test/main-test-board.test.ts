// Spec 424: `main.ts generate`'s own `--test-board` flag, and the
// `AIDE_DASH_HOST` fallback both static pages need. `test/round/run`
// runs this command for a test board's own Projects/About pages, before
// it ever starts `serve.ts serve` — REQ-2 is explicit that "headeren"
// on a testserver covers every page, and these two are no exception.
import { afterEach, describe, expect, test } from "bun:test";
import { hostname, tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { main } from "../src/main.ts";
import { renderSite } from "../src/render.ts";
import { getBoardInfo, setBoardInfo } from "../src/render/ui/board-info.ts";

afterEach(() => setBoardInfo(undefined));

describe("main.ts generate's own --test-board flag", () => {
  test("sets the board info generate stamps into the pages it writes", () => {
    const root = mkdtempSync(join(tmpdir(), "aide-main-test-board-root-"));
    const out = mkdtempSync(join(tmpdir(), "aide-main-test-board-out-"));
    try {
      const code = main([
        "generate",
        "--root",
        root,
        "--out",
        out,
        "--test-board",
        "424-headeren-sier-hvilket-board",
      ]);
      expect(code).toBe(0);
      expect(getBoardInfo()).toEqual({
        specFolder: "424-headeren-sier-hvilket-board",
        branch: "aide/424-headeren-sier-hvilket-board",
      });
      const projects = readFileSync(join(out, "projects.html"), "utf-8");
      expect(projects).toContain("Test - 424-headeren-sier-hvilket-board : aide/424-headeren-sier-hvilket-board");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  test("absent, generate leaves the board info unset (Prod)", () => {
    const root = mkdtempSync(join(tmpdir(), "aide-main-test-board-root-"));
    const out = mkdtempSync(join(tmpdir(), "aide-main-test-board-out-"));
    try {
      setBoardInfo("leftover-from-a-prior-call");
      const code = main(["generate", "--root", root, "--out", out]);
      expect(code).toBe(0);
      expect(getBoardInfo()).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });
});

// Risk (3-solution.md): `make publish` generates on one machine and
// publishes to another (`$AIDE_DASH_HOST`) — reading the real
// `hostname()` at generate time would stamp the wrong machine's name
// onto the two static pages whenever the two differ.
describe("the two static pages read AIDE_DASH_HOST over the real hostname (spec 424)", () => {
  const original = process.env.AIDE_DASH_HOST;
  afterEach(() => {
    if (original === undefined) delete process.env.AIDE_DASH_HOST;
    else process.env.AIDE_DASH_HOST = original;
  });

  test("AIDE_DASH_HOST wins on the generated Projects/About pages", () => {
    const notThisMachine = `not-${hostname()}-really`;
    process.env.AIDE_DASH_HOST = notThisMachine;
    const pages = renderSite([], "2026-09-09T00:00:00Z");
    const projects = pages.find((p) => p.path === "projects.html")!;
    expect(projects.html).toContain(`${notThisMachine} - Prod`);
    expect(projects.html).not.toContain(`${hostname()} - Prod`);
  });
});
