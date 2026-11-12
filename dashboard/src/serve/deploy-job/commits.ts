// What a deploy took in: the commits between the one its checkout stood at
// before the fetch and the one the fetch reached, each with its address on
// GitHub when origin is there. Read from git the first time a deploy's row is
// opened, and kept: a finished deploy's commits never change.

import { jobKind, type Job } from "../../queue/queue.ts";
import type { AfterRestartDeps } from "./after-restart.ts";
import { gitSync } from "./index.ts";

export interface DeployCommit {
  sha: string;
  subject: string;
  /** The commit's page on GitHub, when origin is a GitHub repository. */
  url?: string;
}

type Git = AfterRestartDeps["git"];

const KEPT = 500;
const read = new Map<string, DeployCommit[]>();
const webs = new Map<string, string | undefined>();

/** `https://github.com/<owner>/<repo>` for an ssh or https GitHub remote; nothing for any other. */
export function webAddress(remote: string): string | undefined {
  const m = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `https://github.com/${m[1]}` : undefined;
}

function webOf(root: string, git: Git): string | undefined {
  if (!webs.has(root)) {
    const remote = git(root, ["remote", "get-url", "origin"]);
    webs.set(root, remote.code === 0 ? webAddress(remote.stdout) : undefined);
  }
  return webs.get(root);
}

/** Where a deploy that did not record its own starting commit started: the
 *  commit the newest earlier done deploy of the same project reached. */
function previousCommit(job: Job, jobs: readonly Job[]): string | undefined {
  const at = (j: Job): number => Date.parse(j.createdAt) || 0;
  return jobs
    .filter((j) => j.id !== job.id && j.project === job.project && jobKind(j) === "deploy" && j.state === "done" && j.deploy?.commit && at(j) < at(job))
    .sort((a, b) => at(b) - at(a))[0]?.deploy?.commit;
}

/** The commits a deploy took in, newest first; `[]` when it took in none, and
 *  undefined when it is not known: no fetch reached a commit, nothing says
 *  where it started, or git could not answer. */
export function deployCommits(job: Job, jobs: readonly Job[], git: Git = gitSync): DeployCommit[] | undefined {
  const to = job.deploy?.commit;
  const root = job.deploy?.root;
  if (!to || !root) return undefined;
  const from = job.deploy?.from ?? previousCommit(job, jobs);
  if (!from) return undefined;
  if (from === to) return [];
  const key = `${root}\n${from}..${to}`;
  const kept = read.get(key);
  if (kept) return kept;
  const log = git(root, ["log", "--format=%H%x09%s", `${from}..${to}`]);
  if (log.code !== 0) return undefined;
  const web = webOf(root, git);
  const commits = log.stdout.split("\n").filter(Boolean).map((line) => {
    const [sha = "", ...subject] = line.split("\t");
    return { sha, subject: subject.join("\t"), ...(web ? { url: `${web}/commit/${sha}` } : {}) };
  });
  read.set(key, commits);
  if (read.size > KEPT) read.delete(read.keys().next().value!);
  return commits;
}
