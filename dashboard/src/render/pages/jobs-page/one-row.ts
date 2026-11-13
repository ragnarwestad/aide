// What one row of the Jobs tab is built from, so a request for one row
// (`?rows=1&only=<key>`) reads that row's jobs and specs and no other row's.
// A pure function over the raw jobs, as the rules in `rows.ts` are: the route
// runs it before it builds a row view for any job.

import type { ExecutionGroup } from "../../../queue/execution-groups";
import { jobRowKeys, type JobLike } from "./rows.ts";

/** `<project>/<folder>`, and an earlier round's `<project>/<folder>@<start>`. */
const SPEC_KEY = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?:@.*)?$/;

export interface RowInputs<J> {
  /** The jobs that are rows of their own, cut to the asked row. */
  shown: J[];
  /** The jobs behind the specs' rows, cut to the asked row. */
  specJobs: J[];
  /** The `<project>/<folder>` keys of the specs the row is built from. */
  specs: Set<string>;
  /** Every job row's key by job id, from all the jobs the tab shows: an older
   *  job keeps its `<key>@<job id>` when the newer ones are cut away. */
  rowKeys: Map<string, string>;
}

/** The jobs and specs the row with `key` is built from, or `undefined` for a
 *  key that is neither a job row's nor a spec's (a group's card), which is
 *  built from the whole view.
 *
 *  A job's row reads that job alone. A spec's row reads the spec, and, for a
 *  spec in an execution group, the group's other members: its row is drawn
 *  inside the group's card, and whether the view shows the card reads every
 *  member. A spec's group is every registered group that names it, and every
 *  spec of its project that carries the same group name. The jobs kept are
 *  those of these specs, of both kinds, so a Close or Reopen in flight for
 *  one of them still stands for its spec. */
export function rowInputs<J extends JobLike>(
  key: string,
  o: {
    /** The jobs that are rows of their own (`jobsShown`). */
    shown: J[];
    /** The jobs behind the specs' rows (`listedSpecJobs`). */
    specJobs: J[];
    /** The registered execution groups. */
    groups: readonly Pick<ExecutionGroup, "project" | "members">[];
    /** A project's specs, on disk and archived, each with its group's name. */
    specsOf: (project: string) => { specFolder: string; group?: string }[];
  },
): RowInputs<J> | undefined {
  const rowKeys = jobRowKeys(o.shown);
  const own = o.shown.find((job) => rowKeys.get(job.id) === key);
  if (own) return { shown: [own], specJobs: [], specs: new Set(), rowKeys };

  const spec = key.match(SPEC_KEY);
  if (!spec) return undefined;
  const project = spec[1]!;
  const folder = spec[2]!;
  const folders = new Set([folder]);
  for (const group of o.groups) {
    if (group.project === project && group.members.includes(folder)) group.members.forEach((member) => folders.add(member));
  }
  const inProject = o.specsOf(project);
  const name = inProject.find((s) => s.specFolder === folder)?.group;
  if (name) inProject.filter((s) => s.group === name).forEach((s) => folders.add(s.specFolder));

  const specs = new Set([...folders].map((f) => `${project}/${f}`));
  const kept = (job: J): boolean => specs.has(`${job.project}/${job.specFolder}`);
  return { shown: o.shown.filter(kept), specJobs: o.specJobs.filter(kept), specs, rowKeys };
}
