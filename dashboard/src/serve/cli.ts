// The `serve.ts serve ...` command line entry point.

import { createServer } from "./serve.ts";
import { lookupTailscaleName, parseArgs } from "./serve-helpers";

export function runCli() {
  const argv = process.argv.slice(2);
  if (argv[0] !== "serve") {
    console.error(
      "usage: serve.ts serve --site DIR [--port N] [--bind ADDR]\n" +
        "                     [--mirror FILE] [--root DIR]\n" +
        "                     [--queue-mirror FILE] [--queue-projects a,b]\n" +
        "                     [--runner-bin PATH] [--pdf-bin PATH] [--result-dir DIR]\n" +
        "                     [--queue-config FILE] [--test-board SPEC]",
    );
    process.exit(2);
  }
  const opts = parseArgs(argv.slice(1));
  // The one place the tool checks are turned on: a person serving the
  // board wants to know, on the page, whether each AI is usable here.
  const s = createServer({ ...opts, checkToolsOnStart: true, tailscaleName: lookupTailscaleName });
  console.log(`aide-dashboard serving ${opts.siteDir} on :${s.port}`);
}
