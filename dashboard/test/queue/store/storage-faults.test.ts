// The registry of store files the board could not read or write: one
// entry per file, replaced by the next fault on that file, and gone once
// a write to it succeeds.

import { afterEach, describe, expect, test } from "bun:test";
import {
  clearAllStorageFaults,
  clearStorageFault,
  setStorageFault,
  storageFaults,
  storageReason,
} from "../../../src/queue/store/storage-faults.ts";

afterEach(() => clearAllStorageFaults());

describe("storage faults", () => {
  test("one fault per file: a later fault on the same file replaces the earlier one, and clearing removes it (AC-3)", () => {
    setStorageFault({ file: "/state/queue.json", store: "queue", action: "read", reason: "EACCES: permission denied" });
    setStorageFault({ file: "/state/execution-groups.json", store: "groups", action: "write", reason: "ENOSPC: no space left on device" });
    setStorageFault({ file: "/state/queue.json", store: "queue", action: "write", reason: "EISDIR: illegal operation on a directory" });
    expect(storageFaults()).toEqual([
      { file: "/state/queue.json", store: "queue", action: "write", reason: "EISDIR: illegal operation on a directory" },
      { file: "/state/execution-groups.json", store: "groups", action: "write", reason: "ENOSPC: no space left on device" },
    ]);
    clearStorageFault("/state/queue.json");
    expect(storageFaults().map((fault) => fault.file)).toEqual(["/state/execution-groups.json"]);
  });

  test("the reason is the error's own message, with the system's code first (AC-3)", () => {
    const error = Object.assign(new Error("EACCES: permission denied, open '/state/queue.json'"), { code: "EACCES" });
    expect(storageReason(error)).toBe("EACCES: permission denied, open '/state/queue.json'");
    expect(storageReason(Object.assign(new Error("permission denied"), { code: "EACCES" }))).toBe("EACCES: permission denied");
    expect(storageReason("not a list")).toBe("not a list");
  });
});
