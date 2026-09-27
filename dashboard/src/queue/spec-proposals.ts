// The file contract between a scheduled job's prompt and the board. A run may
// leave a list of proposed specs beside its report; when the run ends green
// the board queues a Create job for each one that passes. This module holds
// what both sides have to agree on and every decision that needs no queue: the
// two file names, reading the list, judging one proposal against what already
// exists, the source block a description ends with, and the record of what
// happened that the run's page reads.
//
// No git, no render and no queue mutation live here (`propose-specs.ts` does
// the queuing), so the queue layer imports nothing from the pages.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scheduleRunOutputDir } from "./schedule.ts";
import { DESCRIPTION_MAX, TITLE_MAX } from "./parse-request.ts";

/** What a run's prompt writes into its output directory. */
export const PROPOSALS_FILE = "proposed-specs.json";
/** What the board writes beside it once it has acted on the list. */
export const PROPOSALS_RESULT_FILE = "proposed-specs-result.json";

export interface Proposal {
  title: string;
  description: string;
}

/** A spec that exists in the project, and where it lives. */
export interface KnownSpec {
  folder: string;
  title: string | null;
  kind: "active" | "archived" | "closed";
}

/** The part of a job the duplicate check reads. */
export interface PendingCreate {
  id: string;
  state: string;
  createTitle?: string;
}

export type InvalidWhat =
  | "not-an-object"
  | "title-missing"
  | "title-lines"
  | "title-long"
  | "description-missing"
  | "description-long";

export type SkipWhy =
  | { code: "exists"; folder: string; kind: KnownSpec["kind"] }
  | { code: "queued"; jobId: string }
  | { code: "invalid"; what: InvalidWhat; max?: number }
  | { code: "refused" };

export type ProposalResult =
  | { title: string; result: "created"; jobId: string }
  | { title: string; result: "skipped"; why: SkipWhy };

/** A problem with the whole run rather than one proposal. */
export type ProposalsProblem = "unreadable" | "no-specs-root" | "failed";

export interface ProposalsRecord {
  at: string;
  problem?: ProposalsProblem;
  detail?: string;
  proposals: ProposalResult[];
}

/** The states in which a Create job means a spec is on its way or landed. A
 *  failed, cancelled or interrupted one made none; a stopped one lands what it
 *  had committed, and the spec is then found on disk. */
const BLOCKING_STATES = new Set(["queued", "running", "done"]);

/** The list a run left, or why it cannot be read. Each entry is judged later,
 *  one at a time, so one bad entry does not cost the others. */
export function parseProposalsFile(text: string): { entries: unknown[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (!Array.isArray(parsed)) return { error: "the file is JSON, but not a list" };
  return { entries: parsed };
}

/** Two titles are the same when they are equal after trimming, collapsing
 *  whitespace and lowercasing. Not a comparison of folder slugs: a slug is
 *  computed by one shell function and nowhere else. */
export function titleKey(title: string): string {
  return title.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** What a description may hold once the source block and the blank line before
 *  it are added. */
export function descriptionRoom(block: string): number {
  return DESCRIPTION_MAX - block.length - 2;
}

const oneOf = (v: unknown): string => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "");

/** Judge one entry of the list. `room` is what `descriptionRoom` gave. The
 *  first rule that applies decides: a malformed entry, then a spec of the
 *  project with the same title, then a Create job with the same title. */
export function checkProposal(
  entry: unknown,
  room: number,
  known: readonly KnownSpec[],
  jobs: readonly PendingCreate[],
): { ok: true; proposal: Proposal } | { ok: false; title: string; why: SkipWhy } {
  const obj = entry !== null && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
  const title = oneOf(obj?.title);
  const skip = (why: SkipWhy) => ({ ok: false as const, title, why });
  if (!obj) return skip({ code: "invalid", what: "not-an-object" });
  if (!title) return skip({ code: "invalid", what: "title-missing" });
  if (title.includes("\n")) return skip({ code: "invalid", what: "title-lines" });
  if (title.length > TITLE_MAX) return skip({ code: "invalid", what: "title-long", max: TITLE_MAX });
  const description = oneOf(obj.description);
  if (!description) return skip({ code: "invalid", what: "description-missing" });
  if (description.length > room) return skip({ code: "invalid", what: "description-long", max: room });

  const key = titleKey(title);
  const existing = known.find((s) => s.title !== null && titleKey(s.title) === key);
  if (existing) return skip({ code: "exists", folder: existing.folder, kind: existing.kind });
  const pending = jobs.find((j) => BLOCKING_STATES.has(j.state) && j.createTitle !== undefined && titleKey(j.createTitle) === key);
  if (pending) return skip({ code: "queued", jobId: pending.id });
  return { ok: true, proposal: { title, description } };
}

/** The paragraph every proposed spec's description ends with, so a reader can
 *  follow it back to the run. `reportPath` is the run's address on the board,
 *  built where pages are known (this layer cannot import them). */
export function sourceBlock(o: {
  name: string;
  project: string;
  runId: string;
  startedAt: string;
  reportPath: string;
}): string {
  return (
    `### Source\n\n` +
    `Proposed by the scheduled job \`${o.name}\` of project \`${o.project}\`, run \`${o.runId}\`, started ${o.startedAt}.\n` +
    `The run's report: [${o.reportPath}](${o.reportPath})`
  );
}

const runDir = (root: string, project: string, key: string, runId: string): string =>
  scheduleRunOutputDir(root, project, key, runId);

/** The text of the list a run left, or `null` when it left none. */
export function proposalsFileText(root: string, project: string, key: string, runId: string): string | null {
  const file = join(runDir(root, project, key, runId), PROPOSALS_FILE);
  try {
    return existsSync(file) ? readFileSync(file, "utf-8") : null;
  } catch {
    return null;
  }
}

/** The record of what the board did with a run's list, or `null` when it did
 *  nothing (no list, a run that was not green) or the file is not a record. */
export function readProposalsRecord(root: string, project: string, key: string, runId: string): ProposalsRecord | null {
  const file = join(runDir(root, project, key, runId), PROPOSALS_RESULT_FILE);
  try {
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, "utf-8")) as Partial<ProposalsRecord> | null;
    if (raw === null || typeof raw !== "object" || typeof raw.at !== "string" || !Array.isArray(raw.proposals)) return null;
    return raw as ProposalsRecord;
  } catch {
    return null;
  }
}

export function writeProposalsRecord(root: string, project: string, key: string, runId: string, record: ProposalsRecord): void {
  writeFileSync(join(runDir(root, project, key, runId), PROPOSALS_RESULT_FILE), JSON.stringify(record, null, 2) + "\n");
}
