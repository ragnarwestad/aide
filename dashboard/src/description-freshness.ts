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

/** The last commit touching `pathspec` — which one, and when — or null
 *  if git cannot say. Scoped to ONE path on purpose: a plan-merge commit
 *  touches 2-analysis.md, 3-solution.md and 4-status.md but never the
 *  description, and a folder-wide log would read every such merge as a
 *  description edit.
 *
 *  The SHA comes back as well as the time because the spec page stamps
 *  each of the four files with the version on the screen (spec 150), and
 *  "which version" is what a stamp is for. The freshness check below
 *  wants only the time, and asks through `lastCommitAt` — one git shape
 *  for one question, whichever half of the answer the caller uses. */
export async function lastCommitOf(
  run: GitRunner,
  dir: string,
  pathspec: string,
): Promise<{ sha: string; at: string } | null> {
  const out = await run(dir, ["log", "-1", "--format=%H%x09%aI", "--", pathspec]);
  if (out.code !== 0) return null;
  const [sha, at] = out.stdout.trim().split("\t");
  return sha && at ? { sha, at } : null;
}

/** When the FIRST commit touching `pathspec` was authored — when the
 *  spec began (spec 199).
 *
 *  The Started column used to hold the most recent run's own start, so
 *  a spec jumped to the top of a list sorted by it every time a phase
 *  ran. The date it holds instead cannot come from the queue: the job
 *  store is an LRU of 200, so a spec older than that has no record of
 *  its own beginning left. Git keeps one for years.
 *
 *  **Not `-1 --reverse`.** `-1` limits the commit SELECTION, which runs
 *  newest-first, and `--reverse` only turns the already-limited output
 *  round — so the two together still answer with the newest commit. The
 *  oldest is the last line of the unlimited log, which is why this one
 *  reads the whole list where `lastCommitOf` above takes `-1`. Reading
 *  a full history without `-1` is not a new cost shape here:
 *  `lastAnalyzeCommit` already does it. */
export async function firstCommitAt(
  run: GitRunner,
  dir: string,
  pathspec: string,
): Promise<string | null> {
  const out = await run(dir, ["log", "--format=%aI", "--", pathspec]);
  if (out.code !== 0) return null;
  const lines = out.stdout.trim().split("\n").filter(Boolean);
  return lines.length ? lines[lines.length - 1]!.trim() : null;
}

/** When the last commit touching `pathspec` was authored. */
export async function lastCommitAt(
  run: GitRunner,
  dir: string,
  pathspec: string,
): Promise<string | null> {
  return (await lastCommitOf(run, dir, pathspec))?.at ?? null;
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
export interface AnalyzeCommit {
  /** The commit itself, so the description can be compared against the
   *  version that run actually read. */
  sha: string;
  at: string;
}

export async function lastAnalyzeCommit(
  run: GitRunner,
  dir: string,
  specFolder: string,
): Promise<AnalyzeCommit | null> {
  const subject = analyzeSubject(specFolder);
  const out = await run(dir, [
    "log",
    "--format=%H%x09%aI%x09%s",
    "--fixed-strings",
    `--grep=${subject}`,
  ]);
  if (out.code !== 0) return null;
  for (const line of out.stdout.split("\n")) {
    const [sha, at, ...rest] = line.split("\t");
    if (!sha || !at || rest.length === 0) continue;
    if (rest.join("\t") === subject) return { sha, at };
  }
  return null;
}

/** Does the description SAY anything the analyze run did not read?
 *
 *  The dates are the cheap gate, not the answer. A description can be
 *  rewritten to exactly what it was — a section added and taken out
 *  again, a typo fixed, a `Depends on:` line tried and dropped — and
 *  the commit is newer every time while the file says the same thing.
 *  Seen on spec 132 (2026-08-20): two commits after the analysis, and
 *  `git diff` against the analyzed version was empty.
 *
 *  `--quiet` implies `--exit-code`: 0 means identical, 1 means
 *  different. Any other code is git failing to answer, and that reads
 *  as "cannot prove staleness" — the same direction every other
 *  unknown in this module takes. */
export async function descriptionDiffers(
  run: GitRunner,
  dir: string,
  analyzedSha: string,
): Promise<boolean> {
  const out = await run(dir, ["diff", "--quiet", analyzedSha, "--", "1-description.md"]);
  return out.code === 1;
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
        const analyzed = await lastAnalyzeCommit(this.run, dir, specFolder);
        // The dates first, because they cost nothing beyond the lookup
        // already made: a description older than the analysis cannot be
        // stale whatever it says. Only when they point the other way is
        // the content worth a third subprocess.
        stale =
          isAnalyzeStale(describedAt, analyzed?.at ?? null) &&
          (await descriptionDiffers(this.run, dir, analyzed!.sha));
      }
    } catch {
      stale = false;
    }

    this.cache.set(key, { at, stale });
    return stale;
  }
}

export interface SpecCreatedAtOptions {
  run: GitRunner;
  ttlMs?: number;
  now?: () => number;
}

/** When each spec was made, cached, shaped exactly like the checker
 *  above it (spec 199) — same TTL, same key, same fail-to-nothing.
 *
 *  It fails to `null`, and deliberately never to a `Job` date. A
 *  job-backed fallback would put back the very thing this change
 *  removes: a job's own start moves every time a phase runs, so a spec
 *  git could not date would go back to jumping up the list. A spec with
 *  no answer shows a dash instead, which is what the page did before
 *  the column meant anything. */
export class SpecCreatedAtChecker {
  private readonly run: GitRunner;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; createdAt: string | null }>();

  constructor(opts: SpecCreatedAtOptions) {
    this.run = opts.run;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  async createdAt(dir: string, specFolder: string): Promise<string | null> {
    // JSON, for the reason the checker above gives: a NUL in a source
    // file makes git treat that file as binary from then on.
    const key = JSON.stringify([dir, specFolder]);
    const hit = this.cache.get(key);
    const at = this.now();
    if (hit && at - hit.at < this.ttlMs) return hit.createdAt;

    let createdAt: string | null = null;
    try {
      // `.` is the spec's OWN folder: `dir` already points at it, the
      // same pairing `archivedAt()` uses for the symmetric question.
      createdAt = await firstCommitAt(this.run, dir, ".");
    } catch {
      createdAt = null;
    }

    this.cache.set(key, { at, createdAt });
    return createdAt;
  }
}
