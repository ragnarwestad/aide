// The `serve` CLI's own argument parsing, and resolving a `Depends on:`
// identifier to a spec folder.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import type { DiscoveredProject, SpecRef } from "../../project/discover.ts";
import { mergeQueueDefaults, parseHeaderAuth, parseQueueProjects } from "../../queue/queue.ts";
import { navEntries } from "../../render.ts";
import type { ServerOptions } from "../options.ts";
import { QUEUE_DEFAULTS, parseQueueConcurrency } from "./config.ts";

/** Which folder a `Depends on:` entry means — a second reader of
 *  `resolve_dependency_folder`'s rule in `aide-run-spec`: the exact
 *  folder first, then an `<id>-` prefix, live specs before archived
 *  ones. The same trade-off `discover.ts`'s `specDependsOn` already
 *  made for the line itself, so it gets what that one has: its own
 *  tests, mirroring the bash suite's cases one for one.
 *
 *  `undefined` for an identifier nothing matches. That is a REFUSAL, not
 *  a wait, and it belongs to `aide-run-spec` — a typo must reach the run
 *  that says so rather than park a job forever against a spec that will
 *  never exist. */
export function resolveDependencyFolder(
  project: DiscoveredProject,
  id: string,
): SpecRef | undefined {
  const live = project.specs.filter((s) => !s.archived);
  const archived = project.specs.filter((s) => s.archived);
  for (const set of [live, archived]) {
    const exact = set.find((s) => s.folder === id);
    if (exact) return exact;
    const prefixed = set.find((s) => s.folder.startsWith(`${id}-`));
    if (prefixed) return prefixed;
  }
  return undefined;
}

export function parseArgs(argv: string[]): ServerOptions {
  const opts: ServerOptions = { siteDir: join(homedir(), "aide-dashboard", "site"), port: 8788 };
  let root: string | undefined;
  let tokenFile: string | undefined;
  let queueConfigFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--site" && v) opts.siteDir = argv[++i]!;
    else if (a === "--port" && v) opts.port = Number(argv[++i]);
    else if (a === "--mirror" && v) opts.mirrorPath = argv[++i];
    else if (a === "--root" && v) root = argv[++i];
    else if (a === "--bind" && v) opts.bindHost = argv[++i];
    else if (a === "--queue-mirror" && v) opts.queueMirrorPath = argv[++i];
    else if (a === "--pending-models" && v) opts.pendingModelsPath = argv[++i];
    else if (a === "--pending-effort" && v) opts.pendingEffortPath = argv[++i];
    else if (a === "--queue-projects" && v) opts.queueProjects = argv[++i]!.split(",").map((s) => s.trim());
    else if (a === "--runner-bin" && v) opts.queueRunnerBin = argv[++i];
    // Like `--runner-bin`: launchd's PATH carries neither `~/.local/bin`
    // nor mise's shims, so the installed `aide-generate-pdf` is
    // unreachable by name from the service and the PDF button answers
    // "Executable not found in $PATH".
    else if (a === "--pdf-bin" && v) opts.pdfGeneratorBin = argv[++i];
    else if (a === "--result-dir" && v) opts.queueResultDir = argv[++i];
    // Where the dashboard keeps the clones it works in (spec 205).
    // `~/aide-dashboard/checkouts` unless a host wants them elsewhere.
    else if (a === "--dashboard-checkouts" && v) opts.dashboardCheckoutRoot = argv[++i];
    else if (a === "--queue-config" && v) queueConfigFile = argv[++i];
    // The token is read from a FILE, never an argument: `ps` shows
    // arguments to every user on the machine.
    else if (a === "--token-file" && v) tokenFile = argv[++i];
    // Spec 424: which spec/branch this process is a TEST board for —
    // absent means an ordinary (prod) server.
    else if (a === "--test-board" && v) opts.testBoardSpec = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opts.mirrorPath) opts.mirrorPath = join(homedir(), "aide-dashboard", "aide-runs.json");
  if (!opts.queueMirrorPath) opts.queueMirrorPath = join(homedir(), "aide-dashboard", "aide-queue.json");
  if (!opts.pendingModelsPath) opts.pendingModelsPath = join(homedir(), "aide-dashboard", "pending-models.json");
  if (!opts.pendingEffortPath) opts.pendingEffortPath = join(homedir(), "aide-dashboard", "pending-effort.json");
  if (tokenFile) {
    // A missing or unreadable token file must not crash the server:
    // launchd would restart it in a loop and take the whole dashboard
    // down over a feature that is meant to fail closed, not loud.
    try {
      const token = readFileSync(tokenFile, "utf-8").trim();
      if (token) opts.queueToken = token;
      else console.error(`token file ${tokenFile} is empty — the queue stays off`);
    } catch {
      console.error(`cannot read ${tokenFile} — the queue stays off`);
    }
  }
  if (queueConfigFile) {
    // Kept whether or not the file is readable: the Add/Remove routes
    // write the allowlist back here, and a first install has no such
    // file yet (spec 112).
    opts.queueConfigFile = queueConfigFile;
    // A missing or broken config leaves the built-in caps in place —
    // the tight ones. Failing towards "spends less" is the only safe
    // direction here.
    try {
      const raw = parseJsonc(readFileSync(queueConfigFile, "utf-8")) as Record<string, unknown>;
      opts.queueDefaults = mergeQueueDefaults(QUEUE_DEFAULTS, raw);
      // The notify command is an argv ARRAY: it is run with no shell,
      // so a string would have to be split by someone, and that someone
      // would get quoting wrong.
      if (Array.isArray(raw.notifyCommand) && raw.notifyCommand.every((a) => typeof a === "string")) {
        opts.queueNotifyCommand = raw.notifyCommand as string[];
      }
      if (raw.push === "none" || raw.push === "branch" || raw.push === "pr") opts.queuePush = raw.push;
      opts.queueConcurrency = parseQueueConcurrency(raw.concurrency);
      // The allowlist WINS over `--queue-projects` when the file has
      // one: the flag is the seed for a first install, and the file is
      // what every Add and Remove since has written (spec 112). A
      // malformed field is ignored entirely, leaving the flag — the
      // same direction every other key here fails in.
      const projects = parseQueueProjects(raw.projects);
      if (projects) opts.queueProjects = projects;
      // Off unless the file names one (spec 363) — a malformed block is
      // ignored, the same direction every sibling key here fails in.
      // Whether the bind address makes it safe to HONOR is not this
      // parser's question; that is `createServer`'s own refusal.
      if (typeof raw.headerAuth !== "undefined") {
        const headerAuth = parseHeaderAuth(raw.headerAuth);
        if (headerAuth) opts.headerAuth = headerAuth;
        else console.error(`headerAuth in ${queueConfigFile} is malformed — ignored`);
      }
    } catch {
      console.error(`cannot read ${queueConfigFile} — keeping the built-in caps`);
    }
  }
  if (root) {
    opts.projectRoot = root;
    // The checkouts and the manifests live under the same root here.
    opts.queueProjectRoot = root;
  }
  // The nav is the same three tabs whatever the projects are — a
  // project is reached from the Projects page, not from the bar. The
  // `navFromSite()` fallback below is what a server with no project
  // root uses, and it reads the site directory instead.
  if (root) opts.navEntries = navEntries();
  return opts;
}
