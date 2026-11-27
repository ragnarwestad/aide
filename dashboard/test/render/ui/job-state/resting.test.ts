// The state words come from a per-language, per-step
// table, not from stepLabel() + "ing" — and the drift guard from Risk
// analysis: a step WORKFLOW_STEPS knows about must have both an English
// and a Norwegian entry, so a future step added there fails this test
// rather than silently falling back to English prose in Norwegian mode.
import { describe, expect, test } from "bun:test";
import { t } from "../../../../src/i18n";
import { WORKFLOW_STEPS } from "../../../../src/queue/steps.ts";
import { GERUND_EN, GERUND_NB, GERUND_ES, GERUND_DE, GERUND_FR, specStateChip } from "../../../../src/render/ui/job-state/resting.ts";
import { STEP_LABELS_NB, STEP_LABELS_ES, STEP_LABELS_DE, STEP_LABELS_FR } from "../../../../src/render/ui/components";
import type { QueueRowView } from "../../../../src/render";

describe("GERUND_EN/GERUND_NB/GERUND_ES/GERUND_DE/GERUND_FR", () => {
  test("a schedule uses the shared running state label", () => {
    expect(GERUND_EN.schedule).toBe(t("en", "list.state.running"));
  });
  test("every WORKFLOW_STEPS member has an entry in every table", () => {
    for (const step of WORKFLOW_STEPS) {
      expect(GERUND_EN[step], `GERUND_EN is missing "${step}"`).toBeDefined();
      expect(GERUND_NB[step], `GERUND_NB is missing "${step}"`).toBeDefined();
      expect(GERUND_ES[step], `GERUND_ES is missing "${step}"`).toBeDefined();
      expect(GERUND_DE[step], `GERUND_DE is missing "${step}"`).toBeDefined();
      expect(GERUND_FR[step], `GERUND_FR is missing "${step}"`).toBeDefined();
    }
  });
});

// The same guard for the phase's NAME. English is the step's own id, so
// there is nothing to keep in step there; every other language is a real
// table, and a step added to WORKFLOW_STEPS without an entry would read
// as English on a board that is not.
describe("STEP_LABELS_NB/STEP_LABELS_ES/STEP_LABELS_DE/STEP_LABELS_FR", () => {
  test("every WORKFLOW_STEPS member has a name in every language", () => {
    for (const step of WORKFLOW_STEPS) {
      expect(STEP_LABELS_NB[step], `STEP_LABELS_NB is missing "${step}"`).toBeDefined();
      expect(STEP_LABELS_ES[step], `STEP_LABELS_ES is missing "${step}"`).toBeDefined();
      expect(STEP_LABELS_DE[step], `STEP_LABELS_DE is missing "${step}"`).toBeDefined();
      expect(STEP_LABELS_FR[step], `STEP_LABELS_FR is missing "${step}"`).toBeDefined();
    }
  });
});

const row = (over: Partial<QueueRowView> = {}): QueueRowView => ({
  id: "j1",
  project: "aide",
  specFolder: "1-x",
  steps: ["analyze"],
  stepIndex: 0,
  state: "running",
  spentUsd: 0,
  timeoutSec: 600,
  createdAt: "2026-09-01T00:00:00Z",
  ...over,
});

test("a deploy held back before it starts reads Queued, and one held back after it started reads as running (AC-3, AC-7)", () => {
  const held: Partial<QueueRowView> = { steps: ["deploy"], errorReason: "held-back", error: { key: "runner.landingPause" } };
  expect(specStateChip(row({ ...held, state: "queued" }), "en")).toContain(t("en", "list.state.queued"));
  expect(specStateChip(row({ ...held, state: "running" }), "en")).toContain(GERUND_EN.deploy);
});

// An ended job's chip on the Jobs tab and the specs list reads the state's
// word from the reader's catalogue.
describe("specStateChip() on an ended job, in the reader's language", () => {
  const ENDED = ["failed", "cancelled", "waiting"] as const;
  const wordOf = (html: string) => html.match(/>([^<]*)<\/span>$/)?.[1];

  test("in Norwegian the chip reads the catalogue's word (AC-1)", () => {
    for (const state of ENDED) {
      const html = specStateChip(row({ state, steps: ["implement"], stepIndex: 0 }), "nb");
      const word = t("nb", `state.${state}`);
      expect(wordOf(html)).toBe(word[0]!.toUpperCase() + word.slice(1));
    }
  });
});

test("a card names the merging phase while the next phase waits (AC-7)", () => {
  expect(specStateChip(row({ state: "queued", steps: ["analyze", "implement"], stepIndex: 1, landing: true,
    queuePosition: { id: "job:next", n: 1, total: 1, operation: "implement" } }), "en")).toContain("Analyzing");
});
