// The lines under the header every page shares: the install warning
// (spec 334, REQ-5) and a pressed Deploy whose restart waits for
// running jobs (spec 385). Both read process-lifetime state directly
// rather than being threaded through `pageShell()`'s call sites.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rowMessage } from "./components";
import { getPendingRestartNotice } from "./pending-restart.ts";
import { t, type Language } from "../../i18n";

const DEFAULT_INSTALL_LOG = () => join(process.env.HOME ?? "", "Library/Logs/aide-dashboard/install.log");

// A tool the installer could not declare (spec 334) is otherwise
// visible only in a log file nobody has a reason to open — read here so
// it reaches every ordinary dashboard visit instead (REQ-5). Only the
// LAST run's block matters: an old warning a later run already cleared
// must not keep showing.
function lastInstallWarning(lang: Language): string | undefined {
  const path = process.env.AIDE_INSTALL_LOG ?? DEFAULT_INSTALL_LOG();
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return undefined;
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
  return /⚠️\s+\[aide (tools|serve)\]/.test(lastBlock)
    ? t(lang, "shell.installWarning", { path })
    : undefined;
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

export function headerNotices(lang: Language): string {
  const installWarning = lastInstallWarning(lang);
  const installBanner = installWarning ? rowMessage("waiting", installWarning, { tag: "p" }) : "";
  return installBanner + restartWaitingNotice(lang);
}
