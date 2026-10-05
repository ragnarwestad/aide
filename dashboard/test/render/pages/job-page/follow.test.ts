// The marker a job page and a spec's Steps tab carry while their job is in
// flight: what the page script reads to follow it, and nothing else.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { followMarker } from "../../../../src/render/pages/job-page/follow.ts";
import { row } from "../fixtures.ts";

const marker = (html: string): Element | null => {
  const win = new Window();
  win.document.write(html);
  const found = win.document.querySelector("[data-follow]");
  return found as unknown as Element | null;
};

const job = (extra: Parameters<typeof row>[0] = {}) =>
  row({ project: "aide", specFolder: "605-follow", steps: ["create", "analyze", "implement"], stepIndex: 2, ...extra });

describe("followMarker: whether a page follows (AC-1)", () => {
  test("a job that has ended in any way draws no marker (AC-1)", () => {
    for (const state of ["done", "failed", "stopped", "interrupted", "cancelled"] as const) {
      expect(followMarker(job({ state }), { tab: "steps" }), state).toBe("");
    }
  });

  test("a queued job, a running job and a landing job draw one that names the tab (AC-1)", () => {
    const flying = [job({ state: "queued" }), job({ state: "running" }), job({ state: "done", landing: true })];
    for (const j of flying) {
      expect(marker(followMarker(j, { tab: "overview" }))?.getAttribute("data-tab"), j.state).toBe("overview");
    }
  });
});

describe("followMarker: what it names (AC-2)", () => {
  const phases = (html: string): string | null => marker(html)?.getAttribute("data-phases") ?? null;
  const KEYS = "aide/605-follow:create,aide/605-follow:analyze,aide/605-follow:implement";

  test("with the running row open it names every step's phase and the running index (AC-2)", () => {
    for (const step of [undefined, "live", "2"]) {
      const html = followMarker(job(), { tab: "steps", step, runningIndex: 2 });
      expect(phases(html), String(step)).toBe(KEYS);
      expect(marker(html)?.getAttribute("data-running"), String(step)).toBe("2");
    }
  });

  test("on Overview, or with a row shut or a finished row open, it names no phases but the running index (AC-2)", () => {
    const drawn = [
      followMarker(job(), { tab: "overview", runningIndex: 2 }),
      followMarker(job(), { tab: "steps", step: "none", runningIndex: 2 }),
      followMarker(job(), { tab: "steps", step: "0", runningIndex: 2 }),
    ];
    for (const html of drawn) {
      expect(marker(html)?.hasAttribute("data-phases")).toBe(false);
      expect(marker(html)?.getAttribute("data-running")).toBe("2");
    }
  });

  test("a queued job has no running index and so no phases to hear (AC-2)", () => {
    const html = followMarker(job({ state: "queued" }), { tab: "steps" });
    expect(marker(html)?.hasAttribute("data-running")).toBe(false);
    expect(marker(html)?.hasAttribute("data-phases")).toBe(false);
  });
});
