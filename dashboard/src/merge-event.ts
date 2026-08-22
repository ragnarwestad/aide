// Spec 158: telling claude-usage that a branch landed.
//
// claude-usage builds its shipping-pipeline ledger out of transcripts —
// a `gh pr merge` in a Bash tool_use is what makes a merge visible to
// it. Since spec 149 this dashboard merges in its own Bun process, so
// there is no transcript and no text to recognise: the ledger can never
// answer "was this merge reviewed?" about our work unless the dashboard
// SAYS what it did.
//
// The payload is deliberately flat and self-describing — named fields,
// an ISO 8601 timestamp, no nesting — because the receiving end does not
// exist yet. `pipeline_event` is keyed on a transcript uuid and a
// session id, neither of which a machine-made merge has, so the ingest
// contract is claude-usage's to settle; this is the sending half,
// written to be readable by whatever accepts it.

/** One merge, as the dashboard saw it happen. */
export interface MergeEvent {
  project: string;
  specFolder: string;
  branch: string;
  repoRoot: string;
  /** Which workflow step's landing this was: `create`, `analyze`,
   *  `resolve` or `archive`. Typed `string` rather than
   *  `WorkflowStep`: it crosses into claude-usage's domain, where our
   *  union is not a type anyone can hold. */
  step: string;
  jobId: string;
  timestamp: string;
}

export interface MergeEventReporterOptions {
  /** Absent means no reports are sent — the whole feature is off. */
  url?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Opt-in and inert without a URL, the way `AIDE_RUN_URL` and
 *  `aide-emit-run` already are on the client side: a dashboard nobody
 *  has pointed at a claude-usage behaves exactly as it did before.
 *
 *  A failed report is never fatal. The merge already happened, so a
 *  refusal or a timeout is reported beside it and swallowed — the same
 *  rule `installAfterMerge` keeps in `serve.ts`. Bounded by one short
 *  timeout, with no retry: this runs on the merge-success path for every
 *  landing in the queue, and an unreachable sink must cost that path
 *  once, not three times. */
export class MergeEventReporter {
  private readonly url?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: MergeEventReporterOptions = {}) {
    this.url = opts.url || undefined;
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 1500;
  }

  get configured(): boolean {
    return !!this.url;
  }

  async report(event: MergeEvent): Promise<void> {
    if (!this.url) return;
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        console.error(`merge-event: ${this.url} refused the report (${res.status})`);
      }
    } catch (err) {
      console.error(
        `merge-event: could not reach ${this.url} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
