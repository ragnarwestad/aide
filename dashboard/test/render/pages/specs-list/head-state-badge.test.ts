// A queued spec's place in the queue opens the queue editor on the Jobs tab;
// on the Specs list it is a plain badge.
import { expect, test } from "bun:test";
import { groupBySpec } from "../../../../src/render/pages/specs-list/data-model";
import { headStateBadge } from "../../../../src/render/pages/specs-list/head-row.ts";
import { row } from "../fixtures.ts";

const queued = groupBySpec(
  [row({ state: "queued", queuePosition: { id: "job:job-1234:0", n: 1, total: 2 } })],
  [{ project: "aide", specFolder: "81-queue-and-runner" }],
)[0]!;

test("a queued spec's position opens the queue editor on the Jobs tab", () => {
  expect(headStateBadge(queued, "en")).toContain('data-waiting-open="job:job-1234:0"');
});

test("on the Specs list the same position is a badge that opens nothing", () => {
  const html = headStateBadge(queued, "en", true);
  expect(html).toContain("Queued 1/2");
  expect(html).not.toContain("data-waiting-open");
});
