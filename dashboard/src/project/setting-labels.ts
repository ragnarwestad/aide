// The one place a setting's plain-language name is written down (REQ-4,
// spec 318). Every surface that names a setting to a reader — the
// Config tab's row, the Health tab's warnings, the Deploy tab and its
// refusal path — reads it from here, so introducing or changing a label
// is a one-line edit in this file rather than a hunt across pages.
export const SETTING_LABELS: Record<string, string> = {
  AIDE_SPECS_PATH: "Specs path",
  AIDE_WORKTREE_LINKS: "Worktree links",
  AIDE_TEST_CMD: "Test command",
  AIDE_LINT_CMD: "Lint command",
  AIDE_BUILD_CMD: "Build command",
  AIDE_INSTALL_CMD: "Install command",
  AIDE_JIRA_BASE_URL: "JIRA base URL",
};
