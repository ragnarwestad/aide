// Split out of spec-list-rendering.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderQueuePage, renderSite, OVERVIEW_PAGE, type QueueRowView } from "../../../src/render.ts";
import { CSS } from "../../../src/render/ui/css.ts";
import { ran, statusSaying } from "../../helpers/queue-server.ts";
import {
  TOKEN,
  JOB,
  specHead,
  specPanel,
  specControls,
  phaseDone,
  OPEN_81,
  listUntil,
  rowSaysDone,
  setupQueueRoutesHarness,
} from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

describe("GET / (the spec list, HTML)", () => {
  test("layout, forms, labels, and the runner notice", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
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
      expect(line).toContain(`aria-label="${step}"`);
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
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, {
      method: "POST",
      headers,
      body: JSON.stringify({ project: "aide", specFolder: "schedule-nightly", steps: ["schedule"] }),
    });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).not.toContain("schedule-nightly");
  });

  test("the blunt meta refresh is a no-JS fallback, not the mechanism", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    // A page with a form must not reload underneath someone filling it
    // in; the script swaps the table body instead.
    expect(html).toContain("<noscript><meta http-equiv=\"refresh\"");
    expect(html).toContain("<script");
    expect(html).toContain('id="jobrows"');
  });

  // Spec 107 narrowed this, deliberately and by exactly one script. A
  // theme the reader chose has to be applied before the page paints,
  // and a generated page is a FILE — there is no server in front of it
  // to have decided. So every page now carries the theme switcher, and
  // this test says which script that is rather than allowing scripts
  // in general: anything else appearing here is still the drift the
  // test was written to stop.
  //
  // Spec 115 widened it by exactly one more, on exactly one page: the
  // overview is a redirect now, and sending a reader on is what that
  // page is FOR. Named here rather than allowed in general — the rule
  // for every other page is unchanged, and this one's second script is
  // asserted to be the redirect and nothing else.
  test("the generated pages carry no page code beyond the shared theme switcher", () => {
    for (const page of renderSite([{ name: "p", manifest: { ok: true, data: { name: "p" } }, specs: [] }], "x")) {
      const scripts = [...page.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
      const allowed = page.path === OVERVIEW_PAGE ? 2 : 1;
      expect([page.path, scripts.length]).toEqual([page.path, allowed]);
      expect(scripts[0]).toContain("data-theme-choice");
      if (allowed === 2) expect(scripts[1]).toBe("location.replace('/projects' + location.search);");
      expect(page.html.match(/<script/g)).toHaveLength(allowed);
    }
  });

  test("?rows=1 returns the table body alone, for the script to swap in", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const rows = await (
      await fetch(`${base}/?rows=1&${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
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

  // A generated page is a FILE, and the list it points at is served.
  // Both ways there are absolute: the wordmark and, since spec 119, the
  // Specs tab — which is never the current one on a generated page.
  test("generated pages reach the list through the wordmark and the Specs tab", () => {
    const pages = renderSite([{ name: "p", manifest: { ok: true, data: { name: "p" } }, specs: [] }], "2026-08-16");
    for (const p of pages) {
      expect(p.html).toContain('<a class="brand" href="/">');
      expect(p.html).toContain('<a class="tab" data-nav data-goto href="/">Specs</a>');
    }
  });
});

describe("renderQueuePage state labels", () => {
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
    const budgetRow = row("stopped", { stopReason: "budget", error: "stopped — budget" });
    const timeoutRow = row("stopped", { stopReason: "timeout", error: "stopped — 20 min" });
    const html = renderQueuePage(
      [
        budgetRow,
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
    expect(specHead(html, budgetRow.specFolder)).not.toContain("stopped — budget");
    expect(specHead(html, timeoutRow.specFolder)).not.toContain("stopped — 20 min");
    // REQ-2/REQ-9: the reason moves to the notice line, in full.
    expect(specPanel(html, budgetRow.specFolder)).toContain("stopped — budget");
    expect(specPanel(html, timeoutRow.specFolder)).toContain("stopped — 20 min");
    expect(html).toContain("failed");
    expect(html).not.toContain("stopped — failed");
  });

  test("the Spec column is pinned to its own width (REQ-1/REQ-2)", () => {
    const html = renderQueuePage(
      [],
      "2026-08-16T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      { runnerAvailable: false, targets: [] },
    );
    expect(html).toContain('data-col="spec"');
    expect(CSS).toContain('th[data-col="spec"]');
  });
});

describe("every row answers for itself", () => {
  // The title and the phase left the row on 2026-08-21 — the folder name
  // says the one and the pips say the other — and the percentage left it
  // in spec 167. The point of the test is unchanged: the row answers for
  // itself, server-rendered, with no selection and no data block for a
  // script to read. This is the one test that follows the percentage all
  // the way from a real 4-status.md on disk to the served HTML, so it is
  // the one that can still go red if the figure ever creeps back.
  test("a spec's progress stays off its own row (criterion 9)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    // A status file that DOES carry a percentage: the row must ignore it.
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "4-status.md"),
      statusSaying(
        ["create", "analyze"],
        "- **Total progress:** `64% (14 of 22 completed)`\n\n## Phase 2: GREEN\n\n| t | ⬜ |\n",
      ),
    );
    // Open: the row's one action rides the caption line the fold opens
    // (2026-09-08), and its label is what this reads off the file.
    const html = await (
      await fetch(`${base}/?open=aide%2F81-queue-and-runner`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    // Server-rendered on the row itself: there is no selection left to
    // answer, and no data block for a script to answer it from.
    const line = specHead(html, "81-queue-and-runner");
    // The figure counted the checkbox rows implement ticks, so it was 0
    // with analyze done and 90-something the moment implement ended. The pips say how far the spec has got and the
    // State column says what is happening now.
    expect(line).not.toContain("% done");
    expect(line).not.toContain("64%");
    expect(line).not.toContain("Phase 2: GREEN");
    // What the row DOES still read off this same file: which phase is
    // the first one still ahead, as the button's own label. The pips
    // said the same thing until 2026-09-07; the percentage is gone, and
    // the file is still read.
    expect(specControls(html, "81-queue-and-runner")).toMatch(
      /<button[^>]*class="btn primary"[^>]*>[A-Z][a-z]+<\/button>/,
    );
    expect(html).not.toContain('id="targetdata"');
    expect(html).not.toContain('<select name="target"');
  });

  // Spec 93 put this reason in ONE place, above the table, and said so:
  // "it belongs to the PAGE, not to one control". That held while the
  // page had one form; it lists up to 25 rows, and a reason attached to
  // none of them does not say which button was pressed. Spec 99 moved
  // it onto the row that posted it — the same reason, read off the same
  // query string, one row further down.
  test("a refusal is shown once, on the row that posted it (criterion 6)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const post = () =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
        body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
      });
    await post();
    const refused = await post();
    expect(refused.status).toBe(303);
    const location = refused.headers.get("location") ?? "";
    expect(location.startsWith("/?error=")).toBe(true);
    const html = await (await fetch(`${base}${location}`, { headers: { "x-aide-token": TOKEN } })).text();
    // In the row's own panel since spec 151, not in the name cell.
    expect(specPanel(html, "81-queue-and-runner")).toContain("already queued");
    expect(specHead(html, "81-queue-and-runner")).not.toContain("already queued");
    // Once, not twice: the banner is the fallback for a refusal that
    // belongs to no row.
    expect(html).not.toContain('<p class="refusal">');
  });

  test("state is a chip with its own class, so a failure is not a wall of grey", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const rows = await (await fetch(`${base}/?rows=1`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(rows).toContain('class="badge b-idle"');
    expect(rows).toContain("queued");
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
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
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
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    const theme = scriptAt(html, "data-theme-choice");
    expect(theme).toBeGreaterThan(-1);
    expect(theme).toBeLessThan(html.indexOf("</head>"));
    expect(theme).toBeLessThan(html.indexOf("<body>"));
    expect(theme).toBeLessThan(html.indexOf('id="jobrows"'));
  });

  test("the two scripts are two, and each is found by what it says", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(scriptAt(html, "jobrows")).not.toBe(scriptAt(html, "data-theme-choice"));
  });
});

describe("the step boxes on a row follow that spec", () => {
  test("a step the spec has already had is marked done and shown ticked and locked (spec 267, criterion 1)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
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
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "2-analysis.md"),
      "# Analysis\n\n[filled in by /aide-analyze]\n",
    );
    // Created and nothing else: the record, not the file's size, is
    // what says so (spec 139).
    const html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
    const line = specControls(html, "81-queue-and-runner");
    expect(line).toMatch(/value="analyze" checked/);
    expect(phaseDone(line, "analyze")).toBe(false);
  });

  test("with the analysis already on disk, implement is pre-ticked (criterion 1b)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
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
