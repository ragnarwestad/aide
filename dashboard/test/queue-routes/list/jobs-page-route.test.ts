// GET / is the Jobs page: the board's first page. These are the rules it has
// of its own — what it answers, where an old Specs list link goes, the
// allowlist it ignores, its headings, no Run, and the sentence for nothing.

import { afterEach, describe, expect, test } from "bun:test";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

const job = (o: Record<string, unknown>) => ({
  id: "j1",
  project: "aide",
  specFolder: "81-queue-and-runner",
  steps: ["analyze"],
  stepIndex: 0,
  state: "running",
  timeoutSec: {},
  permissionMode: {},
  model: {},
  results: [],
  createdAt: "2026-10-08T10:00:00Z",
  startedAt: "2026-10-08T10:00:00Z",
  ...o,
});

const board = (jobs: Record<string, unknown>[] = []) =>
  harness.start({ extra: { queueProjects: ["aide"] }, ...(jobs.length ? { queueMirror: JSON.stringify(jobs) } : {}) });

describe("GET / answers the Jobs page (AC-1)", () => {
  test("with the follow marker and the jobs part, even with nothing running (AC-1)", async () => {
    const { base } = board();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("data-follow");
    expect(html).toContain('data-follow-part="jobs"');
  });

  test("?follow=1 answers the marker and the part alone, uncached (AC-1)", async () => {
    const { base } = board([job({})]);
    const res = await fetch(`${base}/?follow=1`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("data-follow");
    expect(html).toContain('data-follow-part="jobs"');
    expect(html).not.toContain("<header");
  });

  test("a method other than GET is refused (AC-1)", async () => {
    const { base } = board();
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
  });
});

describe("an old link to the Specs list is sent on (AC-1)", () => {
  test("a list key in the address answers 302 to /specs with the same query (AC-1)", async () => {
    const { base } = board();
    const res = await fetch(`${base}/?open=aide/81-x`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/specs?open=aide/81-x");
  });

  test("an empty value is caught too (AC-1)", async () => {
    const { base } = board();
    const res = await fetch(`${base}/?rows=`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/specs?rows=");
  });

  test("every key the list reads is sent on (AC-1)", async () => {
    const { base } = board();
    for (const key of ["rows", "only", "state", "project", "sort", "dir", "open", "checks", "phases", "q"]) {
      const res = await fetch(`${base}/?${key}=x`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/specs?${key}=x`);
    }
  });

  test("an address with no list key is the Jobs page (AC-1)", async () => {
    const { base } = board();
    const res = await fetch(`${base}/?lang=nb`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('data-follow-part="jobs"');
  });
});

describe("what the page shows (AC-2, AC-4, AC-6, AC-7)", () => {
  test("a running job of a project off the allowlist has its row (AC-2)", async () => {
    const { base } = board([job({ id: "gone", project: "retired", specFolder: "07-old" })]);
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("07-old");
    expect(html).toContain("retired");
  });

  test("a row's table has the headings Title, State, Time and Cost (AC-4)", async () => {
    const { base } = board([job({})]);
    const html = await (await fetch(`${base}/`)).text();
    const head = html.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "";
    const words = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1]!.replace(/<[^>]*>/g, "").trim());
    // The last heading holds both units; the reader's choice shows one.
    expect(words.slice(0, 3)).toEqual(["Title", "State", "Time"]);
    expect(words[3]).toStartWith("Cost");
  });

  test("the headings come in the reader's language (AC-4)", async () => {
    const { base } = board([job({})]);
    const html = await (await fetch(`${base}/?lang=nb`)).text();
    const head = html.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "";
    expect(head).toContain("Tittel");
    expect(head).toContain("Tid");
    expect(head).toContain("Kostnad");
  });

  test("no form's action is exactly /api/queue, in any state (AC-6)", async () => {
    const states = ["queued", "running", "failed", "stopped", "interrupted", "done"];
    const jobs = states.map((state, i) =>
      job({ id: `s${i}`, state, specFolder: `${80 + i}-spec-${state}`, createdAt: `2026-10-08T10:0${i}:00Z` }),
    );
    const { base } = board(jobs);
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("spec-running");
    expect(html).not.toMatch(/action="\/api\/queue"/);
  });

  test("with nothing to show it says so and draws no table; with a running job it does not (AC-7)", async () => {
    const empty = await (await fetch(`${board().base}/`)).text();
    expect(empty).toContain("Nothing is running.");
    expect(empty).not.toContain("<table");

    const busy = await (await fetch(`${board([job({})]).base}/`)).text();
    expect(busy).not.toContain("Nothing is running.");
    expect(busy).toContain("<table");
  });

  test("a finished job that needs nobody has no row (AC-2)", async () => {
    const { base } = board([job({ state: "done", specFolder: "55-finished-fine" })]);
    const html = await (await fetch(`${base}/`)).text();
    expect(html).not.toContain("55-finished-fine");
    expect(html).toContain("Nothing is running.");
  });
});
