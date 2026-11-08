// FSEvents hands a fresh recursive watcher the changes made in the
// moments before it opened. A server started right after something wrote
// in a specs root then told every open page that something changed, when
// nothing had since it started.

import { statSync } from "node:fs";
import { join } from "node:path";

/** True when the watched `filename` under `root` was last changed before
 *  the watch opened at `openedAt` (epoch ms): an echo, not news. A path
 *  that is gone — the source side of a move, a deletion — or one the
 *  watch could not name is always news. */
export function isEcho(root: string, filename: string | null, openedAt: number): boolean {
  if (!filename) return false;
  try {
    const st = statSync(join(root, filename));
    return Math.max(st.mtimeMs, st.ctimeMs) < openedAt;
  } catch {
    return false;
  }
}
