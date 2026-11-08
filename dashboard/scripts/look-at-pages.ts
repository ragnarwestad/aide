// Takes screenshots of dashboard pages at a desktop and a phone width, from
// a board served out of this checkout's own code on throwaway data. An
// implement uses it to look at the pages its change affects (the implement
// skill's Step 4, docs/tests-in-a-spec.md, "Looking at the pages").
//
//   bun dashboard/scripts/look-at-pages.ts --scene scene.json --out <dir> / /specs
//
// The scene is a JSON file naming the data that brings the changed part onto
// the page. Its fields are those of `queueHarness(...).start()` that are
// plain data: `description`, `status`, `analysis`, `liveState`, `queueMirror`
// (a JSON string, or the array/object itself), `alsoSpecs`, `alsoProjects`
// and `archivedSpecs`, plus `queueConfig`, an object written as the queue
// config file for the Settings and Schedule pages. The live spec's folder is
// always `81-queue-and-runner`. An empty scene gives the harness's default
// board.
//
// The board never runs a step (no runner is set) and never reads or writes
// `~/.aide/dashboard/`: everything it holds is in a throwaway directory.
//
// When it cannot serve or screenshot, it writes one sentence saying why to
// `<out>/not-taken.txt` and exits 1.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { queueHarness, type StartOptions } from "../test/helpers/queue-server.ts";

/** The widths a page is taken at, with the height of the window. */
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

export interface Scene {
  description?: string;
  status?: string;
  analysis?: string;
  liveState?: string;
  queueMirror?: unknown;
  alsoSpecs?: string[];
  alsoProjects?: string[];
  archivedSpecs?: StartOptions["archivedSpecs"];
  queueConfig?: Record<string, unknown>;
}

export interface ServedScene {
  base: string;
  stop: () => void;
}

/** A board from this checkout's code with the scene's data, on 127.0.0.1. */
export async function serveScene(scene: Scene): Promise<ServedScene> {
  const { queueConfig, queueMirror, ...data } = scene;
  const harness = queueHarness("look-at-pages-");
  const extra: StartOptions["extra"] = { bindHost: "127.0.0.1" };
  let configDir: string | undefined;
  if (queueConfig !== undefined) {
    configDir = mkdtempSync(join(tmpdir(), "look-at-pages-config-"));
    extra.queueConfigFile = join(configDir, "queue-config.json");
    writeFileSync(extra.queueConfigFile, JSON.stringify(queueConfig));
  }
  const started = harness.start({
    ...data,
    queueMirror: queueMirror === undefined ? undefined : typeof queueMirror === "string" ? queueMirror : JSON.stringify(queueMirror),
    extra,
  });
  return {
    base: started.base,
    stop: () => {
      harness.cleanup();
      if (configDir) rmSync(configDir, { recursive: true, force: true });
    },
  };
}

/** `/jobs/run1` gives `jobs-run1`; the root gives `home`. */
const slugOf = (path: string): string => path.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "home";

const writeNotTaken = (out: string, why: string): void => {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "not-taken.txt"), `${why}\n`);
};

/** The folder holds only the last round: what an earlier one left is removed. */
function clearEarlierRound(out: string): void {
  mkdirSync(out, { recursive: true });
  for (const name of readdirSync(out)) {
    if (name.endsWith(".png") || name === "not-taken.txt") rmSync(join(out, name), { force: true });
  }
}

/** Every path at every width into `out`, as `<NN>-<slug>-<width>.png`, replacing what an earlier round left.
 *  True when every picture was taken; otherwise the reason is in `<out>/not-taken.txt`. */
export async function lookAtPages(o: { scene: Scene; out: string; paths: string[]; browser?: Browser }): Promise<boolean> {
  clearEarlierRound(o.out);
  let served: ServedScene | undefined;
  let launched: Browser | undefined;
  try {
    served = await serveScene(o.scene);
    let browser = o.browser;
    if (!browser) {
      const { chromium } = await import("playwright");
      browser = launched = await chromium.launch();
    }
    for (const [i, path] of o.paths.entries()) {
      for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({ viewport });
        try {
          const page = await context.newPage();
          const response = await page.goto(`${served.base}${path}`, { waitUntil: "load" });
          if (!response || response.status() >= 400) {
            throw new Error(`the page ${path} answered ${response ? response.status() : "nothing"}`);
          }
          const nn = String(i + 1).padStart(2, "0");
          await page.screenshot({ path: join(o.out, `${nn}-${slugOf(path)}-${viewport.width}.png`), fullPage: true });
        } finally {
          await context.close();
        }
      }
    }
    return true;
  } catch (e) {
    writeNotTaken(o.out, `${e instanceof Error ? e.message : String(e)}`.split("\n")[0]!);
    return false;
  } finally {
    await launched?.close();
    served?.stop();
  }
}

/** `--scene <file>`, `--out <dir>`, then the paths. */
function parseArgs(argv: string[]): { scene?: string; out?: string; paths: string[] } {
  const parsed: { scene?: string; out?: string; paths: string[] } = { paths: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--scene") parsed.scene = argv[++i];
    else if (argv[i] === "--out") parsed.out = argv[++i];
    else parsed.paths.push(argv[i]!);
  }
  return parsed;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out || args.paths.length === 0) {
    console.error("usage: bun dashboard/scripts/look-at-pages.ts [--scene <scene.json>] --out <dir> <path>...");
    return 2;
  }
  let scene: Scene = {};
  if (args.scene) {
    try {
      scene = JSON.parse(readFileSync(args.scene, "utf-8")) as Scene;
    } catch (e) {
      clearEarlierRound(args.out);
      writeNotTaken(args.out, `the scene ${args.scene} could not be read: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }
  return (await lookAtPages({ scene, out: args.out, paths: args.paths })) ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
