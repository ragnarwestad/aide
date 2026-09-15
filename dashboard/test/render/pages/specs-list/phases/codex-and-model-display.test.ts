import { describe, expect, test } from "bun:test";
import { renderJobDetailPage, renderSpecsRows, type SpecTarget } from "../../../../../src/render";
import { detail, NAV, openKeys } from "../../fixtures.ts";

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
describe("the model picker shows only the model's name, never a tool suffix", () => {
  const codexTarget: SpecTarget = { project: "aide", specFolder: "125-codex" };

  test("a codex entry's option text is exactly its name, with no suffix", () => {
    const html = renderSpecsRows(
      [],
      {
        runnerAvailable: true,
        targets: [codexTarget],
        modelChoices: [
          { name: "sonnet" },
          // Deliberately a name that does NOT contain "codex": a name
          // that did would pass this test whether or not the suffix is
          // still being appended.
          { name: "gpt-fast",  tool: "codex" },
        ],
        filter: { open: openKeys([], [codexTarget]) },
      },
      Date.parse("2026-08-20T12:00:00Z"),
    );
    // Spec 457: the label is the model's name alone, no suffix naming
    // the tool and no budget either (spec 454's own suffix, dropped).
    expect(html).toMatch(/<option value="gpt-fast"[^>]*>gpt-fast<\/option>/);
    // Nothing on the option says the tool to a READER: the option's
    // group says it while the list is open, the name itself while it
    // is closed. `data-tool` is there for the phase's AI select to
    // read (spec 179) — it says which AI a model belongs to, and
    // hides nothing, which is what spec 169 removed the filter for.
    expect(html).toMatch(/<option value="gpt-fast" data-tool="codex"/);
    expect(html).not.toContain("(codex)");
    expect(html).not.toContain("(codex)");
    // The claude entries are left exactly as they were, name only.
    expect(html).toMatch(/<option value="sonnet"[^>]*>sonnet<\/option>/);
  });
});

// Every line of a multi-step job shows ITS step's model, and a choice
// name renamed away still shows the tool it ran on (2026-09-15): the
// row's own `model` is the last step's, and spread over every attempt
// it named codex-sol on the analyze line that ran on Sonnet.
describe("each phase line shows what that step ran on", () => {
  const choices = [
    { name: "Sonnet" },
    { name: "gpt-5.6-sol",  tool: "codex" as const },
  ];
  const job = {
    id: "j32",
    project: "woodstack",
    specFolder: "32-about",
    steps: ["analyze", "implement"],
    stepIndex: 1,
    state: "done" as const,
    spentUsd: 1.5,
    timeoutSec: 1200,
    createdAt: "2026-09-15T08:00:00Z",
    model: "codex-sol",
    stepModels: { analyze: "Sonnet", implement: "codex-sol" },
    results: [
      { step: "analyze", ok: true, tool: "claude", costUsd: 1.5, terminalReason: "completed", at: "2026-09-15T08:10:00Z" },
      { step: "implement", ok: true, tool: "codex", costUsd: 0, terminalReason: "completed", at: "2026-09-15T08:20:00Z" },
    ],
  };
  const line = (html: string, step: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">.*?</tr>`, "s"))?.[0] ?? "";
  const now = (l: string) => l.match(/class="aimodelnow"[^>]*>([^<]*)/)?.[1];
  test("the analyze line names Sonnet, the implement line names the codex model it ran on", () => {
    const html = renderSpecsRows(
      [job],
      {
        runnerAvailable: true,
        targets: [{ project: "woodstack", specFolder: "32-about", done: ["analyze", "implement"] }],
        modelChoices: choices,
        defaultModels: { default: "Sonnet" },
        filter: { open: "woodstack/32-about" },
      },
      Date.parse("2026-09-15T10:00:00Z"),
    );
    expect(now(line(html, "analyze"))).toBe("Claude/Sonnet");
    expect(now(line(html, "implement"))).toBe("Codex/codex-sol");
  });
});
