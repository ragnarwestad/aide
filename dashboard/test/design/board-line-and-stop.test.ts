// Which board a page is served from decides what its header offers: a
// prod board never draws the Stop or Run form, a test board draws Stop,
// and a round board draws Run beside it.
import { afterEach, describe, expect, test } from "bun:test";
import { hostname } from "node:os";
import {
  navEntries,
  renderProjectsPage,
  renderSpecsPage,
  type ProjectView,
} from "../../src/render";
import { getBoardInfo, setBoardInfo } from "../../src/render/ui/board-info.ts";
import { AT } from "./row-fixtures.ts";

/** The whole form that posts to `action`, or "" when there is none. */
const formPosting = (html: string, action: string): string =>
  html.match(new RegExp(`<form\\b[^>]*\\saction="${action}"[^>]*>[\\s\\S]*?</form>`))?.[0] ?? "";

/** The hooks on that form's class, which the page script selects on. */
const hooksOf = (form: string): string[] => form.match(/^<form\b[^>]*\sclass="([^"]*)"/)?.[1]?.split(" ") ?? [];

// --- the board line and its Stop control (spec 424) --------------------------
//
// Which board a page is served from — a process-lifetime value read
// directly by `pageHeader()` (`getBoardInfo()`), never threaded through
// any of the call sites above. Covers two differently-shaped served
// pages (`renderProjectsPage`, `renderSpecsPage`), since REQ-2 names
// "headeren" with no page excluded.

describe("the board line and its Stop control (spec 424)", () => {
  const project: ProjectView = { name: "aide", manifest: { ok: true, data: { name: "aide" } }, specs: [] };
  const entries = navEntries();
  const machine = process.env.AIDE_DASH_HOST ?? hostname();

  afterEach(() => setBoardInfo(undefined));

  function render(): string[] {
    return [
      renderProjectsPage([project], AT, entries, {}),
      renderSpecsPage([], AT, entries, { runnerAvailable: true, targets: [] }),
    ];
  }

  // The spec's number on the line, the folder and branch as hover text
  // (2026-09-10): spec 424's "<spec> : <branch>" spelt the same long name
  // twice, since the branch is always aide/<folder>.
  test("a test board's header reads '<machine> - Test - <number>', with folder and branch on hover", () => {
    setBoardInfo("424-headeren-sier-hvilket-board-du-er-pa-og-testserveren-kan-stoppes-derfra");
    for (const html of render()) {
      expect(html).toContain(`${machine} - Test - 424<`);
      expect(html).toContain(
        'title="424-headeren-sier-hvilket-board-du-er-pa-og-testserveren-kan-stoppes-derfra : ' +
          'aide/424-headeren-sier-hvilket-board-du-er-pa-og-testserveren-kan-stoppes-derfra"',
      );
      expect(html).not.toContain("Test - 424-headeren");
    }
  });

  test("REQ-3: a test board's header carries a Stop form beside the line", () => {
    setBoardInfo("424-headeren-sier-hvilket-board-du-er-pa-og-testserveren-kan-stoppes-derfra");
    for (const html of render()) {
      const stop = formPosting(html, "/api/self-stop");
      expect(stop).toContain('method="post"');
      expect(hooksOf(stop)).toEqual(["actionform"]);
    }
  });

  // The Run control (2026-09-11): the round's fixtures through again on
  // this same board, the server left as it is. Beside Stop, and like
  // Stop nowhere on a prod board.
  test("a round board's header carries a Run form beside Stop; a spec's branch board and a prod board none", () => {
    // Started from a checkout: the round's own fixtures, and Run — and
    // the line says so: "Test - round", not a spec's number.
    setBoardInfo("aide-wt-run");
    for (const html of render()) {
      expect(html).toContain(`${machine} - Test - round<`);
      expect(formPosting(html, "/api/self-stop")).not.toBe("");
      const run = formPosting(html, "/api/self-run");
      expect(run).toContain('method="post"');
      expect(hooksOf(run).sort()).toEqual(["actionform", "reloadform"]);
    }
    // Started from a spec's branch: a preview of that spec, never re-run.
    setBoardInfo("424-headeren-sier-hvilket-board-du-er-pa-og-testserveren-kan-stoppes-derfra");
    for (const html of render()) {
      expect(html).toContain('action="/api/self-stop"');
      expect(html).not.toContain('action="/api/self-run"');
    }
    setBoardInfo(undefined);
    for (const html of render()) {
      expect(html).not.toContain('action="/api/self-run"');
    }
  });

  // Risk (3-solution.md): a module-level singleton must never leak a
  // prior test's board across `createServer()`/render calls in the same
  // `bun test` process.
  test("no leakage: an ordinary render right after a test-board one shows no Stop form", () => {
    setBoardInfo("424-headeren-sier-hvilket-board-du-er-pa-og-testserveren-kan-stoppes-derfra");
    render();
    setBoardInfo(undefined);
    for (const html of render()) {
      expect(html).not.toContain('action="/api/self-stop"');
      expect(html).toContain(`${machine} - Prod`);
    }
    expect(getBoardInfo()).toBeUndefined();
  });
});
