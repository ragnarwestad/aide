---
paths:
  - "core/scripts/lib/run-spec/checkout/*"
  - "core/scripts/lib/run-spec/publish/*"
---

A git command that failed, timed out or was killed is no evidence that a checkout, worktree or branch is missing or invalid. Only an answer from git that says so is. Check every place the diff reads a git failure: when the code concludes "missing", "invalid" or "not a copy" from a non-zero exit, a timeout or empty output, and then reports it, refuses the run or changes state on that ground, that is a defect. The concrete case is git failing once under load on a checkout that is fine.

Recovering from any failure never deletes, replaces, resets or re-clones a directory, worktree or branch that already exists, and never removes the project's own checkout. Check every `rm`, `git worktree remove`, `git reset --hard`, `git clean`, `git branch -D` and fresh `git clone` the diff adds or reaches: when it can run on a path that already holds a checkout or work nobody has merged, that is a defect.

A list of folders or paths the runner refuses, links or copies is defined once and read from there. A second copy of such a list the diff adds, or a check that reads one copy while the other side reads another, is a defect when the two can differ.
