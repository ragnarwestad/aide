// A server with a discoverable project root, for the tests about queue
// routes. Both suites need the same thirty lines of mkdir-and-write
// ceremony before they can ask their actual question, and a fixture
// kept in two copies is a fixture that will one day disagree with
// itself about what a project looks like.

import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ServerOptions } from "../../src/serve.ts";

/** claude-usage unreachable: the queue must work without it. */
export const failFetch = (async () => {
  throw new Error("down");
}) as unknown as typeof fetch;

export interface StartOptions {
  extra?: Partial<ServerOptions>;
  /** Further discoverable projects, for jobs that span repos. */
  alsoProjects?: string[];
  /** Further spec folders in `aide`, for jobs that run side by side. */
  alsoSpecs?: string[];
  /** Archived spec folders — written under `specs/archive/<folder>`,
   *  which is where `discoverProjects` looks for them (spec 163). Keyed
   *  by folder, so one suite can give a spec an `Archived:` stamp in its
   *  `4-status.md` and another none. `project` puts one in a project
   *  other than `aide`, which the archive's own suite needs to prove
   *  that its table interleaves projects by date (spec 170); that
   *  project has to exist, so name it in `alsoProjects` too. */
  archivedSpecs?: Record<string, { description?: string; status?: string; project?: string }>;
  /** The spec's 1-description.md. A bare heading unless a suite cares. */
  description?: string;
  /** The spec's 4-status.md. Its "Workflow steps completed" line is
   *  what the spec CLAIMS to have had; `ran()` is what makes a step
   *  count (spec 154). The default claims `create`, which is what
   *  `/aide-create` used to write — a suite about the two records
   *  disagreeing sets one without the other. */
  status?: string;
}

export interface QueueHarness {
  /** `server` is handed back for the one question the base URL cannot
   *  answer: what `stop()` let go of (spec 204's filesystem watchers).
   *  `cleanup()` still stops it, so a suite that takes it does not have
   *  to. */
  start(opts?: StartOptions): { base: string; dir: string; server: ReturnType<typeof createServer> };
  /** For afterEach: stops every server and removes every directory. */
  cleanup(): void;
}

export function queueHarness(prefix: string): QueueHarness {
  const servers: { stop: () => void }[] = [];
  const dirs: string[] = [];

  return {
    start({
      extra = {},
      alsoProjects = [],
      alsoSpecs = [],
      archivedSpecs = {},
      description = "# Queue - Description\n",
      status = statusSaying(["create"]),
    } = {}) {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      dirs.push(dir);
      // The generated site's overview, at the filename `renderSite`
      // actually writes since spec 100 — `/` belongs to the spec list.
      writeFileSync(join(dir, "projects.html"), "<p>overview</p>");
      const root = join(dir, "root");
      project(root, "aide", "81-queue-and-runner", description, status);
      for (const folder of alsoSpecs) {
        mkdirSync(join(root, "aide", "specs", folder), { recursive: true });
        writeFileSync(join(root, "aide", "specs", folder, "1-description.md"), `# ${folder}\n`);
        writeFileSync(join(root, "aide", "specs", folder, "4-status.md"), status);
      }
      for (const name of alsoProjects) {
        project(root, name, "01-first", "# First - Description\n", status);
      }
      for (const [folder, spec] of Object.entries(archivedSpecs)) {
        const archived = join(root, spec.project ?? "aide", "specs", "archive", folder);
        mkdirSync(archived, { recursive: true });
        writeFileSync(join(archived, "1-description.md"), spec.description ?? `# ${folder} - Description\n`);
        writeFileSync(join(archived, "4-status.md"), spec.status ?? status);
      }
      const server = createServer({
        siteDir: dir,
        port: 0,
        claudeUsageFetch: failFetch,
        mirrorPath: join(dir, "runs.json"),
        queueMirrorPath: join(dir, "queue.json"),
        projectRoot: root,
        queueProjects: ["aide"],
        // Spec 205: inside this fixture's own directory, never the
        // default under $HOME. A suite that let the server fall back to
        // it would clone into the operator's real checkouts, and the
        // next suite would find them there.
        dashboardCheckoutRoot: join(dir, "owned"),
        // Spec 208: the render reads whatever the schedule last found,
        // so a fixture that writes its git commits AFTER the server
        // starts — which most of them do — needs the schedule to come
        // round again inside a test's patience. In production this is
        // the checkers' own 30 s window; here it is a few ticks. It is
        // both the schedule AND the window: two numbers is how a fast
        // schedule starves, and `serve.ts` keeps them equal.
        specCachePollMs: 40,
        ...extra,
      });
      servers.push(server);
      return { base: `http://127.0.0.1:${server.port}`, dir, server };
    },

    cleanup() {
      while (servers.length) servers.pop()!.stop();
      while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
    },
  };
}

/** The runner's own commits, in the specs root, for the steps a spec
 *  has HAD (spec 154). Since the queue reads git rather than the file,
 *  this — not `statusSaying` — is what makes a step count.
 *
 *  The repo is made on first use rather than by `start`: a suite that
 *  never asks about workflow history gets the same non-git fixture it
 *  always had, including the one that checks what the Update button
 *  refuses for a directory that is not a working tree.
 *
 *  Empty commits, because what is under test is the SUBJECT. The
 *  grammar is `core/scripts/aide-run-spec`'s and is repeated here
 *  deliberately: a helper that built it from the same code as the
 *  reader would prove only that the two agreed with each other. */
export function ran(
  dir: string,
  steps: string[],
  specFolder = "81-queue-and-runner",
  opts: { stopped?: string; headless?: boolean } = {},
): void {
  const root = join(dir, "root");
  if (!existsSync(join(root, ".git"))) {
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.name", "Test");
    git(root, "config", "user.email", "test@example.com");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "the projects root as it was found");
  }
  for (const step of steps) {
    const subject =
      `Run /aide-${step} for ${specFolder}` +
      (opts.headless === false ? "" : " (headless)") +
      (opts.stopped ? ` (stopped: ${opts.stopped})` : "");
    git(root, "commit", "-q", "--allow-empty", "-m", subject);
  }
}

function git(cwd: string, ...args: string[]): void {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${out.stderr.toString()}`);
}

/** A 4-status.md whose Tracking info says which workflow steps the spec
 *  has HAD (spec 139) — a CLAIM since spec 154, and the thing the row
 *  reports a disagreement about when git says otherwise. Exported
 *  because the route suites build their own: a fixture spelling the
 *  line out by hand in twenty places is a fixture that will one day
 *  spell it differently. */
export const statusSaying = (steps: string[], rest = ""): string =>
  `# Queue - Status\n\n## Tracking info\n\n- **Workflow steps completed:** ${steps.join(", ")}\n${rest}`;

// One manifest and one spec: the least a project needs to be discovered.
function project(root: string, name: string, specFolder: string, description: string, status: string): void {
  const dir = join(root, name);
  mkdirSync(join(dir, ".aide"), { recursive: true });
  writeFileSync(join(dir, ".aide", "project.yaml"), `name: ${name}\n`);
  mkdirSync(join(dir, "specs", specFolder), { recursive: true });
  writeFileSync(join(dir, "specs", specFolder, "1-description.md"), description);
  writeFileSync(join(dir, "specs", specFolder, "4-status.md"), status);
}
