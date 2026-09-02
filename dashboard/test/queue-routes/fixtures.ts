// Shared setup for the queue-routes test suite, split out of the old
// monolithic test/queue-routes.test.ts (8426 lines, 58 describe blocks)
// into one file per theme. Each file gets its own harness instance —
// bun:test re-evaluates this module fresh per test file, the same way
// test/helpers/queue-server.ts's queueHarness() factory already works.

import type { ServerOptions } from "../../src/serve/serve.ts";
import { queueHarness } from "../helpers/queue-server.ts";

export const TOKEN = "s3cret-token";

export const JOB = { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] };

export function setupQueueRoutesHarness(prefix = "aide-queue-routes-") {
  const harness = queueHarness(prefix);
  const start = (
    extra: Partial<ServerOptions> = {},
    alsoProjects: string[] = [],
    alsoSpecs: string[] = [],
    status?: string,
  ) => harness.start({ extra, alsoProjects, alsoSpecs, ...(status ? { status } : {}) });
  return { harness, start };
}

/** One spec's header row, which since spec 94 is where its Run control
 *  lives — and the only line of the spec a collapsed row leaves in the
 *  page. */
export const specHead = (html: string, folder: string): string =>
  html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";

/** The row's message panel (spec 143): the full-width row under the
 *  head, where every long message a row has to say is written — and
 *  since spec 151 that includes the queue's refusal of a press, which
 *  used to be squeezed into the name cell above. */
export const specPanel = (html: string, folder: string): string =>
  html.match(new RegExp(`<tr class="specnotice"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";

/** Everything an OPEN row draws: its header line and the phase lines
 *  under it. Since spec 124 the row's controls are split across the
 *  two — Run and the other buttons stand in the header's own first
 *  cell, each phase's checkbox on the phase's own line — so a test
 *  about "what the row offers" reads the whole group. */
export const specControls = (html: string, folder: string): string =>
  html.match(
    new RegExp(
      `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
        `(?=<tr class="[^"]*spechead|</tbody>)`,
    ),
  )?.[0] ?? "";

/** Whether a phase's own line says it is done. Since spec 124 the
 *  State column's badge is the one place that is said — the checkbox
 *  beside it carries no second mark, which is the duplication the spec
 *  set out to remove. */
export const phaseDone = (group: string, step: string): boolean =>
  (
    group.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">[\\s\\S]*?</tr>`))?.[0] ?? ""
  ).includes('class="badge b-done"');

/** Since spec 103 a row is COLLAPSED unless the view names it, and the
 *  run control comes with opening it. A test about that control asks
 *  for the row open — the same query string the fold link builds. */
export const openQuery = (...keys: string[]): string => `open=${encodeURIComponent(keys.join(","))}`;
export const OPEN_81 = openQuery("aide/81-queue-and-runner");

/** The spec list, asked again until `ok` holds (spec 208).
 *
 *  A render reads memory now — the git answers behind a row arrive on
 *  the cache schedule's own tick, not inside the request. Every fixture
 *  below that makes its commits or edits its files AFTER the server
 *  started is therefore asserting something that lands a tick later,
 *  and the ONE thing that changed for these tests is that they ask
 *  again rather than once.
 *
 *  Bounded, and it falls through with the last answer it got: a genuine
 *  regression then reads as the assertion it broke rather than as a
 *  timeout with nothing to look at. The same idiom `projects-route.test.ts`
 *  has used for the drift poll since spec 203. */
export const listUntil = async (
  base: string,
  ok: (html: string) => boolean,
  budgetMs = 3000,
): Promise<string> => {
  const deadline = Date.now() + budgetMs;
  let html = "";
  for (;;) {
    html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
    if (ok(html) || Date.now() > deadline) return html;
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** Git has dated the spec's folder — which it can only do once the
 *  fixture's own `ran()` has made the repo, and once the cache schedule
 *  has come round since (spec 208). `–` is the cell before either. */
export const dated = (html: string): boolean =>
  !specControls(html, "81-queue-and-runner").includes('data-col="started">–');

/** The commonest of those predicates: this phase's own line says done. */
export const rowSaysDone = (step: string, folder = "81-queue-and-runner") => (html: string): boolean =>
  phaseDone(specControls(html, folder), step);

/** A claude-usage that records the merges the dashboard reports to it
 *  (spec 158). The URL is never reached: what is under test is what the
 *  server decides to send, and to whom. */
export function mergeEventSink(answer: () => Response | Promise<Response> = () => new Response("{}")) {
  const posted: Record<string, unknown>[] = [];
  const mergeEventFetch = (async (_url: unknown, init: unknown) => {
    posted.push(JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);
    return answer();
  }) as unknown as typeof fetch;
  return { posted, mergeEventFetch, mergeEventUrl: "http://claude-usage.test/api/merge-event" };
}

