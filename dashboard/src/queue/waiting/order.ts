import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function loadOrder(path?: string): { order: string[]; revision: number } {
  if (!path || !existsSync(path)) return { order: [], revision: 0 };
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw.order) || raw.order.some((id: unknown) => typeof id !== "string") ||
      new Set(raw.order).size !== raw.order.length || !Number.isSafeInteger(raw.revision)) {
    throw new Error("The saved queue order is invalid");
  }
  return raw;
}

export function writeOrder(path: string, order: string[], revision: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ order, revision }), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
  } finally { rmSync(tmp, { force: true }); }
}

/** Only the first snapshot uses the installation's previous priority policy. */
export function seedOrder<T extends { steps: readonly string[]; stepIndex: number }>(jobs: T[]): T[] {
  const quick = (job: T) => ["create", "archive", "close"].includes(job.steps[job.stepIndex]!);
  return [...jobs].sort((a, b) => Number(quick(b)) - Number(quick(a)));
}
