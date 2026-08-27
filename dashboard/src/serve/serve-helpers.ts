// Stand-alone pieces of the aide-dashboard server: no dependency on
// `createServer`'s closure (spec: split serve.ts, step 1). Split by
// theme into serve-helpers/config.ts (constants and the merge lock),
// http.ts (request/response plumbing), redirect.ts (form-POST
// redirects and commit messages), static.ts (the site, the PWA assets,
// the bundled queue-client script), runner-argv.ts (a job's argv) and
// parse-args.ts (the CLI and dependency-folder resolution) — kept as a
// barrel at this path because every route file imports from it.

export {
  MAX_BODY, MAX_SAVE_BODY, INSTALL_TIMEOUT_MS, QUEUE_DEFAULTS, createRootLock,
  DEFAULT_QUEUE_CONCURRENCY, parseQueueConcurrency, DEPENDENCY_GATED_STEPS, GATED,
} from "./serve-helpers/config.ts";

export {
  json, readBounded, tokenMatches, cookieValue, SORT_COOKIE, sortChoice, bodyToObject,
} from "./serve-helpers/http.ts";

export {
  ARCHIVED_REFUSAL, editMessage, tickMessage, specsRedirect, logRefusal,
} from "./serve-helpers/redirect.ts";

export {
  navFromSite, queueClientScript, STREAM_TAIL_BYTES, tailFile, serveStatic, servePwaAsset,
} from "./serve-helpers/static.ts";

export {
  resolveTimeoutSec, resolveStepPermissionMode, resolveStepModel, runnerArgv,
} from "./serve-helpers/runner-argv.ts";

export { resolveDependencyFolder, parseArgs } from "./serve-helpers/parse-args.ts";
