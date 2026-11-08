// A spec whose 1-description.md Tracking info says it was sent back to a full
// analysis carries one line saying so, and why, on its row and on its page;
// one without the bullet does not.

import { afterEach, describe, expect, test } from "bun:test";
import { ran } from "../../helpers/queue-server.ts";
import { listUntil, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness } = setupQueueRoutesHarness();
afterEach(() => harness.cleanup());

const SPEC = "81-queue-and-runner";
const WHY = "it changes the result format every page reads, in nine files";
const LINE = `Sent back to a full analysis: ${WHY}`;

const descriptionWith = (...bullets: string[]): string =>
  ["# Queue - Description", "", "## Tracking info", "", ...bullets, "", "## Description", ""].join("\n");

const text = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const pageOf = async (base: string): Promise<string> => text(await (await fetch(`${base}/specs/aide/${SPEC}`)).text());
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("a spec sent back to a full analysis says so on the row and the page", () => {
  test("each carries the line once, with the sentence", async () => {
    const { base, dir } = harness.start({ description: descriptionWith(`- **Sent back to a full analysis:** ${WHY}`) });
    ran(dir, ["create", "analyze"], SPEC);
    const list = text(await listUntil(base, (h) => h.includes(LINE), 4_000, "the sent-back line"));
    expect(count(list, LINE)).toBe(1);
    expect(count(await pageOf(base), LINE)).toBe(1);
  }, 8_000);

  test("a spec with no such bullet carries no line", async () => {
    const { base, dir } = harness.start({ description: descriptionWith("- **Task:** `81-queue-and-runner/`") });
    ran(dir, ["create", "analyze"], SPEC);
    const list = text(await listUntil(base, (h) => h.includes(SPEC), 4_000, "the spec's row"));
    expect(list).not.toContain("Sent back to a full analysis");
    expect(await pageOf(base)).not.toContain("Sent back to a full analysis");
  }, 8_000);
});
