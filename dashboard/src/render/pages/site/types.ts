// The site's own view types.

import type { SpecView, ProjectView } from "../../../project/discover.ts";
import type { ScheduleEntry } from "../../../project/parse-manifest.ts";
import type { Language } from "../../../i18n";

export type { SpecView, ProjectView };

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
  /** The project's own name for its default branch, off `origin/HEAD`
   *  — so the Code-landing choice reads "Merge into main" (or `master`)
   *  rather than naming a term from GitHub's settings that is nowhere
   *  on this page. Absent when the checkout could not be asked. */
  defaultBranch?: string;
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
  /** This process's own boot-time commit vs. this checkout's current
   *  HEAD (spec 269) — undefined for every project except the one this
   *  server is actually running from. */
  serving?: {
    sha: string;
    checkoutHead: string;
    current: boolean;
    /** REQ-7 (spec 392): the checkout HEAD's own commit subject — only
     *  fetched (and only ever rendered) while origin itself has not
     *  been checked yet; `undefined` when git could not answer, never a
     *  guess. */
    newestSubject?: string;
    /** REQ-7 (spec 392): commits between the served SHA and the
     *  checkout HEAD, local to this checkout — never origin's drift
     *  count, which this state by definition does not have.
     *  `undefined` when `current` (there is nothing to count) or when
     *  git could not answer. */
    behindCount?: number;
  };
  /** Non-empty while a Deploy press's restart is held back by these
   *  running jobs (spec 385) — undefined everywhere `serving` is. */
  restartWaiting?: string[];
  /** Which tab is open, off the request's own `?tab=` (spec 293) — the
   *  same URL-driven pattern `ScheduleDetailPageOptions.tab` already
   *  uses, and for the same reason: this page reloads on a timer, so a
   *  tab held only in client state would snap back to the default on
   *  every reload. */
  tab?: string;
  /** Spec 408. Absent means English — the same default `pageShell`'s
   *  own `opts.lang` falls back to. */
  lang?: Language;
  /** Spec 435. The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page and tab. */
  currentUrl?: string;
}
