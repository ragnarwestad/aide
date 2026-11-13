import { expect, test } from "bun:test";
import type { ExecutionGroup } from "../../../../src/queue/execution-groups";
import { executionGroupCard, executionGroupPlace, memberPipKind } from "../../../../src/render/pages/jobs-page/execution-group-card.ts";
import type { SpecGroup } from "../../../../src/render/pages/specs-list";
import { projectLink } from "../../../../src/render/ui/components/spec-name.ts";
import { t } from "../../../../src/i18n";
import { executionGroupRowState } from "../../../../src/render/pages/jobs-page";
import { activeDurationCell, costCell } from "../../../../src/render/pages/specs-list/cell-helpers.ts";

const group = (state: ExecutionGroup["state"]): ExecutionGroup => ({
  id: "group-1", project: "aide", name: "Release", members: ["2-second", "1-first"], branch: "group/1-first",
  state, createdAt: "2026-11-10T12:00:00.000Z", startedAt: "2026-11-11T12:00:00.000Z",
  completedMembers: ["2-second"], jobs: [],
});
const member = (folder: string, html: string, totals: Partial<SpecGroup> = {}) => ({
  key: `aide/${folder}`, html,
  group: {
    project: "aide", specFolder: folder, done: [], state: "not-started", phases: [],
    spentUsd: 0, costUnmeasured: false, ...totals,
  } as unknown as SpecGroup,
});

test("a card sums its members' settled time and cost (AC-1, AC-3)", () => {
  const first = member("1-first", "<tr>first</tr>", { totalDurationMs: 65_000, spentUsd: 1.25 });
  const second = member("2-second", "<tr>second</tr>", { totalDurationMs: 55_000, spentUsd: 2.75 });
  const html = executionGroupCard(group("completed"), [first, second]);

  expect(html).toContain(activeDurationCell({ totalDurationMs: 120_000 } as SpecGroup));
  expect(html).toContain(costCell(4, undefined, "–"));
});

test("a card sums token-only cost across its members (AC-3)", () => {
  const first = member("1-first", "<tr>first</tr>", { spentTokens: 1_000 });
  const second = member("2-second", "<tr>second</tr>", { spentTokens: 2_500 });

  expect(executionGroupCard(group("completed"), [first, second])).toContain(costCell(0, 3_500, "–"));
});

test("a card shows a settled zero-dollar member cost as zero (AC-3)", () => {
  const settled = member("1-first", "<tr>first</tr>", { done: ["create", "analyze"] });
  const untouched = member("2-second", "<tr>second</tr>");

  expect(executionGroupCard(group("completed"), [settled, untouched])).toContain(costCell(0, undefined, "–", true));
});

test("a card's live clock includes the other members' settled time (AC-2)", () => {
  const runningSince = "2026-11-13T10:00:00.000Z";
  const settled = member("1-first", "<tr>first</tr>", { totalDurationMs: 40_000 });
  const running = member("2-second", "<tr>second</tr>", { totalDurationMs: 20_000, totalDurationSince: runningSince });
  const groupSince = "2026-11-13T09:59:20.000Z";

  expect(executionGroupCard(group("running"), [settled, running])).toContain(
    activeDurationCell({ totalDurationMs: 60_000, totalDurationSince: groupSince } as SpecGroup),
  );
});

test("a card uses the spec-row no-value output before any member has run (AC-4)", () => {
  const html = executionGroupCard(group("prepared"), [member("1-first", "<tr>first</tr>"), member("2-second", "<tr>second</tr>")]);

  expect(html).toContain(activeDurationCell({ totalDurationMs: 0 } as SpecGroup));
  expect(html).toContain(costCell(0, undefined, "–"));
});

test("the card keeps saved member order and sorts by activity", () => {
  const html = executionGroupCard(group("prepared"), [member("1-first", "<tr>first</tr>"), member("2-second", "<tr>second</tr>")]);
  expect(html.indexOf("second")).toBeLessThan(html.indexOf("first"));
  const stoppedAtNoon = member("1-first", "<tr>first</tr>");
  stoppedAtNoon.group.lead = {
    state: "stopped", createdAt: "2026-11-11T09:00:00.000Z", startedAt: "2026-11-11T10:00:00.000Z",
    finishedAt: "2026-11-11T12:00:00.000Z",
  } as never;
  expect(executionGroupPlace({ ...group("stopped"), startedAt: "2026-11-11T10:00:00.000Z" }, [stoppedAtNoon])).toEqual({ band: 2, changedAt: Date.parse("2026-11-11T12:00:00.000Z") });
});

test("a running card offers Stop and retains member content (AC-1, AC-5, AC-8, AC-11)", () => {
  const html = executionGroupCard(group("running"), [member("2-second", "<tr>recovery</tr>"), member("1-first", "<tr>detail</tr>")]);
  expect(html).toContain('name="action" value="stop"');
  expect(html).not.toContain('value="start"');
  expect(html).toContain("recovery");
});

test("a prepared card starts by durable id (AC-3, AC-10, AC-11)", () => {
  const html = executionGroupCard({ ...group("prepared"), startedAt: undefined }, [member("1-first", "<tr>first</tr>"), member("2-second", "<tr>second</tr>")]);
  expect(html).toContain('/api/queue/groups/group-1');
  expect(html).toContain('name="action" value="start"');
});

test("completed groups have no card action (AC-12, AC-14)", () => {
  expect(executionGroupCard(group("completed"), [member("2-second", "<tr>history</tr>")])).not.toContain('name="action"');
});

test("a completed group is placed with finished work (AC-3, AC-4)", () => {
  expect(executionGroupPlace(group("completed"))).toEqual({ band: 3, changedAt: Date.parse("2026-11-11T12:00:00.000Z") });
});

test("a completed group is counted under Done rather than Stopped (AC-3, AC-5)", () => {
  expect(executionGroupRowState(group("completed"), false)).toBe("done");
});

test("a card ready to archive names Archive once, on its button", () => {
  const ready = (folder: string) => ({ ...member(folder, "<tr></tr>"), group: { ...member(folder, "").group, done: ["create", "analyze", "implement"] } as SpecGroup });
  const html = executionGroupCard(group("waiting-acceptance"), [ready("1-first"), ready("2-second")]);
  expect(html).toContain('name="action" value="archive"');
  expect(html.match(/Archive/g)).toHaveLength(1);
});

test("a card is drawn shut unless a member's spec is open in it, with no state marker (AC-4)", () => {
  const shut = executionGroupCard(group("prepared"), [member("1-first", "<tr>first</tr>")]);
  expect(shut.match(/data-group-body hidden/g)).toHaveLength(1);
  expect(shut).not.toContain("data-group-open");
  const open = executionGroupCard(group("prepared"), [member("1-first", '<tr class="spechead"></tr><tr data-spec-detail="aide/1-first"></tr>')]);
  expect(open).not.toContain("data-group-body hidden");
  expect(open).toContain('aria-expanded="true"');
});

test("a card shown for a chosen state is drawn open with every member, and carries the state (AC-4)", () => {
  const html = executionGroupCard(group("prepared"), [member("1-first", "<tr>queued-one</tr>"), member("2-second", "<tr>stopped-two</tr>")], "en", { openFor: "waiting" });
  expect(html).not.toContain("data-group-body hidden");
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain("queued-one");
  expect(html).toContain("stopped-two");
  expect(html).toContain('data-group-open="waiting"');
});

test("a card names its group after its project, as a spec is named", () => {
  expect(executionGroupCard(group("prepared"), [])).toContain(projectLink("aide", { className: "muted" }));
});

test("a card's state is read from the page's language", () => {
  expect(executionGroupCard(group("prepared"), [], "nb")).toContain(`>${t("nb", "list.groupState.prepared")}<`);
});

test("a group held back or done says so in a spec's own words", () => {
  expect(executionGroupCard(group("waiting-acceptance"), [], "nb")).toContain(`>${t("nb", "wordPhase.badgeHeldBack")}<`);
  expect(executionGroupCard(group("completed"), [], "nb")).toContain(`>${t("nb", "list.done")}<`);
});

test("a shut card still shows its members' pips", () => {
  const prepared = executionGroupCard(group("prepared"), [member("1-first", "<tr>first</tr>")]);
  expect(prepared.indexOf('class="pip ')).toBeGreaterThan(-1);
  expect(prepared.indexOf('class="pip ')).toBeLessThan(prepared.indexOf("data-group-body"));
});

test("a member's pip takes the colour of its own state", () => {
  const spec = (o: Partial<SpecGroup>) => ({ project: "aide", specFolder: "1-first", done: ["create"], state: "not-started", phases: [], ...o }) as SpecGroup;
  expect(memberPipKind(spec({}), true)).toBe("past");
  expect(memberPipKind(spec({ state: "archived" }), false)).toBe("past");
  expect(memberPipKind(spec({ lead: { state: "running" } as never }), false)).toBe("now");
  expect(memberPipKind(spec({ state: "failed" }), false)).toBe("refused");
  expect(memberPipKind(spec({ state: "stopped" }), false)).toBe("waiting");
  expect(memberPipKind(spec({ phases: [{ step: "archive", heldBack: { reason: "x" } }] as never }), false)).toBe("waiting");
  expect(memberPipKind(spec({}), false)).toBe("todo");
  expect(memberPipKind(undefined, false)).toBe("todo");
});

test("a card numbers its members' pips in the group's order", () => {
  const html = executionGroupCard(group("prepared"), [member("1-first", ""), member("2-second", "")]);
  const marks = html.slice(html.indexOf('class="pipletters"'), html.indexOf('class="pips"'));
  expect(marks.match(/>(\d)</g)).toEqual([">1<", ">2<"]);
  expect(html.indexOf('title="2-second"')).toBeLessThan(html.indexOf('title="1-first"'));
});
