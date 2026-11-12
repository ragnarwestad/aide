import { expect, test } from "bun:test";
import type { ExecutionGroup } from "../../../../src/queue/execution-groups";
import { executionGroupCard, executionGroupPlace } from "../../../../src/render/pages/jobs-page/execution-group-card.ts";
import type { SpecGroup } from "../../../../src/render/pages/specs-list";
import { projectLink } from "../../../../src/render/ui/components/spec-name.ts";

const group = (state: ExecutionGroup["state"]): ExecutionGroup => ({
  id: "group-1", project: "aide", name: "Release", members: ["2-second", "1-first"], branch: "group/1-first",
  state, createdAt: "2026-11-10T12:00:00.000Z", startedAt: "2026-11-11T12:00:00.000Z",
  completedMembers: ["2-second"], jobs: [],
});
const member = (folder: string, html: string) => ({
  key: `aide/${folder}`, html,
  group: { project: "aide", specFolder: folder, done: ["create"], state: "not-started" } as SpecGroup,
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

test("a card ready to archive names Archive once, on its button", () => {
  const ready = (folder: string) => ({ ...member(folder, "<tr></tr>"), group: { ...member(folder, "").group, done: ["create", "analyze", "implement"] } as SpecGroup });
  const html = executionGroupCard(group("waiting-acceptance"), [ready("1-first"), ready("2-second")]);
  expect(html).toContain('name="action" value="archive"');
  expect(html.match(/Archive/g)).toHaveLength(1);
});

test("a card is drawn shut unless a member's spec is open in it", () => {
  const shut = executionGroupCard(group("prepared"), [member("1-first", "<tr>first</tr>")]);
  expect(shut.match(/data-group-body hidden/g)).toHaveLength(2);
  const open = executionGroupCard(group("prepared"), [member("1-first", '<tr class="spechead"></tr><tr data-spec-detail="aide/1-first"></tr>')]);
  expect(open).not.toContain("data-group-body hidden");
  expect(open).toContain('aria-expanded="true"');
});

test("a card names its group after its project, as a spec is named", () => {
  expect(executionGroupCard(group("prepared"), [])).toContain(projectLink("aide", { className: "muted" }));
});
