// A › asks for one row, and the answer is that row as the whole list draws it
// in the same view: the same rows where the view shows it, and none where the
// view hides it. Asked of a served board holding every kind of row: a spec in
// its second round, an archived spec, two specs in an execution group, two
// runs of a scheduled job and a deploy. No job is in flight, so no row counts
// time between the two answers compared.

import { afterEach, describe, expect, test } from "bun:test";
import { group, setupQueueRoutesHarness } from "../../../queue-routes/fixtures.ts";

const { harness } = setupQueueRoutesHarness("aide-one-row-");
afterEach(() => harness.cleanup());

const job = (o: Record<string, unknown>) => ({
  id: "j1", project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0, state: "done",
  timeoutSec: {}, permissionMode: {}, model: {}, results: [],
  createdAt: "2026-10-08T10:00:00Z", startedAt: "2026-10-08T10:00:00Z", finishedAt: "2026-10-08T10:05:00Z", ...o,
});
const member = (folder: string, position: number): string =>
  `# ${folder}\n\n## Tracking info\n\n- **Created:** \`2026-11-11\`\n- **Group:** \`Release\`\n- **Group position:** ${position}\n`;

const SPEC = "aide/81-queue-and-runner";
const EARLIER_ROUND = `${SPEC}@${encodeURIComponent("2026-10-08T10:00:00Z")}`;
const ARCHIVED = "aide/90-finished";
const MEMBERS = ["aide/82-first", "aide/83-second"];
const SPEC_KEYS = [SPEC, ARCHIVED, ...MEMBERS];
const JOB_KEYS = ["aide/schedule-report", "aide/schedule-report@report-old", "aide/deploy:deploy"];

/** `registered: false` leaves the group out of the registry, so the two
 *  members are a group by the name their descriptions share alone. */
function board({ registered = true } = {}) {
  return harness.start({
    extra: { queueProjects: ["aide"] },
    alsoSpecs: ["82-first", "83-second"],
    alsoDescriptions: { "82-first": member("82-first", 1), "83-second": member("83-second", 2) },
    archivedSpecs: { "90-finished": {} },
    executionGroups: registered ? [{
      id: "group-1", project: "aide", name: "Release", members: ["82-first", "83-second"], branch: "aide/group-82",
      state: "prepared", createdAt: "2026-11-11T10:00:00Z", completedMembers: [], jobs: [],
    }] : [],
    queueMirror: JSON.stringify([
      job({ id: "first" }),
      job({ id: "reopened", steps: ["reopen"], createdAt: "2026-10-09T10:00:00Z", startedAt: "2026-10-09T10:00:00Z", finishedAt: "2026-10-09T10:05:00Z" }),
      job({ id: "second", steps: ["implement"], createdAt: "2026-10-10T10:00:00Z", startedAt: "2026-10-10T10:00:00Z", finishedAt: "2026-10-10T10:05:00Z" }),
      // A failed member: the Failed entry shows its group's card, and the other member in it.
      job({ id: "failed-83", specFolder: "83-second", steps: ["implement"], state: "failed", createdAt: "2026-10-10T12:00:00Z", startedAt: "2026-10-10T12:00:00Z", finishedAt: "2026-10-10T12:05:00Z" }),
      job({ id: "report-old", specFolder: "schedule-report", steps: ["schedule"], state: "failed", createdAt: "2026-10-11T03:00:00Z", startedAt: "2026-10-11T03:00:00Z", finishedAt: "2026-10-11T03:01:00Z" }),
      job({ id: "report-new", specFolder: "schedule-report", steps: ["schedule"], createdAt: "2026-10-12T03:00:00Z", startedAt: "2026-10-12T03:00:00Z", finishedAt: "2026-10-12T03:01:00Z" }),
      job({ id: "deployed", specFolder: "deploy", steps: ["deploy"], createdAt: "2026-10-12T09:00:00Z", startedAt: "2026-10-12T09:00:00Z", finishedAt: "2026-10-12T09:01:00Z" }),
    ]),
  });
}

const text = async (address: string): Promise<string> => {
  const res = await fetch(address, { redirect: "manual" });
  expect(res.status).toBe(200);
  return await res.text();
};

/** The whole rows answer at an address, once two answers in a row are the
 *  same: what the server reads in the background after it starts has arrived. */
async function settledRows(address: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  let last = await text(address);
  for (;;) {
    await new Promise((r) => setTimeout(r, 60));
    const next = await text(address);
    if (next === last) return next;
    if (Date.now() > deadline) throw new Error(`the rows at ${address} never came to rest`);
    last = next;
  }
}

/** The rows a one-row answer holds, without the table around them. */
const rowsIn = (answer: string): string => answer.replace(/^<table><tbody>|<\/tbody><\/table>$/g, "");
const and = (query: string): string => (query ? `&${query}` : "");

/** Every key's one-row answer at `path` equals that key's rows in the whole
 *  answer in the same view; `shown` and `hidden` say which the view shows. */
async function sameAsWholeList(path: string, view: string, keys: string[], expected: { shown?: string[]; hidden?: string[] } = {}): Promise<void> {
  const whole = await settledRows(`${path}?rows=1${and(view)}`);
  for (const key of keys) {
    const one = rowsIn(await text(`${path}?rows=1&only=${encodeURIComponent(key)}${and(view)}`));
    expect({ view, key, rows: one }).toEqual({ view, key, rows: group(whole, `spec-${key}`) });
    if (expected.shown?.includes(key)) expect({ view, key, empty: one === "" }).toEqual({ view, key, empty: false });
    if (expected.hidden?.includes(key)) expect({ view, key, rows: one }).toEqual({ view, key, rows: "" });
  }
}

describe("one row of the Jobs tab", () => {
  const KEYS = [...SPEC_KEYS, EARLIER_ROUND, ...JOB_KEYS];

  test("is the row the whole tab draws, shut and open (AC-5)", async () => {
    const { base } = board();
    await sameAsWholeList(`${base}/`, "", KEYS, { shown: KEYS });
    for (const key of KEYS) await sameAsWholeList(`${base}/`, `open=${encodeURIComponent(key)}`, [key], { shown: [key] });
  });

  test("follows the view: a state entry, a search term, a sort and Norwegian (AC-5)", async () => {
    const { base } = board();
    await sameAsWholeList(`${base}/`, "state=failed", KEYS, { shown: ["aide/schedule-report@report-old", ...MEMBERS], hidden: [SPEC, "aide/deploy:deploy"] });
    await sameAsWholeList(`${base}/`, "q=report", KEYS, { shown: ["aide/schedule-report"], hidden: [SPEC, ...MEMBERS] });
    await sameAsWholeList(`${base}/`, "sort=cost&dir=asc", KEYS, { shown: KEYS });
    await sameAsWholeList(`${base}/`, "lang=nb", KEYS, { shown: KEYS });
  });

  test("a group member answers no row while the view hides its group's card (AC-5, AC-6)", async () => {
    const { base } = board();
    // The term matches the member's folder and not its group's name.
    await sameAsWholeList(`${base}/`, "q=82-first", MEMBERS, { hidden: MEMBERS });
  });

  test("a member of a group that is one by its name alone follows its card too (AC-5, AC-6)", async () => {
    const { base } = board({ registered: false });
    await sameAsWholeList(`${base}/`, "", MEMBERS, { shown: MEMBERS });
    await sameAsWholeList(`${base}/`, "q=82-first", MEMBERS, { hidden: MEMBERS });
  });
});

describe("one row of the Specs list", () => {
  test("is the row the whole list draws in the same view (AC-5)", async () => {
    const { base } = board();
    const LIVE = [SPEC, ...MEMBERS];
    await sameAsWholeList(`${base}/specs`, "state=all", SPEC_KEYS, { shown: SPEC_KEYS });
    await sameAsWholeList(`${base}/specs`, "state=not-archived", SPEC_KEYS, { shown: LIVE, hidden: [ARCHIVED] });
    await sameAsWholeList(`${base}/specs`, "state=archived", SPEC_KEYS, { shown: [ARCHIVED], hidden: LIVE });
    await sameAsWholeList(`${base}/specs`, "q=82-first", SPEC_KEYS, { shown: ["aide/82-first"], hidden: [SPEC, "aide/83-second"] });
    await sameAsWholeList(`${base}/specs`, "state=all&sort=spec&dir=desc", SPEC_KEYS, { shown: SPEC_KEYS });
    await sameAsWholeList(`${base}/specs`, "state=all&lang=nb", SPEC_KEYS, { shown: SPEC_KEYS });
  });

  test("at a spec's own address, is the row the list there draws: the open spec's and another's (AC-5)", async () => {
    const { base } = board();
    for (const open of [SPEC, ARCHIVED]) {
      await sameAsWholeList(`${base}/specs/${open}`, "", [open, "aide/82-first"], { shown: [open, "aide/82-first"] });
    }
  });

  test("the spec opened in place is that spec's rows in the page at its address (AC-5)", async () => {
    const { base } = board();
    for (const key of [SPEC, ARCHIVED]) {
      await settledRows(`${base}/specs/${key}?rows=1`);
      const page = await text(`${base}/specs/${key}`);
      const detail = (await text(`${base}/specs/${key}?detail=1`)).replace(/<script src="[^"]*"><\/script>$/, "");
      expect(rowsIn(detail)).not.toBe("");
      expect({ key, rows: rowsIn(detail) }).toEqual({ key, rows: group(page, `spec-${key}`) });
    }
  });

  test("a key no spec has answers a table with no row (AC-6)", async () => {
    const { base } = board();
    const none = await text(`${base}/specs?rows=1&only=aide/99-no-such-spec`);
    expect(none).toContain("<table");
    expect(none).not.toContain("<tr");
  });
});
