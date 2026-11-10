import { SHARED_CATALOG } from "./shared/catalog.ts";
import { JOBS_CATALOG } from "./jobs/catalog.ts";
import { LANDING_DEPLOY } from "./landing/deploy.ts";
import { CREATE_CATALOG } from "./create/catalog.ts";
import { JOBS_ANALYSIS } from "./jobs/analysis.ts";
import { USAGE_LIMIT_CATALOG } from "./usage-limit/catalog.ts";
import { JOBS_PROVIDER } from "./jobs/provider.ts";
import { GIT_CATALOG } from "./git/catalog.ts";
import { JOBS_TESTS_RED } from "./jobs/tests-red.ts";
import { JOBS_TESTS_NOT_STARTED } from "./jobs/tests-not-started.ts";
import { ACTIONS_PROPOSALS } from "./actions/proposals.ts";
import { LANDING_CATALOG } from "./landing/catalog.ts";
import { LANDING_TESTS } from "./landing/tests.ts";
import { SPECS_CATALOG } from "./specs/catalog.ts";
import { ACTIONS_CATALOG } from "./actions/catalog.ts";
import { ACTIONS_MODELS } from "./actions/models.ts";
import { ACTIONS_GIT } from "./actions/git.ts";
import { NOTIFICATIONS_CATALOG } from "./notifications/catalog.ts";
import { LOGIN_CATALOG } from "./login/catalog.ts";
import { READINESS_CATALOG } from "./readiness/catalog.ts";

export type { MessageEntry } from "./types.ts";

export const MESSAGES = {
  ...SHARED_CATALOG,
  ...JOBS_CATALOG,
  ...LANDING_DEPLOY,
  ...CREATE_CATALOG,
  ...JOBS_ANALYSIS,
  ...USAGE_LIMIT_CATALOG,
  ...JOBS_PROVIDER,
  ...GIT_CATALOG,
  ...JOBS_TESTS_RED,
  ...JOBS_TESTS_NOT_STARTED,
  ...ACTIONS_PROPOSALS,
  ...LANDING_CATALOG,
  ...LANDING_TESTS,
  ...SPECS_CATALOG,
  ...ACTIONS_CATALOG,
  ...ACTIONS_MODELS,
  ...ACTIONS_GIT,
  ...NOTIFICATIONS_CATALOG,
  ...LOGIN_CATALOG,
  ...READINESS_CATALOG,
} as const;

export type MessageKey = keyof typeof MESSAGES;
