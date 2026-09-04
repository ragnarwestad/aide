import { describe, expect, test } from "bun:test";
import { renderJobDetailPage, renderQueueRows, type QueueTarget } from "../../../../src/render.ts";
import { detail, NAV, openKeys } from "../fixtures.ts";

// Split out of listing-and-units.test.ts by theme.
//
// Spec 125: a step run by Codex says two things the page has to honour.
// There is no `claude-usage` for a Codex session, so the Live panel is
// not "unknown" — it is absent, because nothing will ever fill it. And
// there is no dollar figure anywhere in Codex's output, so the Cost
// column shows the token count and a dash where the money would be.
describe("a job run by Codex", () => {
  test("shows no Live right now panel — nothing watches a Codex session", () => {
    const html = renderJobDetailPage(
      detail({ state: "running", tool: "codex" }),
      "2026-08-20T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).not.toContain("Live right now");
  });

  // Spec 125's other half — that a running CLAUDE job still showed the
  // panel — is gone with the panel itself (spec 150). Both tools are
  // asserted panel-free in "Live right now is gone" below.

  test("a Codex step's Cost column is tokens and a dash, never $0.00", () => {
    const html = renderJobDetailPage(
      detail({
        state: "done",
        results: [
          {
            step: "implement", ok: true, tool: "codex", costUsd: 0, costMeasured: false,
            tokens: 9_562, terminalReason: "completed", at: "2026-08-20T10:01:00Z",
          },
        ],
      }),
      "2026-08-20T10:05:00Z",
      NAV,
      { tab: "steps" },
    );
    expect(html).not.toContain("$0.00");
    expect(html).toContain("9.6k");
  });
});

// The picker used to append the tool to a non-Claude entry's label
// (spec 125), so two entries starting different CLIs could be told
// apart. Spec 167 took it back off: the entries are called `codex-sol`
// and `codex-luna`, so the name already says it, and since spec 169 the
// option sits under a group named after its tool, which says it a
// second time while the list is open. A model name that does not say
// which tool it starts is a name to fix in queue-config.json, not a
// label to patch.
describe("the model picker shows the model's name and nothing else", () => {
  const codexTarget: QueueTarget = { project: "aide", specFolder: "125-codex" };

  test("a codex entry's option text is exactly its name, with no suffix", () => {
    const html = renderQueueRows(
      [],
      {
        runnerAvailable: true,
        targets: [codexTarget],
        modelChoices: [
          { name: "sonnet", budgetUsd: 3 },
          // Deliberately a name that does NOT contain "codex": a name
          // that did would pass this test whether or not the suffix is
          // still being appended.
          { name: "gpt-fast", budgetUsd: 5, tool: "codex" },
        ],
        filter: { open: openKeys([], [codexTarget]) },
      },
      Date.parse("2026-08-20T12:00:00Z"),
    );
    expect(html).toMatch(/<option value="gpt-fast"[^>]*>gpt-fast<\/option>/);
    // Nothing on the option says the tool to a READER: the option's
    // group says it while the list is open, the name itself while it
    // is closed. `data-tool` is there for the phase's AI select to
    // read (spec 179) — it says which AI a model belongs to, and
    // hides nothing, which is what spec 169 removed the filter for.
    expect(html).toMatch(/<option value="gpt-fast" data-tool="codex"/);
    expect(html).not.toContain("(codex)");
    expect(html).not.toContain("(codex)");
    // The claude entries are left exactly as they were.
    expect(html).toMatch(/<option value="sonnet"[^>]*>sonnet<\/option>/);
  });
});
