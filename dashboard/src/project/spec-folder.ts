// A spec folder's own two readings: the whole name, which is its
// address — the branch, the commit subjects, the gate log all use it —
// and the number, which is what a person says out loud and what the
// board's own rows show.
//
// It lives here rather than in the render layer because the queue names
// a dependency too, and a message that reads one way on the row and
// another in the queue's own record is the drift this file exists to
// prevent.

import { isSpecFolder } from "./spec-names.ts";

/** The leading number of a spec folder — `92-a-spec-can-depend` is 92.
 *  A value that does not open with one is shown whole: a dependency may
 *  be written as a bare number already, and anything else is better
 *  said in full than silently truncated. */
export function specNumber(folder: string): string {
  return isSpecFolder(folder) ? folder.slice(0, folder.indexOf("-")) : folder;
}

/** A dependency is identified by its project and short spec number. */
export function specReference(project: string, folder: string): string {
  return `${project}:${specNumber(folder)}`;
}
