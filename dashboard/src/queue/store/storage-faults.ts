// The store files the board could not read or write, keyed by file:
// process-lifetime state that `headerNotices()` reads directly, the way
// it reads the checkout faults. Each store writes its own entry and
// clears it once a write to the file succeeds.

import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

export interface StorageFault {
  file: string;
  store: "queue" | "groups";
  action: "read" | "write";
  reason: string;
}

const faults = new Map<string, StorageFault>();

export function setStorageFault(fault: StorageFault): void {
  faults.set(fault.file, { ...fault });
}

export function clearStorageFault(file: string): void {
  faults.delete(file);
}

export function storageFaults(): StorageFault[] {
  return [...faults.values()].map((fault) => ({ ...fault }));
}

/** For tests: the registry outlives every store built in one process. */
export function clearAllStorageFaults(): void {
  faults.clear();
}

/** The reason in a sentence: the error's own message, with the system's
 *  code first (`EACCES: permission denied`). */
export function storageReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  return code && !error.message.startsWith(code) ? `${code}: ${error.message}` : error.message;
}

/** Whether reading `file` failed because it is not there — the one read
 *  failure that means a first start rather than a file to keep. */
export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** Keeps the entries a store could not read in `<file>.rejected.json`,
 *  added to the end of what an earlier boot kept there, so the next
 *  write of `file` does not lose them. Throws when it cannot. */
export function keepRejected(file: string, entries: unknown[]): string {
  const target = `${file}.rejected.json`;
  const earlier = existsSync(target) ? (JSON.parse(readFileSync(target, "utf-8")) as unknown) : [];
  if (!Array.isArray(earlier)) throw new Error(`${target} is not a JSON list`);
  const temp = `${target}.tmp`;
  writeFileSync(temp, `${JSON.stringify([...earlier, ...entries], null, 2)}\n`);
  renameSync(temp, target);
  return target;
}

/** Removes the temporary file a failed write left behind, when it is a
 *  file. Never throws: the write's own failure is what gets reported, and
 *  anything else at that path is left for whoever put it there. */
export function removeTemp(temp: string): void {
  try {
    if (lstatSync(temp).isFile()) rmSync(temp, { force: true });
  } catch {
    // Nothing there, or nothing that can be removed: the write fault stands.
  }
}
