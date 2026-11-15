// The header's Deploy mark, swapped in when the event stream says it changed.
import { describe, expect, test } from "bun:test";
import { refreshDeployMark } from "../../../src/specs-client/deploy/mark.ts";

const EMPTY = '<span class="deploymark" aria-hidden="true"></span>';
const WAITING = '<a class="deploymark" href="/projects/aide?tab=deploy">(2)</a>';

const page = (mark: string, answer: string | null | Error) => {
  const slot = { outerHTML: mark };
  const io = {
    slot: () => slot,
    fetchMark: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)),
  };
  return { slot, io };
};

describe("swapping in the Deploy mark", () => {
  test("the server's mark takes the slot's place", async () => {
    const { slot, io } = page(EMPTY, WAITING);
    await refreshDeployMark(io);
    expect(slot.outerHTML).toBe(WAITING);
  });

  test("an empty mark takes the place of a waiting one", async () => {
    const { slot, io } = page(WAITING, EMPTY);
    await refreshDeployMark(io);
    expect(slot.outerHTML).toBe(EMPTY);
  });

  test("an answer that is not the mark, or none at all, leaves the slot as it is", async () => {
    for (const answer of [null, "<p>error</p>", new Error("offline")]) {
      const { slot, io } = page(EMPTY, answer);
      await refreshDeployMark(io);
      expect(slot.outerHTML).toBe(EMPTY);
    }
  });
});
