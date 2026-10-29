// The site's own view types.

import type { SpecView, ProjectView } from "../../../project/discover";
import type { ScheduleEntry } from "../../../queue/schedule.ts";
import type { Language } from "../../../i18n";
import type { PreviewFrom } from "../../../project/parse-manifest.ts";
import type { SettingsGroupFile } from "../../../project/project-settings.ts";

export type { SpecView, ProjectView };

export interface Page {
  path: string;
  html: string;
}

/** The last drift answer the server holds for a project.
 *  `checkedAt` is `null` only where nothing has ever been asked — a
 *  fresh boot, or a project just added; `behind: null` with a real
 *  `checkedAt` is the fail-open case, asked and unanswerable. */
export interface ProjectDrift {
  behind: number | null;
  checkedAt: number | null;
}

export interface ProjectPageOptions {
  /** The project's own name for its default branch, off `origin/HEAD`
   *  — so the Code-landing choice reads "Merge into main" (or `master`)
   *  rather than naming a term from GitHub's settings that is nowhere
   *  on this page. Absent when the checkout could not be asked. */
  defaultBranch?: string;
  script?: string;
  codeLanding?: "merge" | "pr";
  /** How a spec's branch can be tried, as `resolvePreviewFrom()` reads
   *  it. Absent reads as `none`. */
  previewFrom?: PreviewFrom;
  /** Where the settings are kept, so the page says so above
   *  the table. Absent for a page built with no checkout to ask. */
  settingsHome?: "project" | "dashboard" | "shadowed" | "none";
  /** This project's own recurring jobs. Absent or empty
   *  means no Schedule section renders at all. */
  schedule?: readonly ScheduleEntry[];
  /** The Schedule tab's `?sort=` and `?dir=`, as the address gave them. */
  scheduleSort?: { sort?: string; dir?: "asc" | "desc" };
  /** The models the queue offers, for the flag on an entry naming one it
   *  does not. Absent draws no flag. */
  scheduleModelNames?: readonly string[];
  worktreeLinkCandidates: string[];
  /** From the request's own `?edit=` (names one of
   *  the Config tab's two tables, not a shared boolean) — never
   *  stored, so a page reload with no query string always lands back on
   *  the read-only view. */
  editingGroup: SettingsGroupFile | null;
  /** Where "← Back" goes: the page the reader came from, resolved by the
   *  server from the request's `Referer`. Projects when there is none. */
  backHref?: string;
  /** This checkout's last drift answer. `undefined` for the
   *  board's own project when no `AIDE_INSTALL_CMD` is configured, since
   *  its Deploy has nothing to act on then; every other project has one. */
  drift?: ProjectDrift;
  /** The step the board's last deploy job failed at and why, kept by the
   *  server until the next deploy starts. */
  deployFailure?: { step: string; error: string };
  /** This process's own boot-time commit vs. this checkout's current
   *  HEAD — undefined for every project except the one this
   *  server is actually running from. */
  serving?: {
    sha: string;
    checkoutHead: string;
    current: boolean;
    /** The checkout HEAD's own commit subject — only
     *  fetched (and only ever rendered) while origin itself has not
     *  been checked yet; `undefined` when git could not answer, never a
     *  guess. */
    newestSubject?: string;
    /** Commits between the served SHA and the
     *  checkout HEAD, local to this checkout — never origin's drift
     *  count, which this state by definition does not have.
     *  `undefined` when `current` (there is nothing to count) or when
     *  git could not answer. */
    behindCount?: number;
  };
  /** Non-empty while a Deploy press's restart is held back by these
   *  landings in flight — undefined everywhere `serving` is. */
  restartWaiting?: string[];
  /** This project is the checkout the board runs from, so its Deploy asks
   *  first and queues a job. Every other project is offered no Deploy. */
  boardItself?: boolean;
  /** The state of the board's deploy job while one is queued or running. */
  deployUnderWay?: "queued" | "running";
  /** Whether this project's own machinery checkout carries the
   *  dashboard's source (`ctx.testServers.previewAvailable`) — the same
   *  capability check the spec-page's test-server link already gates on.
   *  Undefined only where the test-servers context was never wired (should not
   *  happen outside a test that omits it on purpose). */
  testServerAvailable?: boolean;
  /** Which tab is open, off the request's own `?tab=` — the
   *  same URL-driven pattern `ScheduleDetailPageOptions.tab` already
   *  uses, and for the same reason: this page reloads on a timer, so a
   *  tab held only in client state would snap back to the default on
   *  every reload. */
  tab?: string;
  /** Absent means English — the same default `pageShell`'s
   *  own `opts.lang` falls back to. */
  lang?: Language;
  /** The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page and tab. */
  currentUrl?: string;
}
