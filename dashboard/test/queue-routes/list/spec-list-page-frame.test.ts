// Split out of spec-list-rendering.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderSpecsPage, type QueueRowView } from "../../../src/render";
import { ran, statusSaying } from "../../helpers/queue-server.ts";
import { JOB, specHead, specPanel, specControls, phaseDone, OPEN_81, listUntil, rowSaysDone, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

describe("GET / (the spec list, HTML)", () => {
  test("layout, forms, labels, and the runner notice", async () => {
    const { base } = start();
    const headers = { "content-type": "application/json", accept: "application/json" };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const html = await (await fetch(`${base}/?${OPEN_81}`, )).text();
    expect(html).toContain("<nav");
    expect(html).toContain("81-queue-and-runner");
    expect(html).toContain('<form id="rowrun-aide/81-queue-and-runner" method="post"');
    expect(html).toContain('<a class="brand" href="/">');
    // Every control says what it is: an unlabelled checkbox next to some
    // buttons tells the reader nothing. The steps, the row's one button
    // and what is left of the fields nobody sets every time are all on
    // the one line an open row grows (spec 117) — nothing waits behind
    // a second click. 81a ships no runner, so the job posted above is
    // sitting in "queued": the row's one control is the way to stop it,
    // named for the step it would stop (spec 157).
    const line = specControls(html, "81-queue-and-runner");
    expect(line).toContain(">Cancel</button>");
    for (const step of ["analyze", "implement", "archive"]) {
      expect(line).toContain(`name="steps" value="${step}"`);
      expect(line).toContain(`aria-label="${step[0]!.toUpperCase()}${step.slice(1)}"`);
    }
    expect(html).not.toContain(">more</summary>");
    // 81a ships no runner: the page must say so rather than leave a
    // job sitting in "queued" with no explanation.
    expect(html.toLowerCase()).toContain("no runner");
  });

  // A schedule job's tracking key (`schedule-<name>`, spec 259) is
  // exempted from the specFolder-must-exist check so it can be enqueued
  // at all — but nothing excluded it from this list, so it drew a row
  // whose name linked to `/specs/aide/schedule-<name>`, a 404 (there is
  // no such spec folder), and whose action buttons refused every press
  // with "unknown specFolder". Its own history belongs on `/schedule`'s
  // detail page, never here.
  test("draws no row for a schedule job (spec 259/276/277)", async () => {
    const { base } = start();
    const headers = { "content-type": "application/json", accept: "application/json" };
    await fetch(`${base}/api/queue`, {
      method: "POST",
      headers,
      body: JSON.stringify({ project: "aide", specFolder: "schedule-nightly", steps: ["schedule"] }),
    });
    const html = await (await fetch(`${base}/`, )).text();
    expect(html).not.toContain("schedule-nightly");
  });

  test("a page that ships the script carries no meta refresh", async () => {
    const { base } = start();
    const html = await (await fetch(`${base}/`, )).text();
    // A page with a form must not reload underneath someone filling it
    // in; the script swaps the table body instead.
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain("<script");
    expect(html).toContain('id="jobrows"');
  });

  test("?rows=1 returns the table body alone, for the script to swap in", async () => {
    const { base } = start();
    const headers = { "content-type": "application/json", accept: "application/json" };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const rows = await (
      await fetch(`${base}/?rows=1&${OPEN_81}`, )
    ).text();
    expect(rows).toContain("<tr");
    expect(rows).toContain("81-queue-and-runner");
    expect(rows).not.toContain("<html");
    // The row's own control belongs to a ROW, so unlike the retired top
    // form it must survive the swap: without it, every five seconds the
    // page would lose the only way to act on a spec (criterion 8). The
    // job posted above is queued with no runner to take it, so that
    // control is Cancel.
    const line = specControls(rows, "81-queue-and-runner");
    expect(line).toContain('method="post" action="/api/queue"');
    expect(line).toContain('<input type="checkbox" name="steps" value="analyze"');
    expect(line).toContain(">Cancel</button>");
  });

});

describe("renderSpecsPage state labels", () => {
  // Every job gets its own spec: the list holds one line per SPEC, so
  // nine jobs sharing a folder would be nine attempts at one phase, of
  // which only the latest shows — and this test is about how each state
  // is put into WORDS, not about which of them the list picks.
  let seq = 0;
  const row = (state: string, extra: Partial<QueueRowView> = {}): QueueRowView => {
    const n = ++seq;
    return {
      id: `id-${state}-${n}`,
      project: "aide",
      specFolder: `81-queue-and-runner-${n}`,
      steps: ["analyze"],
      stepIndex: 0,
      state: state as QueueRowView["state"],
      spentUsd: 0,
      timeoutSec: 1200,
      createdAt: "2026-08-16T00:00:00Z",
      ...extra,
    };
  };

  test("stopped is never rendered as failed", () => {
    const providerLimitRow = row("stopped", { stopReason: "provider-limit", error: "stopped — provider limit" });
    const timeoutRow = row("stopped", { stopReason: "timeout", error: "stopped — 20 min" });
    const html = renderSpecsPage(
      [
        providerLimitRow,
        timeoutRow,
        row("failed", { error: "boom" }),
        row("queued"),
        row("running"),
        row("done"),
        row("cancelled"),
        row("interrupted"),
      ],
      "2026-08-16T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      { runnerAvailable: false, targets: [] },
    );
    // REQ-1: the State cell says only the bare word.
    expect(specHead(html, providerLimitRow.specFolder)).not.toContain("stopped — provider limit");
    expect(specHead(html, timeoutRow.specFolder)).not.toContain("stopped — 20 min");
    // REQ-2/REQ-9: the reason moves to the notice line, in full.
    expect(specPanel(html, providerLimitRow.specFolder)).toContain("Stopped — provider limit");
    expect(specPanel(html, timeoutRow.specFolder)).toContain("Stopped — 20 min");
    expect(html).toContain("Failed");
    expect(html).not.toContain("stopped — failed");
  });
});

describe("every row answers for itself", () => {
  // Spec 93 put this reason in ONE place, above the table, and said so:
  // "it belongs to the PAGE, not to one control". That held while the
  // page had one form; it lists up to 25 rows, and a reason attached to
  // none of them does not say which button was pressed. Spec 99 moved
  // it onto the row that posted it — the same reason, read off the same
  // query string, one row further down.
  test("a refusal is shown once, on the row that posted it (criterion 6)", async () => {
    const { base } = start();
    const post = () =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
      });
    await post();
    const refused = await post();
    expect(refused.status).toBe(303);
    const location = refused.headers.get("location") ?? "";
    expect(location.startsWith("/?error=")).toBe(true);
    const html = await (await fetch(`${base}${location}`, )).text();
    // In the row's own panel since spec 151, not in the name cell.
    expect(specPanel(html, "81-queue-and-runner")).toContain("already queued");
    expect(specHead(html, "81-queue-and-runner")).not.toContain("already queued");
    // Once, not twice: the banner is the fallback for a refusal that
    // belongs to no row.
    expect(html).not.toContain('<p class="refusal">');
  });
});

describe("page code placement", () => {
  /** Where the <script> whose code contains `needle` starts. The served
   *  page has carried two inline scripts since spec 107 — the theme
   *  switcher in <head> and the list's own code at the end of <body> —
   *  so "the first one" stopped naming either of them. */
  const scriptAt = (html: string, needle: string): number => {
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      if (m[1]!.includes(needle)) return m.index!;
    }
    return -1;
  };

  test("the script comes AFTER the elements it wires up", async () => {
    const { base } = start();
    const html = await (await fetch(`${base}/`, )).text();
    const rows = html.indexOf('id="jobrows"');
    const script = scriptAt(html, "jobrows");
    expect(rows).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(-1);
    // An inline script in <head> runs before the DOM exists, so every
    // listener attaches to nothing — and the failure is silent.
    expect(script).toBeGreaterThan(rows);
    expect(html.indexOf("</head>")).toBeLessThan(script);
  });

  // Spec 107. The other placement, and the opposite reason for it: the
  // theme has to be on the html element before the first paint, so this
  // script deliberately goes where the one above must not.
  test("the theme switcher comes BEFORE anything it could be seen to change", async () => {
    const { base } = start();
    const html = await (await fetch(`${base}/`, )).text();
    const theme = scriptAt(html, "data-theme-choice");
    expect(theme).toBeGreaterThan(-1);
    expect(theme).toBeLessThan(html.indexOf("</head>"));
    expect(theme).toBeLessThan(html.indexOf("<body"));
    expect(theme).toBeLessThan(html.indexOf('id="jobrows"'));
  });
});

describe("the step boxes on a row follow that spec", () => {
  test("a step the spec has already had is marked done and shown ticked and locked (spec 267, criterion 1)", async () => {
    const { base, dir } = start();
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(join(spec, "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const html = await listUntil(base, rowSaysDone("analyze"));
    const line = specControls(html, "81-queue-and-runner");
    // analyze is done, so its box is ticked and locked (spec 267);
    // implement is what you came for, so its box is pre-ticked and
    // tickable.
    expect(line).toMatch(/data-phase="analyze"[^]*?value="analyze" checked disabled/);
    expect(line).not.toMatch(/data-phase="analyze"[^]*?name="steps" value="analyze"/);
    expect(line).toMatch(/data-phase="implement"[^]*?value="implement"[^>]*checked/);
    expect(phaseDone(line, "analyze")).toBe(true);
  });

  test("a spec nothing has run yet offers analyze (criterion 1a)", async () => {
    const { base, dir } = start();
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "2-analysis.md"),
      "# Analysis\n\n[filled in by /aide-analyze]\n",
    );
    // Created and nothing else: the record, not the file's size, is
    // what says so (spec 139).
    const html = await (await fetch(`${base}/?${OPEN_81}`, )).text();
    const line = specControls(html, "81-queue-and-runner");
    expect(line).toMatch(/value="analyze" checked/);
    expect(phaseDone(line, "analyze")).toBe(false);
  });

  test("with the analysis already on disk, implement is pre-ticked (criterion 1b)", async () => {
    const { base, dir } = start();
    // Analysed by hand and committed with the subject the runner uses
    // (spec 154), so the row must not tick and mark the same box at
    // once.
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "4-status.md"),
      statusSaying(["create", "analyze"]),
    );
    ran(dir, ["create", "analyze"], "81-queue-and-runner", { headless: false });
    const line = specControls(await listUntil(base, rowSaysDone("analyze")), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(true);
    // analyze is done, so its box is ticked and locked (spec 267) —
    // never a `name="steps"` box a press could re-submit — and
    // implement is pre-ticked and tickable instead.
    expect(line).not.toMatch(/name="steps" value="analyze"/);
    expect(line).toMatch(/value="implement" checked/);
  });
});
