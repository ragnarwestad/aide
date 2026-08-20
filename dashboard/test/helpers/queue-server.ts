// A server with a discoverable project root, for the tests about queue
// routes. Both suites need the same thirty lines of mkdir-and-write
// ceremony before they can ask their actual question, and a fixture
// kept in two copies is a fixture that will one day disagree with
// itself about what a project looks like.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  /** The spec's 1-description.md. A bare heading unless a suite cares. */
  description?: string;
  /** The spec's 4-status.md (spec 139). Since the workflow steps a spec
   *  has had are READ off one line of that file, a spec without it has
   *  had nothing — including `create`. Every spec the harness makes is
   *  a created one, so the default says so, and a suite that cares
   *  about a further step names the whole line itself. */
  status?: string;
}

export interface QueueHarness {
  start(opts?: StartOptions): { base: string; dir: string };
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
      const server = createServer({
        siteDir: dir,
        port: 0,
        claudeUsageFetch: failFetch,
        mirrorPath: join(dir, "runs.json"),
        queueMirrorPath: join(dir, "queue.json"),
        projectRoot: root,
        queueProjects: ["aide"],
        ...extra,
      });
      servers.push(server);
      return { base: `http://127.0.0.1:${server.port}`, dir };
    },

    cleanup() {
      while (servers.length) servers.pop()!.stop();
      while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
    },
  };
}

/** A 4-status.md whose Tracking info says which workflow steps the spec
 *  has HAD (spec 139), plus whatever else the suite wants in the file.
 *  Exported because the route suites build their own: the line is the
 *  contract every workflow step writes and the dashboard reads, and a
 *  fixture spelling it out by hand in twenty places is a fixture that
 *  will one day spell it differently. */
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
