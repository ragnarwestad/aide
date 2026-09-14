## Problem

Code with a red test must not reach main.

## Solution

Implement writes a test for a fact it never adds. The runner runs the project's
tests on implement's result itself: red ends the step as failed with the
failing test in the detail, implement is not recorded as run, archive never
starts, and the branch stays where it is.
