// Spec 97: is the plan still about the problem the description states?
//
// A spec's 1-description.md keeps being edited after `analyze` has run
// — 94 and 96 each gained a paragraph once their plans were merged, 93
// a `Depends on:` line — and the row went on reading `analyze ✓`. The
// only person who knew a re-run was due was the one who made the edit.
//
// The question is put to the SPECS REPO, not to the filesystem and not
// to the queue. Both alternatives were weighed and rejected in the
// spec's own analysis: every run works in a fresh `git worktree`, which
// stamps every file it writes with the time of the checkout, so mtimes
// say nothing about which file was actually edited last; and the
// queue's job store is an LRU on one machine, so an evicted or
// foreign-host run looks exactly like a spec that was never analysed.
// Git is the one record that survives all three.
//
// Nothing here is stored. The answer is derived at render time, like
// the merge check beside it, so a re-run clears the badge without
// anything having to remember it was ever set.

import type { GitRunner } from "./branch-status.ts";

const DEFAULT_TTL_MS = 30_000;

/** The subject `aide-run-spec` writes for a SUCCESSFUL headless run
 *  (`core/scripts/aide-run-spec`, the commit at the end of a step). A
 *  run that stopped appends ` (stopped: <reason>)` to exactly this
 *  string — which is why the match below has to be equality and not a
 *  prefix. */
const analyzeSubject = (specFolder: string): string =>
  `Run /aide-analyze for ${specFolder} (headless)`;

/** When the last commit touching `pathspec` was authored, or null if
 *  git cannot say. Scoped to ONE path on purpose: a plan-merge commit
 *  touches 2-analysis.md, 3-solution.md and 4-status.md but never the
 *  description, and a folder-wide log would read every such merge as a
 *  description edit. */
export async function lastCommitAt(
  run: GitRunner,
  dir: string,
  pathspec: string,
): Promise<string | null> {
  const out = await run(dir, ["log", "-1", "--format=%aI", "--", pathspec]);
  if (out.code !== 0) return null;
  return out.stdout.trim() || null;
}

/** When this spec was last analysed by a run that FINISHED. Narrowed
 *  server-side with a fixed-string grep — cheap on a long history — and
 *  then confirmed by exact equality here, because the success message
 *  is a prefix of the stopped one and a fixed-string grep matches
 *  prefixes. Nothing else distinguishes the two.
 *
 *  `git log` prints newest first, so the first surviving line is the
 *  most recent successful analyze: a re-run simply supersedes the one
 *  that went stale. */
export async function lastAnalyzeCommitAt(
  run: GitRunner,
  dir: string,
  specFolder: string,
): Promise<string | null> {
  const subject = analyzeSubject(specFolder);
  const out = await run(dir, ["log", "--format=%aI%x09%s", "--fixed-strings", `--grep=${subject}`]);
  if (out.code !== 0) return null;
  for (const line of out.stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    if (line.slice(tab + 1) === subject) return line.slice(0, tab);
  }
  return null;
}

/** Strictly newer, and only when BOTH dates are known. An analyze run
 *  interactively is never committed — the git rules leave committing to
 *  the person — so "no analyze commit" means "cannot prove staleness",
 *  never "assume stale": a spec analysed by hand must not wear a badge
 *  that nothing it does can clear. */
export function isAnalyzeStale(descriptionAt: string | null, analyzeAt: string | null): boolean {
  if (!descriptionAt || !analyzeAt) return false;
  const described = Date.parse(descriptionAt);
  const analyzed = Date.parse(analyzeAt);
  if (Number.isNaN(described) || Number.isNaN(analyzed)) return false;
  return described > analyzed;
}

export interface DescriptionFreshnessOptions {
  run: GitRunner;
  /** How long one answer stands. Without it, the five-second refresh of
   *  the list would spawn two git processes per spec on every tick. */
  ttlMs?: number;
  now?: () => number;
}

export class DescriptionFreshnessChecker {
  private readonly run: GitRunner;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; stale: boolean }>();

  constructor(opts: DescriptionFreshnessOptions) {
    this.run = opts.run;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** True only when git can prove the description moved after the last
   *  finished analyze. Everything else — an unreadable checkout, a spec
   *  outside git, a timeout — is false, which leaves the page saying
   *  exactly what it said before this feature existed. */
  async isStale(dir: string, specFolder: string): Promise<boolean> {
    // JSON rather than a separator character, for the reason
    // branch-status.ts gives: a NUL here makes git treat the source
    // file as binary, and every future diff of it pays for that.
    const key = JSON.stringify([dir, specFolder]);
    const hit = this.cache.get(key);
    const at = this.now();
    if (hit && at - hit.at < this.ttlMs) return hit.stale;

    let stale = false;
    try {
      const describedAt = await lastCommitAt(this.run, dir, "1-description.md");
      // No description commit ends it here: the second lookup cannot
      // change the answer, and it costs a subprocess per spec.
      if (describedAt) {
        stale = isAnalyzeStale(describedAt, await lastAnalyzeCommitAt(this.run, dir, specFolder));
      }
    } catch {
      stale = false;
    }

    this.cache.set(key, { at, stale });
    return stale;
  }
}
