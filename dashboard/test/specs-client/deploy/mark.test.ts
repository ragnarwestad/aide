import { Window } from "happy-dom";
// The header's Deploy mark, swapped in when the event stream says it changed.
import { afterEach, describe, expect, test } from "bun:test";
import { refreshDeployMark, syncDeployControls } from "../../../src/specs-client/deploy/mark.ts";
import {
  deployMark, deployMarkAnswer, setDeployWaiting,
} from "../../../src/render/ui/deploy-mark/index.ts";

const answer = (commits: number | undefined): string => {
  setDeployWaiting(commits === undefined ? () => undefined : () => ({ project: "aide", commits, branch: "main" }));
  return deployMarkAnswer("en");
};

const page = (mark: string, answer: string | null | Error, existing: string[] = []) => {
  const slot = { outerHTML: mark };
  const added: string[] = [];
  const io = {
    slot: () => slot,
    fetchMark: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)),
    hasElement: (id: string) => existing.includes(id),
    addDialog: (html: string) => added.push(html),
  };
  return { added, slot, io };
};

afterEach(() => setDeployWaiting(undefined));

describe("swapping in the Deploy mark", () => {
  test("the three server states take the slot's place without navigating (AC-6)", async () => {
    const empty = answer(undefined);
    const waitingAnswer = answer(2);
    const waiting = deployMark("en", { project: "aide", commits: 2, branch: "main" });
    const current = page(empty, waitingAnswer);
    await refreshDeployMark(current.io);
    expect(current.slot.outerHTML).toBe(waiting);

    const upToDate = answer(0);
    current.io.fetchMark = () => Promise.resolve(upToDate);
    await refreshDeployMark(current.io);
    expect(current.slot.outerHTML).toBe(deployMark("en", { project: "aide", commits: 0, branch: "main" }));

    current.io.fetchMark = () => Promise.resolve(empty);
    await refreshDeployMark(current.io);
    expect(current.slot.outerHTML).toBe(empty);
  });

  test("adds the waiting question once to an open page (AC-1)", async () => {
    const empty = answer(undefined);
    const waitingAnswer = answer(2);
    const { added, io } = page(empty, waitingAnswer);
    await refreshDeployMark(io);
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("<dialog");

    const present = page(empty, waitingAnswer, ["deploymarkask"]);
    await refreshDeployMark(present.io);
    expect(present.added).toHaveLength(0);
  });

  test("an answer without a question removes no existing question (AC-1)", async () => {
    const waiting = deployMark("en", { project: "aide", commits: 2, branch: "main" });
    const { added, io } = page(waiting, answer(0), ["deploymarkask"]);
    await refreshDeployMark(io);
    expect(added).toHaveLength(0);
  });

  test("an answer that is not the mark, or none at all, leaves the slot as it is", async () => {
    for (const answer of [null, "<p>error</p>", new Error("offline")]) {
      const empty = deployMark("en", undefined);
      const { slot, io } = page(empty, answer);
      await refreshDeployMark(io);
      expect(slot.outerHTML).toBe(empty);
    }
  });
});

test("a live Deploy state disables the page control and restores only controls ready to deploy", async () => {
  const win = new Window();
  try {
    const doc = win.document;
    doc.body.innerHTML = `<button data-deploy-project="aide" data-deploy-ready="true">Deploy</button><button data-deploy-project="other" data-deploy-ready="false" disabled>Deploy</button>`;
    const own = doc.querySelector("button")!;
    const other = doc.querySelectorAll("button")[1]!;
    for (const underWay of ["queued", "running"] as const) {
      syncDeployControls(doc as unknown as Document, deployMark("en", { project: "aide", commits: 2, branch: "main", underWay }));
      expect(own.disabled).toBe(true);
      expect(other.disabled).toBe(true);
    }
    syncDeployControls(doc as unknown as Document, deployMark("en", { project: "aide", commits: 2, branch: "main" }));
    expect(own.disabled).toBe(false);
    expect(other.disabled).toBe(true);
    syncDeployControls(doc as unknown as Document, deployMark("en", { project: "aide", commits: 0, branch: "main" }));
    expect(own.disabled).toBe(true);
  } finally { await win.happyDOM.close(); }
});
