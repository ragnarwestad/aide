"""Every error the runner writes, with the fix it gives apart or the reason
it has none. `test_runner_error_solutions.py` reads the runner's sources and
fails for a site no entry covers.

An entry's `pattern` is matched against the site's own line and the two
lines after it (a sentence continues, and its fix may stand on the next
line). It carries either `solution`, a substring the site must contain in
its `refuse_fix` fix or its `error_solution=` assignment, or `exempt`, the
reason there is nothing to resolve."""

CALLER = "a caller's mistake in the arguments or the project's configuration, which the board never makes"
TOOL = "the tool's own words, with the fix put beside them by provider_error_ending"
PROGRAM = "another program's own words"

RUNNER_ERROR_REGISTRY: list[dict] = [
    # --- a fix given apart -------------------------------------------------
    {"pattern": r'reinstall aide', "solution": "reinstall aide"},
    {"pattern": r'refuse_fix "cannot create the worktree (directory|base)', "solution": "fix its parent directory"},
    {"pattern": r'refuse_fix "cannot create \$branch in a worktree', "solution": "fix the checkout on the serving host"},
    {"pattern": r'refuse_fix "worktreeLinks names a build output', "solution": "remove it from"},
    {"pattern": r'refuse_fix "\$spec_reference is under archive/', "solution": "fix the specs checkout"},
    {"pattern": r'refuse_fix "cannot fast-forward \$br', "solution": "merge it by hand"},
    {"pattern": r'refuse_fix "cannot move \$br', "solution": "reconcile it by hand"},
    {"pattern": r'refuse_fix "\$br has diverged', "solution": "reconcile them by hand"},
    {"pattern": r'refuse_fix "cannot bring \$branch up to date', "solution": "merge it by hand"},
    {"pattern": r'refuse_fix "timed out waiting for the worktree lock', "solution": "remove that lock"},
    {"pattern": r'refuse_fix "cannot switch to \$base', "solution": "fix the checkout on the serving host"},
    {"pattern": r'refuse_fix "the specs root is', "solution": "set the specs root to that folder"},
    {"pattern": r'refuse_fix "cannot find the codex binary', "solution": "set AIDE_CODEX_BIN"},
    {"pattern": r'refuse_fix "cannot find the opencode binary', "solution": "set AIDE_OPENCODE_BIN"},
    {"pattern": r'refuse_fix "cannot find the claude binary', "solution": "set AIDE_CLAUDE_BIN"},
    {"pattern": r'refuse_fix "--tool fake-claude', "solution": "set AIDE_CLAUDE_BIN"},
    {"pattern": r'did not reach origin', "solution": "fix the branch in the checkout on the serving host"},
    {"pattern": r'stopped on the acceptance criteria', "solution": "put the description right"},
    {"pattern": r'sent the spec back to a full analysis: ', "solution": "Analyze runs again"},
    {"pattern": r'asked to send the spec back to a full analysis', "solution": "press Analyze again for a new plan"},
    {"pattern": r'plan to change the same files as this spec', "solution": "add them to this spec's Depends on"},
    {"pattern": r'wrote a short analysis for a spec', "solution": "Analyze runs again and writes the full analysis"},
    {"pattern": r'wrote outside its own spec folder', "solution": "press $step_button again"},
    {"pattern": r'the merge with main it was handed open was dropped', "solution": "press $step_button again"},
    {"pattern": r'left no real progress', "solution": "press $step_button again"},
    {"pattern": r'changed things outside analyze', "solution": "press $step_button again"},
    {"pattern": r'stopped when one run of the project.s tests reached its own', "solution": "press $step_button again to test it"},
    {"pattern": r'error_msg="stopped at its own .* time limit for this step;', "solution": "press $step_button again to carry on"},
    {"pattern": r'provider limit reached', "solution": "once it resets"},
    {"pattern": r'is at capacity right now', "solution": "press $step_button again"},
    {"pattern": r'the model declined to continue', "solution": "choose another model for this step"},
    {"pattern": r'without giving a reason"', "solution": "its output is in this step's log"},
    {"pattern": r'made the spec folder in the wrong place', "solution": "press $step_button again for this step"},
    {"pattern": r'made no spec folder named', "solution": "press $step_button again for this step"},
    {"pattern": r'no test ran because the runner could not work out', "solution": "fix AIDE_TEST_CMD"},
    {"pattern": r'aide_spec_reference .* was not found on the spec.s branch', "solution": "once the folder is back in place"},
    {"pattern": r'did not write a readable result', "solution": "once the recorder is working"},
    {"pattern": r'tests stopped when the server needed by', "solution": "once that server can start"},
    {"pattern": r'could not start because Docker is not running', "solution": "start Docker on this machine"},
    {"pattern": r'could not start because nothing answered on port', "solution": "start the service that listens on port"},
    {"pattern": r"tests are red on its result", "solution": "press $step_button again for this step"},
    {"pattern": r"could not be committed in", "solution": "fix the checkout on the serving host"},
    {"pattern": r"the close moved nothing: a merge is still open", "solution": "finish or abort that merge"},
    {"pattern": r"the close moved nothing: \$\{close_said:-the spec is archived\}", "solution": "press Reopen for it first"},
    {"pattern": r'the close moved nothing: \$close_said"', "solution": "once that is put right"},
    # --- nothing to resolve ------------------------------------------------
    {"pattern": r'"error":"jq is required"', "exempt": "the machine that runs the board has no jq, which the install checks for"},
    {"pattern": r'"error":"unknown argument', "exempt": CALLER},
    {"pattern": r'refuse "(missing|invalid|no such) ', "exempt": CALLER},
    {"pattern": r'refuse "(--chrome|--no-sandbox|--bin is for|not a git repository|no specs root|unknown spec|\$spec_reference is already active)', "exempt": CALLER},
    {"pattern": r'refuse "the (Claude account|Codex folder|Review or Verify account|provider.s binary path)', "exempt": CALLER},
    {"pattern": r'refuse "(worktreeLinks|the worktree base|cannot resolve the worktree base)', "exempt": CALLER},
    {"pattern": r'refuse "spec \$spec_reference (depends on|cannot depend)', "exempt": "the board holds the spec before the press and says why on the row"},
    {"pattern": r'refuse "\$transition_message"', "exempt": "the phase table words it, and the board refuses these at the press"},
    {"pattern": r'refuse "cannot work out the default branch', "exempt": "the checkout is named; the landing's sentence for it carries the fix"},
    {"pattern": r'refuse "cannot (check out|fetch)', "exempt": "git's own words, kept whole as the detail"},
    {"pattern": r'refuse "\$spec_reference was moved back out of archive/', "exempt": "git's refusal in the specs checkout, named in the sentence"},
    {"pattern": r'refuse "no such --prompt-file', "exempt": CALLER},
    {"pattern": r'error_msg="\$\(jq -r \'\(\.error', "exempt": PROGRAM},
    {"pattern": r'stop_step "\$archive_reason"', "exempt": PROGRAM},
    {"pattern": r'\$\(jq -r \'\.error // "aide-', "exempt": PROGRAM},
    {"pattern": r'error_msg="\$\(jq -r \'if \(\(\.errors', "exempt": TOOL},
    {"pattern": r'error_msg="\$\(jq -r \'\(\.errors', "exempt": TOOL},
    {"pattern": r'error_msg="\$\(tail -c 400', "exempt": TOOL},
    {"pattern": r'produced no result JSON', "exempt": TOOL},
    {"pattern": r'\[ -n "\$reset_at" \] && error_msg=', "exempt": "a clause added to the provider-limit message, whose fix stands beside it"},
    {"pattern": r'\[ -n "\$step_tests_holder" \] && error_msg=', "exempt": "a clause added to the test-server message, whose fix stands beside it"},
    {"pattern": r'could not run: \$\{side_error', "exempt": "the Review or Verify turn's own failure; the step's outcome is put back after it"},
]
