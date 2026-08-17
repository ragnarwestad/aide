// Renders the launchd job that serves the dashboard. Every path is an
// argument: a plist committed to git carries the home directory of
// whoever generated it, and nobody else can use that file.
//
// CLI: render-plist.ts --label L --bun-path P --script P
//                      --working-directory D --log-path F -- <serve argv...>

export interface PlistOptions {
  /** launchd job label, also the LaunchAgents filename stem. */
  label: string;
  /** Absolute path to bun on the TARGET host — bare `bun` is not on launchd's PATH. */
  bunPath: string;
  /** Absolute path to src/serve.ts in the target's checkout. */
  script: string;
  workingDirectory: string;
  /** Both stdout and stderr go here: one log to read, in order. */
  logPath: string;
  /** Arguments handed to serve.ts, starting with `serve`. */
  serveArgv: string[];
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function string(value: string, indent: string): string {
  return `${indent}<string>${escape(value)}</string>`;
}

export function renderPlist(opts: PlistOptions): string {
  const args = [opts.bunPath, "run", opts.script, ...opts.serveArgv];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
${string(opts.label, "  ")}
  <key>ProgramArguments</key>
  <array>
${args.map((a) => string(a, "    ")).join("\n")}
  </array>
  <key>WorkingDirectory</key>
${string(opts.workingDirectory, "  ")}
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
${string(opts.logPath, "  ")}
  <key>StandardErrorPath</key>
${string(opts.logPath, "  ")}
</dict>
</plist>
`;
}

const USAGE =
  "usage: render-plist.ts --label L --bun-path P --script P --working-directory D --log-path F -- <serve argv...>";

export function parseArgs(argv: string[]): PlistOptions {
  const opts: Partial<PlistOptions> = {};
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      i++;
      break;
    }
    const v = argv[i + 1];
    if (a === "--label" && v) opts.label = argv[++i];
    else if (a === "--bun-path" && v) opts.bunPath = argv[++i];
    else if (a === "--script" && v) opts.script = argv[++i];
    else if (a === "--working-directory" && v) opts.workingDirectory = argv[++i];
    else if (a === "--log-path" && v) opts.logPath = argv[++i];
    else throw new Error(`unknown or incomplete argument: ${a}\n${USAGE}`);
  }
  const serveArgv = argv.slice(i);
  // No defaults: a missing value must be an error here, not a path
  // pointing at whoever's machine rendered the file.
  for (const key of ["label", "bunPath", "script", "workingDirectory", "logPath"] as const) {
    if (!opts[key]) throw new Error(`missing required option for ${key}\n${USAGE}`);
  }
  if (serveArgv[0] !== "serve") throw new Error(`the serve argv after -- must start with 'serve'\n${USAGE}`);
  return { ...(opts as PlistOptions), serveArgv };
}

if (import.meta.main) {
  try {
    process.stdout.write(renderPlist(parseArgs(process.argv.slice(2))));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}
