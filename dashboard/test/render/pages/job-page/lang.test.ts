// Spec 482 (AC-1, AC-3): the job page's facts table (Started/Model/
// Effort/Cost so far/Tokens so far) and the Steps tab's own expanded
// step summary (At/Cost/Tokens/Result) were string literals, never
// routed through `t()`, so they read English on a Norwegian board.
import { describe, expect, test } from "bun:test";
import { renderJobDetailPage } from "../../../../src/render";
import { detail, NAV } from "../fixtures.ts";

describe("the job page's facts, in Norwegian", () => {
  test("Started/Model/Effort/Cost so far/Tokens so far are Norwegian, not English", () => {
    const html = renderJobDetailPage(
      detail({ model: "sonnet", effort: "high", spentUsd: 1.2 }),
      "2026-09-17T00:00:00Z",
      NAV,
      { tab: "overview", lang: "nb" },
    );
    expect(html).toContain(">Startet<");
    expect(html).toContain(">Modell<");
    expect(html).toContain(">Innsats<");
    expect(html).toContain("Kostnad så langt");
    expect(html).toContain("Tokens så langt");
    expect(html).not.toContain(">Started<");
    expect(html).not.toContain(">Model<");
    expect(html).not.toContain(">Effort<");
    expect(html).not.toContain("Cost so far");
    expect(html).not.toContain("Tokens so far");
  });

  test("an expanded step's own summary reads Ved/Resultat, not At/Result", () => {
    const html = renderJobDetailPage(
      detail({
        results: [
          {
            step: "analyze", ok: true, costUsd: 0.42, costMeasured: true,
            terminalReason: "completed", at: "2026-08-16T10:01:00Z",
            logs: [{ by: "ai", lines: ["Bash ls"] }],
          },
        ],
      }),
      "2026-09-17T00:00:00Z",
      NAV,
      { tab: "steps", step: "0", lang: "nb" },
    );
    // `stepSummary()`'s own panel, scoped here rather than the whole
    // page, since the table's own column headers (`<th>At</th>`, out of
    // this spec's scope) share the bare word. Cut at the panel's own
    // "facts" table close — nested `<tr>`s inside it defeat a lazy match
    // ending at the first `</tr>`.
    const at = html.indexOf('<tr class="steplog">');
    const summary = html.slice(at, html.indexOf("</table>", at) + "</table>".length);
    expect(summary).toContain(">Ved<");
    expect(summary).toContain(">Resultat<");
    expect(summary).not.toContain(">At<");
    expect(summary).not.toContain(">Result<");
  });

  // Phase 8's final sweep (Risk analysis): a step with no log at all, a
  // running row's own bare state word, and the "Attempt {n}" phrase
  // beside a retried step's name — all three found only once every named
  // item above was already fixed, and named explicitly so they would not
  // be rediscovered from scratch later.
  test("a step with no log, the running row's own word, and 'Attempt N' all read Norwegian", () => {
    const html = renderJobDetailPage(
      detail({
        results: [{ step: "analyze", ok: true, costUsd: 0.42, costMeasured: true, terminalReason: "completed", attempt: 2 }],
        runningStep: { step: "implement", attempt: 3, logs: [] },
      }),
      "2026-09-17T00:00:00Z",
      NAV,
      { tab: "steps", step: "0", lang: "nb" },
    );
    expect(html).toContain("Forsøk 2");
    expect(html).toContain("Forsøk 3");
    expect(html).not.toContain("Attempt ");
    expect(html).toContain(">kjører<");
    expect(html).toContain("Loggen mangler for dette steget.");
    expect(html).not.toContain("The log is missing for this step.");
  });
});
