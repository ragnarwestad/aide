// The three read-only spec views every route needs a version of: the
// archived list's own rows, one spec page, one job's detail page. Split
// out of serve.ts (split serve.ts by theme, restructuring createServer
// into staged setup functions to get it under 500 lines).
//
// `SpecViewsContext` already carries everything these three read — it
// is `spec-views.ts`'s own type — so this stage is the thin wrapper
// that closes each of the three impls over one built context, the same
// shape `job-row.ts`'s own wrapper in `setup-land.ts` already is.

import type { Job } from "../queue/queue.ts";
import {
  archivedSpecRows as archivedSpecRowsImpl,
  specPageView as specPageViewImpl,
  jobDetailView as jobDetailViewImpl,
  type SpecViewsContext,
} from "./spec-views.ts";

export function setupSpecViews(ctx: SpecViewsContext) {
  function archivedSpecRows(state: string | undefined) {
    return archivedSpecRowsImpl(ctx, state);
  }
  function specPageView(project: string, specFolder: string, tab?: string) {
    return specPageViewImpl(ctx, project, specFolder, tab);
  }
  function jobDetailView(job: Job) {
    return jobDetailViewImpl(ctx, job);
  }
  return { archivedSpecRows, specPageView, jobDetailView };
}
