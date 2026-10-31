// The dashboard's own git runs no hooks. A hook is a program git starts by
// itself, and the landing runs git outside the sandbox on a tree a step
// wrote; a hook that reads the working tree (a relative `core.hooksPath`,
// lefthook's `lefthook.yml`) would run what the step wrote. `aide-run-spec`
// makes the same decision in `core/scripts/lib/run-spec/setup/git-hooks.sh`.

/** Put before the subcommand of every git the dashboard starts itself. */
export const NO_GIT_HOOKS = ["-c", "core.hooksPath=/dev/null"] as const;

/** The same setting for a script that runs git of its own and nothing
 *  else, such as `aide-create-spec` numbering a spec during a landing.
 *  Never for a command that runs a project's tests: those run git as they
 *  would anywhere else. */
export const NO_GIT_HOOKS_ENV: Record<string, string> = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "core.hooksPath",
  GIT_CONFIG_VALUE_0: "/dev/null",
};
