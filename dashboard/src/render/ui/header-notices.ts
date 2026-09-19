// The lines under the header every page shares: the install warning
// (spec 334, REQ-5) and a pressed Deploy whose restart waits for
// running jobs (spec 385). Both read process-lifetime state directly
// rather than being threaded through `pageShell()`'s call sites.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rowMessage } from "./components";
import { getPendingRestartNotice } from "./pending-restart.ts";
import { t, type Language } from "../../i18n";
import { toolsWithFaults } from "./tool-checks.ts";
import { TOOL_TAB_LABELS } from "../pages/settings-page/tools.ts";

/** Where deploy/install-after-merge.sh writes its log: macOS's own log
 *  directory, and beside the dashboard's state everywhere else. */
export function defaultInstallLog(home: string, platform: string): string {
  return platform === "darwin"
    ? join(home, "Library/Logs/aide-dashboard/install.log")
    : join(home, ".aide/dashboard/logs/install.log");
}

const DEFAULT_INSTALL_LOG = () => defaultInstallLog(process.env.HOME ?? "", process.platform);

// A tool the installer could not declare (spec 334) is otherwise
// visible only in a log file nobody has a reason to open — read here so
// it reaches every ordinary dashboard visit instead (REQ-5). Only the
// LAST run's block matters: an old warning a later run already cleared
// must not keep showing.
function lastInstallWarnings(lang: Language): string[] {
  const path = process.env.AIDE_INSTALL_LOG ?? DEFAULT_INSTALL_LOG();
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  const lastBlock = text.split(/^--- .* ---$/m).pop() ?? "";
  // Two tagged warnings only: the declared-tools step's (`[aide tools]`,
  // core/scripts/_install-bin.sh) and the serve job's (`[aide serve]`,
  // deploy/install-after-merge.sh — the launchd job passing an option
  // this build no longer accepts, which kills the board at its next
  // restart). The installers also print ⚠️ for things a machine may
  // legitimately not have — Codex, a browser MCP, a PATH line — and a
  // banner that fired on any of those was on after every merge, which
  // is the same as no banner.
  //
  // Each warning is its own line, in the installer's own words: "see
  // the log" sent the reader to a file for the one sentence that says
  // what is wrong — here, that the board will not start after its next
  // restart. The log's path rides along for the full output.
  return [...lastBlock.matchAll(/⚠️\s+\[aide (tools|serve)\]\s*(.+)$/gm)].map((m) =>
    t(lang, "shell.installWarning", { problem: m[2]!.trim(), path }),
  );
}

/** The Deploy wait on every page, not only the Deploy tab: the jobs it
 *  names — and any started during the wait — are what the restart's
 *  deadline kills. */
function restartWaitingNotice(lang: Language): string {
  const waiting = getPendingRestartNotice();
  if (waiting.length === 0) return "";
  const text = t(lang, "shell.restartWaiting", { jobs: waiting.join(", ") });
  return rowMessage("waiting", text, { tag: "p", hook: "restart-notice" });
}

/** A tool the board checked and found wanting (2026-09-16). Without
 *  this the answer lives on a Settings tab nobody has a reason to open,
 *  and the first anyone learns of it is a run that failed. One line per
 *  tool, since two faulty tools are two different fixes. */
function toolFaultNotices(lang: Language): string {
  return toolsWithFaults()
    .map(({ tool, problems }) =>
      rowMessage(
        "waiting",
        t(lang, "shell.toolFault", { tool: TOOL_TAB_LABELS[tool], problems: problems.join(", ") }),
        { tag: "p", hook: "tool-fault" },
      ),
    )
    .join("");
}

export function headerNotices(lang: Language): string {
  const installBanner = lastInstallWarnings(lang)
    .map((warning) => rowMessage("waiting", warning, { tag: "p", hook: "install-warning" }))
    .join("");
  return installBanner + toolFaultNotices(lang) + restartWaitingNotice(lang);
}
