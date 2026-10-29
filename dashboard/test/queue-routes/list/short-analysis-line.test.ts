// A spec whose 2-analysis.md Tracking info says its analysis was short carries
// one line saying so on its row and on its page; one without the bullet does not.

import { afterEach, describe, expect, test } from "bun:test";
import { ran } from "../../helpers/queue-server.ts";
import { listUntil, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness } = setupQueueRoutesHarness();
afterEach(() => harness.cleanup());

const SPEC = "81-queue-and-runner";
const LINE = "Short analysis: no plan and no plan review";

const analysisWith = (...bullets: string[]): string =>
  ["# Analysis", "", "## Tracking info", "", ...bullets, "", "## Findings", ""].join("\n");

const text = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const pageOf = async (base: string): Promise<string> => text(await (await fetch(`${base}/specs/aide/${SPEC}`)).text());
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("a short analysis is said on the row and the page", () => {
  test("each carries the line once", async () => {
    const { base, dir } = harness.start({ analysis: analysisWith("- **Analysis:** short") });
    ran(dir, ["create", "analyze"], SPEC);
    const list = text(await listUntil(base, (h) => h.includes(LINE), 4_000, "the short-analysis line"));
    expect(count(list, LINE)).toBe(1);
    expect(count(await pageOf(base), LINE)).toBe(1);
  }, 8_000);

  test("a spec with no such bullet carries no line", async () => {
    const { base, dir } = harness.start({ analysis: analysisWith("- **Result:** completed") });
    ran(dir, ["create", "analyze"], SPEC);
    const list = text(await listUntil(base, (h) => h.includes(SPEC), 4_000, "the spec's row"));
    expect(list).not.toContain("Short analysis");
    expect(await pageOf(base)).not.toContain("Short analysis");
  }, 8_000);
});
