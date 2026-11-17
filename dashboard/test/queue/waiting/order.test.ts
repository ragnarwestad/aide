import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WaitingQueue } from "../../../src/queue/waiting";
const entries = ["a", "b"].map(id => ({ id, project: "p", label: id, operation: "land", reason: "" }));
test("saved priority survives restart but editing ownership does not", () => {
  const dir = mkdtempSync(join(tmpdir(), "waiting-"));
  try {
    const path = join(dir, "order.json");
    const q = new WaitingQueue({ path });
    q.reconcile(entries);
    const owner = q.open("first");
    q.save(owner, ["b", "a"]);
    const next = new WaitingQueue({ path });
    next.reconcile(entries);
    expect(next.snapshot().entries.map(e => e.id)).toEqual(["b", "a"]);
    expect(next.paused).toBe(false);
    next.open("new");
    expect(() => next.cancel(owner)).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("storage refuses a failed atomic rename", () => {
  const dir = mkdtempSync(join(tmpdir(), "waiting-"));
  try {
    const path = join(dir, "order.json");
    const q = new WaitingQueue({ path });
    q.reconcile(entries);
    const owner = q.open("first");
    rmSync(path);
    mkdirSync(path);
    expect(() => q.save(owner, ["b", "a"])).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
