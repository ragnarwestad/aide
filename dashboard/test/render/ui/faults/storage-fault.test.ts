// A store file the board could not read or write is named at the top of
// every page, with the reason, in the sentence that says what it left
// behind.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headerNotices } from "../../../../src/render/ui/header-notices.ts";
import { esc } from "../../../../src/render/ui/html.ts";
import { t } from "../../../../src/i18n";
import { QueueStore } from "../../../../src/queue/queue.ts";
import { clearAllStorageFaults, setStorageFault, type StorageFault } from "../../../../src/queue/store/storage-faults.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aide-storage-fault-")); });
afterEach(() => {
  clearAllStorageFaults();
  rmSync(dir, { recursive: true, force: true });
});

const resolve = () => ({ specFolders: ["81-queue-and-runner"] });
const DEFAULTS = { timeoutSec: { default: 60 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } };

type FaultKey = "shell.storageFaultRead" | "shell.storageFaultQueueWrite" | "shell.storageFaultGroupWrite" | "shell.storageFaultPendingWrite";
const sentence = (key: FaultKey, fault: StorageFault) => esc(t("en", key, { file: fault.file, reason: fault.reason }));

describe("headerNotices: a storage fault", () => {
  test("each kind of fault shows the sentence for what it left behind, naming the file and the reason (AC-2, AC-3)", () => {
    const read: StorageFault = { file: "/state/queue.json", store: "queue", action: "read", reason: "not a JSON list" };
    const queueWrite: StorageFault = { file: "/state/other-queue.json", store: "queue", action: "write", reason: "ENOSPC: no space left on device" };
    const groupWrite: StorageFault = { file: "/state/execution-groups.json", store: "groups", action: "write", reason: "EACCES: permission denied" };
    for (const fault of [read, queueWrite, groupWrite]) setStorageFault(fault);
    const html = headerNotices("en");
    expect(html.match(/storage-fault/g)?.length).toBe(3);
    expect(html).toContain(sentence("shell.storageFaultRead", read));
    expect(html).toContain(sentence("shell.storageFaultQueueWrite", queueWrite));
    expect(html).toContain(sentence("shell.storageFaultGroupWrite", groupWrite));
  });

  test("a pending-choice file that could not be saved shows the pending write sentence (AC-2)", () => {
    const fault: StorageFault = { file: "/state/pending-models.json", store: "pending", action: "write", reason: "EACCES: permission denied" };
    setStorageFault(fault);
    expect(headerNotices("en")).toContain(sentence("shell.storageFaultPendingWrite", fault));
  });

  test("a queue file that cannot be read is in the header from the moment the store is built (AC-2)", () => {
    const mirrorPath = join(dir, "queue.json");
    mkdirSync(mirrorPath);
    const queue = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(queue.storage.fault).toMatchObject({ file: mirrorPath, store: "queue", action: "read" });
    const html = headerNotices("en");
    expect(html).toContain("storage-fault");
    expect(html).toContain(esc(mirrorPath));
  });

  test("a failed queue write shows the queue's write sentence, and a later successful write takes it away (AC-3)", () => {
    const mirrorPath = join(dir, "queue.json");
    const queue = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    mkdirSync(mirrorPath);
    expect(queue.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] }).ok).toBe(true);
    const fault = queue.storage.fault!;
    expect(headerNotices("en")).toContain(sentence("shell.storageFaultQueueWrite", fault));
    rmSync(mirrorPath, { recursive: true });
    queue.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] });
    expect(headerNotices("en")).not.toContain("storage-fault");
  });
});
