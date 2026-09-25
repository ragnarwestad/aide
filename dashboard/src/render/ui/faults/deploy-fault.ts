// The message a finished deploy leaves at the top of every page while
// the running service is older than the dashboard's own checkout —
// process-lifetime state read by `headerNotices()` directly, on
// `pending-restart.ts`'s precedent. `setDeployFault` (serve/state.ts) is
// the one writer.

import type { Sentence } from "../../../i18n/message.ts";

let fault: Sentence | null = null;

export function setDeployFaultNotice(sentence: Sentence | null): void {
  fault = sentence;
}

export function getDeployFaultNotice(): Sentence | null {
  return fault;
}
