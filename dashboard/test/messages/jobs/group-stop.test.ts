import { expect, test } from "bun:test";
import { getGroupStopMessage } from "../../../src/messages/jobs/group-stop.ts";
import type { QueueRowView } from "../../../src/render/ui/job-state/types.ts";
import { formatMessage } from "../../../src/messages/format.ts";

const failed: QueueRowView = {
  id: "job-805", project: "aide", specFolder: "805-first", state: "failed",
  steps: ["implement"], stepIndex: 0, spentUsd: 0, timeoutSec: 600,
  createdAt: "2026-11-14T20:00:00Z",
  error: "Tests failed; correct the failing tests and press Implement again.",
};
const group = { project: "aide", state: "stopped", currentMember: "805-first" } as const;

test("a stopped group identifies its stopped member without repeating the failure", () => {
  const result = getGroupStopMessage(group, [{ specFolder: "805-first", lead: failed }], "en");
  expect(result?.specFolder).toBe("805-first");
  expect(result?.notice.text).toBe(formatMessage("en", { key: "group.memberStopped", values: { spec: "aide:805" } }));
  expect(result?.notice.text).not.toContain(failed.error as string);
  expect(result?.notice.variant).toBe("waiting");
});

test("a manually stopped group has a message even without a member failure", () => {
  expect(getGroupStopMessage(group, [], "en")?.notice).toEqual({
    variant: "waiting", text: formatMessage("en", { key: "group.stopped" }),
  });
});

test("a group that is no longer stopped does not repeat an old failure", () => {
  for (const state of ["prepared", "queued", "running", "waiting-acceptance", "archiving", "completed"] as const) {
    expect(getGroupStopMessage({ ...group, state }, [{ specFolder: "805-first", lead: failed }], "en")).toBeUndefined();
  }
});

test("a stopped group does not attribute another member's old failure to its current member", () => {
  const result = getGroupStopMessage({ ...group, currentMember: "806-second" }, [
    { specFolder: "805-first", lead: failed },
    { specFolder: "806-second", lead: { ...failed, specFolder: "806-second", state: "done", error: undefined } },
  ], "en");
  expect(result?.specFolder).toBeUndefined();
  expect(result?.notice.text).toBe(formatMessage("en", { key: "group.stopped" }));
});

test("the group points to the spec in the reader's language", () => {
  const result = getGroupStopMessage(group, [{ specFolder: "805-first", lead: failed }], "nb");
  expect(result?.notice.text).toBe(formatMessage("nb", { key: "group.memberStopped", values: { spec: "aide:805" } }));
});

test("an archive landing failure names its spec even while the group remains archiving", () => {
  const result = getGroupStopMessage({ ...group, state: "archiving", error: "Archive did not land" }, [
    { specFolder: "805-first", lead: { ...failed, steps: ["archive"] } },
  ], "en");
  expect(result?.specFolder).toBe("805-first");
  expect(result?.notice.text).toBe(formatMessage("en", { key: "group.memberStopped", values: { spec: "aide:805" } }));
});

test.each(["stopped", "interrupted", "cancelled"] as const)("a %s member is identified on the group", (state) => {
  expect(getGroupStopMessage(group, [{ specFolder: "805-first", lead: { ...failed, state } }], "en")?.specFolder).toBe("805-first");
});

test("an archive failure still identifies an archived member whose job has ended done", () => {
  const result = getGroupStopMessage({ ...group, state: "archiving", error: "Archive did not land" }, [
    { specFolder: "805-first", lead: { ...failed, state: "done", error: undefined } },
  ], "en");
  expect(result?.specFolder).toBe("805-first");
});

test("a recovered group identifies the failed job from its saved history when currentMember is absent", () => {
  const result = getGroupStopMessage({ ...group, currentMember: undefined, jobs: [
    { id: failed.id, specFolder: failed.specFolder, logs: [] },
  ] }, [{ specFolder: "805-first", lead: failed }], "en");
  expect(result?.specFolder).toBe("805-first");
});

test("a recovered group ignores a saved failure once that spec has a newer successful job", () => {
  const result = getGroupStopMessage({ ...group, currentMember: undefined, jobs: [
    { id: failed.id, specFolder: failed.specFolder, logs: [] },
  ] }, [{ specFolder: "805-first", lead: { ...failed, id: "newer-job", state: "done", error: undefined } }], "en");
  expect(result?.specFolder).toBeUndefined();
});

test("an archive failure can name its member after the member's job has left the queue", () => {
  expect(getGroupStopMessage({ ...group, state: "archiving", error: "Archive did not land" }, [
    { specFolder: "805-first" },
  ], "en")?.specFolder).toBe("805-first");
});
