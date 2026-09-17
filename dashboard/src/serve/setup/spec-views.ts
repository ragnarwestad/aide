// The three read-only spec views every route needs a version of: the
// archived list's own rows, one spec page, one job's detail page. Split
// out of serve.ts (split serve.ts by theme, restructuring createServer
// into staged setup functions to get it under 500 lines).
//
// `SpecViewsContext` already carries everything these three read — it
// is `spec-views.ts`'s own type — so this stage is the thin wrapper
// that closes each of the three impls over one built context, the same
// shape `job-row.ts`'s own wrapper in `setup/land.ts` already is.

import type { Job } from "../../queue/queue.ts";
import type { LogFilter } from "../../queue/parse-stream";
import {
  archivedSpecRows as archivedSpecRowsImpl,
  specPageView as specPageViewImpl,
  jobDetailView as jobDetailViewImpl,
  type SpecViewsContext,
} from "../spec-views";

export function setupSpecViews(ctx: SpecViewsContext) {
  function archivedSpecRows(state: string | undefined) {
    return archivedSpecRowsImpl(ctx, state);
  }
  function specPageView(project: string, specFolder: string, tab?: string, only?: LogFilter) {
    return specPageViewImpl(ctx, project, specFolder, tab, only);
  }
  function jobDetailView(job: Job, only?: LogFilter) {
    return jobDetailViewImpl(ctx, job, only);
  }
  return { archivedSpecRows, specPageView, jobDetailView };
}
