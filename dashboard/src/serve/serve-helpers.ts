// Stand-alone pieces of the aide-dashboard server: no dependency on
// `createServer`'s closure (spec: split serve.ts, step 1). Split by
// theme into serve-helpers/config.ts (constants and the merge lock),
// http.ts (request/response plumbing), redirect.ts (form-POST
// redirects and commit messages), static.ts (the site, the PWA assets,
// the bundled queue-client script), runner-argv.ts (a job's argv),
// parse-args.ts (the CLI and dependency-folder resolution) and
// compression.ts (the server-wide gzip wrapper, spec 315) — kept as a
// barrel at this path because every route file imports from it.

export {
  MAX_BODY, MAX_SAVE_BODY, INSTALL_TIMEOUT_MS, QUEUE_DEFAULTS, createRootLock,
  DEFAULT_QUEUE_CONCURRENCY, parseQueueConcurrency, DEPENDENCY_GATED_STEPS, GATED,
  RESTART_POLL_MS, RESTART_DEFER_TIMEOUT_MS, RESTART_JOBS_DEFER_MS, LANDING_GATE_TIMEOUT_MS,
} from "./serve-helpers/config.ts";

export {
  json, readBounded, tokenMatches, cookieValue, sortCookieName, sortChoice,
  stateCookieName, stateChoice, LANG_COOKIE, languageChoice, bodyToObject,
} from "./serve-helpers/http.ts";

export {
  ARCHIVED_REFUSAL, editMessage, tickMessage, specsRedirect, logRefusal,
} from "./serve-helpers/redirect.ts";

export {
  navFromSite, queueClientScript, specEditorClientScript, serveSpecEditorAsset,
  SPEC_EDITOR_ASSET_PATH, specViewerClientScript, serveSpecViewerAsset, SPEC_VIEWER_ASSET_PATH,
  etagFor, STREAM_TAIL_BYTES, tailFile, serveStatic, servePwaAsset,
} from "./serve-helpers/static.ts";

export { compressResponse } from "./serve-helpers/compression.ts";

export {
  resolveTimeoutSec, resolveStepPermissionMode, resolveStepModel, runnerArgv,
} from "./serve-helpers/runner-argv.ts";

export { resolveDependencyFolder, parseArgs } from "./serve-helpers/parse-args.ts";
