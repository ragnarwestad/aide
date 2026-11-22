// A project's Pin: a setting of the board, not of the project. Kept beside
// the board's checkouts of the project, `<base>/<project>/pinned`, present
// while the project is pinned — never inside either clone, so nothing is
// committed. Every project list draws the pinned ones first.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeAtomically } from "./settings-state.ts";

const pinFile = (base: string, project: string): string => join(base, project, "pinned");

/** Whether the project is pinned. A base that is not there reads as not. */
export function isPinned(base: string, project: string): boolean {
  return existsSync(pinFile(base, project));
}

/** Pin the project, or unpin it; unpinning one that is not pinned is no error. */
export function setPinned(base: string, project: string, on: boolean): void {
  if (on) writeAtomically(pinFile(base, project), "");
  else rmSync(pinFile(base, project), { force: true });
}

/** The pinned ones among `projects`. */
export function pinnedOf(base: string, projects: Iterable<string>): Set<string> {
  return new Set([...projects].filter((p) => isPinned(base, p)));
}

/** Pinned ones first; each group keeps the order `list` already had. */
export function pinnedFirst<T>(list: readonly T[], pinned: ReadonlySet<string>, name: (t: T) => string): T[] {
  return [...list.filter((t) => pinned.has(name(t))), ...list.filter((t) => !pinned.has(name(t)))];
}
