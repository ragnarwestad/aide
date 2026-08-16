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
  /** The spec's 1-description.md. A bare heading unless a suite cares. */
  description?: string;
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
    start({ extra = {}, alsoProjects = [], description = "# Queue - Description\n" } = {}) {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      dirs.push(dir);
      writeFileSync(join(dir, "index.html"), "<p>overview</p>");
      const root = join(dir, "root");
      project(root, "aide", "81-queue-and-runner", description);
      for (const name of alsoProjects) {
        project(root, name, "01-first", "# First - Description\n");
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

// One manifest and one spec: the least a project needs to be discovered.
function project(root: string, name: string, specFolder: string, description: string): void {
  const dir = join(root, name);
  mkdirSync(join(dir, ".aide"), { recursive: true });
  writeFileSync(join(dir, ".aide", "project.yaml"), `name: ${name}\n`);
  mkdirSync(join(dir, "specs", specFolder), { recursive: true });
  writeFileSync(join(dir, "specs", specFolder, "1-description.md"), description);
}
