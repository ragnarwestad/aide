// What the board does when a scheduled run ends green: read the list of
// proposed specs the run left beside its report, queue a Create job for each
// proposal that passes, and write down what happened for the run's page.
//
// It runs inside the runner's completion (`stepDoneHandler`), before the job's
// state changes, so it must never throw: an exception there would leave the job
// `running`. It changes nothing but the queue and one file beside the report —
// no git, and no step after Create.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { specFolders } from "../project/discover/scan.ts";
import { scheduleNameOf, scheduleRunOutputDir } from "./schedule.ts";
import type { QueueStore } from "./queue.ts";
import type { Job } from "./types.ts";
import {
  PROPOSALS_RESULT_FILE,
  checkProposal,
  descriptionRoom,
  parseProposalsFile,
  proposalsFileText,
  readProposalsRecord,
  sourceBlock,
  writeProposalsRecord,
  type KnownSpec,
  type ProposalResult,
  type ProposalsRecord,
} from "./spec-proposals.ts";

export interface ProposeDeps {
  store: Pick<QueueStore, "list" | "enqueueCreate">;
  /** Where every run's output directory lives. */
  outputRoot: string;
  /** The project's specs checkout, or undefined when there is none. */
  specsRoot: (project: string) => string | undefined;
  /** The run's address on the board, for the description's source block. */
  reportPath: (entryName: string, runId: string) => string;
  now: () => string;
  /** Where a refusal is said: the server log. */
  log: (action: string, spec: string | undefined, reason: string) => void;
}

/** Every spec of the project — active, archived and closed — read the way the
 *  board's own lists read them. */
function knownSpecs(root: string): KnownSpec[] {
  const refs = [...specFolders(root, false), ...specFolders(join(root, "archive"), true)];
  return refs.map((s) => ({
    folder: s.folder,
    title: s.title,
    kind: s.closed ? "closed" : s.archived ? "archived" : "active",
  }));
}

const isDirectory = (path: string): boolean => {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Queue a Create job for each proposal the run left, for the run's own
 *  project. Called for a `schedule` step that ended ok, and for nothing else. */
export function proposeSpecs(deps: ProposeDeps, job: Job): void {
  const name = scheduleNameOf(job.specFolder);
  const proposals: ProposalResult[] = [];
  let record: ProposalsRecord | null = null;
  try {
    const text = proposalsFileText(deps.outputRoot, job.project, job.specFolder, job.id);
    if (text === null) return;
    // A second pass for the same run (the board restarted in between) has
    // nothing left to do.
    if (readProposalsRecord(deps.outputRoot, job.project, job.specFolder, job.id) !== null) return;

    const root = deps.specsRoot(job.project);
    if (root === undefined || !isDirectory(root)) {
      record = { at: deps.now(), problem: "no-specs-root", proposals };
      return;
    }
    const parsed = parseProposalsFile(text);
    if ("error" in parsed) {
      record = { at: deps.now(), problem: "unreadable", detail: parsed.error, proposals };
      return;
    }

    const known = knownSpecs(root);
    const block = sourceBlock({
      name,
      project: job.project,
      runId: job.id,
      startedAt: job.startedAt ?? job.createdAt,
      reportPath: deps.reportPath(name, job.id),
    });
    const room = descriptionRoom(block);
    record = { at: deps.now(), proposals };

    for (const entry of parsed.entries) {
      // Read again for every entry: the one before may have queued the title.
      const jobs = deps.store.list().filter((j) => j.project === job.project);
      const checked = checkProposal(entry, room, known, jobs);
      if (!checked.ok) {
        proposals.push({ title: checked.title, result: "skipped", why: checked.why });
        continue;
      }
      const { title, description } = checked.proposal;
      // The defaults of an untouched New spec form: a model formulates the
      // acceptance criteria, and ticking them is required.
      const made = deps.store.enqueueCreate({
        project: job.project,
        title,
        description: `${description}\n\n${block}`,
        acceptanceRequired: true,
        aiFormulateAcceptance: true,
      });
      if (made.ok) {
        proposals.push({ title, result: "created", jobId: made.job.id });
      } else {
        deps.log("proposed spec", `${job.project}/${name}`, `${title}: ${made.error}`);
        proposals.push({ title, result: "skipped", why: { code: "refused" } });
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    deps.log("proposed spec", `${job.project}/${name}`, `failed: ${detail}`);
    record = { at: deps.now(), problem: "failed", detail, proposals };
  } finally {
    if (record !== null) {
      try {
        writeProposalsRecord(deps.outputRoot, job.project, job.specFolder, job.id, record);
      } catch (err) {
        deps.log(
          "proposed spec",
          `${job.project}/${name}`,
          `could not write ${join(scheduleRunOutputDir(deps.outputRoot, job.project, job.specFolder, job.id), PROPOSALS_RESULT_FILE)}: ${String(err)}`,
        );
      }
    }
  }
}
