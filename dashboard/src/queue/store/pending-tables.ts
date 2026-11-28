// The choices a reader made for a spec before any job exists, on disk: the
// model and provider picked per step, and the phases ticked. They follow
// the queue file's rules: a missing file is a first start; one that cannot
// be read or parsed is reported and not written for the life of the
// process; a save that fails is reported and refused, so the caller keeps
// memory as it was.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { requestRefusal, type RequestRefusal } from "../../format/request-fixes.ts";
import { parsePendingModels, parsePendingSteps } from "../persist.ts";
import { legacyProviders, parsePendingChoices, serializePendingChoices } from "./pending-format.ts";
import {
  clearStorageFault,
  isMissing,
  removeTemp,
  setStorageFault,
  storageReason,
  type StorageFault,
} from "./storage-faults.ts";

type Table = Record<string, Record<string, string>>;

/** One pending-choice file. A failed read of it, or of a file read on its
 *  behalf, locks it: every later save is refused and nothing is written. */
export class PendingFile {
  private lock?: StorageFault;

  constructor(readonly path: string | undefined) {}

  /** Whether a failed read has stopped every save to this file. */
  get locked(): boolean {
    return this.lock !== undefined;
  }

  /** What `file` (this one unless named) holds; undefined when there is no
   *  path, no file, or a file that could not be used — the last a read fault. */
  read<T>(parse: (raw: unknown) => T | null, file = this.path): T | undefined {
    if (!file) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf-8"));
    } catch (error) {
      if (!isMissing(error)) this.readFault(file, storageReason(error));
      return undefined;
    }
    const parsed = parse(raw);
    if (parsed === null) this.readFault(file, "not a table of pending choices");
    return parsed ?? undefined;
  }

  /** Writes `value`, tmp-then-renamed; the refusal when it is not on disk. */
  save(value: unknown): RequestRefusal | undefined {
    if (!this.path) return undefined;
    if (this.lock) {
      return requestRefusal(
        `${this.lock.file} could not be read (${this.lock.reason}), so the choice was not saved`,
        "Fix or move the file on the serving host, then restart the board",
      );
    }
    const temp = `${this.path}.tmp`;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(temp, JSON.stringify(value, null, 2));
      renameSync(temp, this.path);
    } catch (error) {
      removeTemp(temp);
      const reason = storageReason(error);
      setStorageFault({ file: this.path, store: "pending", action: "write", reason });
      return requestRefusal(
        `${this.path} could not be saved (${reason}), so the choice was not saved`,
        "Fix the folder on the serving host, then make the choice again",
      );
    }
    clearStorageFault(this.path);
    return undefined;
  }

  private readFault(file: string, reason: string): void {
    this.lock = { file, store: "pending", action: "read", reason };
    setStorageFault(this.lock);
  }
}

/** Where the older layout kept the providers picked beside the models. */
export const pendingProvidersPath = (modelsPath: string | undefined): string | undefined =>
  modelsPath ? join(dirname(modelsPath), "pending-providers.json") : undefined;

/** The models and providers, into the two tables. A file in the older
 *  layout takes its providers from the file beside it, read through the
 *  same lock, so an unreadable providers file stops every later save. */
export function loadPendingChoices(file: PendingFile, models: Table, providers: Table): void {
  const read = file.read(parsePendingChoices);
  if (!read) {
    // No models file: a providers file left beside it is still checked, so
    // the save that would remove it cannot remove one it could not read.
    if (!file.locked) file.read(parsePendingModels, pendingProvidersPath(file.path));
    return;
  }
  Object.assign(models, read.models);
  if (!read.legacy) {
    Object.assign(providers, read.providers);
    return;
  }
  const beside = file.read(parsePendingModels, pendingProvidersPath(file.path));
  if (beside) Object.assign(providers, legacyProviders(read.models, beside));
}

/** Both tables in one rename; once that is on disk the older layout's
 *  providers file is stale and goes. */
export function savePendingChoices(file: PendingFile, models: Table, providers: Table): RequestRefusal | undefined {
  const refused = file.save(serializePendingChoices(models, providers));
  const stale = pendingProvidersPath(file.path);
  if (!refused && stale) {
    try {
      rmSync(stale, { force: true });
    } catch {
      // Never read beside a versioned file, so a copy left behind is harmless.
    }
  }
  return refused;
}

export const loadPendingSteps = (file: PendingFile, into: Record<string, string[]>): void => {
  const read = file.read(parsePendingSteps);
  if (read) Object.assign(into, read);
};
