// The site's own view types. Split out of site.ts by theme (split
// site.ts by theme).

import type { SpecRef } from "../../../project/discover.ts";
import type { StatusInfo } from "../../../project/parse-status.ts";
import type { ManifestResult, ScheduleEntry } from "../../../project/parse-manifest.ts";

export interface SpecView extends SpecRef {
  status: StatusInfo | null;
}

export interface ProjectView {
  name: string;
  manifest: ManifestResult;
  specs: SpecView[];
}

export interface Page {
  path: string;
  html: string;
}

/** The last drift answer the server holds for a project (spec 203).
 *  `checkedAt` is `null` only where nothing has ever been asked — a
 *  fresh boot, or a project just added; `behind: null` with a real
 *  `checkedAt` is the fail-open case, asked and unanswerable. */
export interface ProjectDrift {
  behind: number | null;
  checkedAt: number | null;
}

/** And what a project's row says for a check the schedule has not
 *  reached yet. A count nobody has taken is not zero. */
export const UNCHECKED_NOTE = "origin drift not checked yet";

export interface ProjectPageOptions {
  token?: string;
  script?: string;
  codeLanding?: "merge" | "pr";
  /** This project's own recurring jobs (spec 259). Absent or empty
   *  means no Schedule section renders at all. */
  schedule?: readonly ScheduleEntry[];
  worktreeLinkCandidates: string[];
  /** From the request's own `?edit=1` (spec 255) — never stored, so a
   *  page reload with no query string always lands back on the
   *  read-only view. */
  editing: boolean;
  error?: string;
  /** This checkout's last drift answer (spec 258), `undefined` when no
   *  `AIDE_INSTALL_CMD` is configured — the same gate `/projects`' own
   *  drift map uses. */
  drift?: ProjectDrift;
  /** Why the last Deploy press was refused, or what its install step
   *  reported — carried back in the query string, like `error`. */
  deployError?: string;
}
