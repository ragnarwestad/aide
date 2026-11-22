// A project's Hide: a setting of the board, not of the project. Kept beside
// the board's checkouts of the project, `<base>/<project>/hidden`, present
// while the project is hidden — never inside either clone, so nothing is
// committed. A hidden project is left out of every list where a project is
// chosen, and no new job is queued for it.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeAtomically } from "./settings-state.ts";

const hiddenFile = (base: string, project: string): string => join(base, project, "hidden");

/** Whether the project is hidden. A base that is not there reads as shown. */
export function isHidden(base: string, project: string): boolean {
  return existsSync(hiddenFile(base, project));
}

/** Hide the project, or show it; showing one that is shown is no error. */
export function setHidden(base: string, project: string, on: boolean): void {
  if (on) writeAtomically(hiddenFile(base, project), "");
  else rmSync(hiddenFile(base, project), { force: true });
}

/** The hidden ones among `projects`. */
export function hiddenOf(base: string, projects: Iterable<string>): Set<string> {
  return new Set([...projects].filter((p) => isHidden(base, p)));
}
