## Problem

Archive is held back until a person has judged every row under Acceptance
criteria — that is the row's whole point, and nothing should be able to
tick it for itself.

## Solution

Analyze writes an Acceptance criteria section with one row nobody ticks,
so the row is on the default branch and the Checks tab can offer it while
implement's own work is still on its branch. Archive must refuse with
acceptance-criteria-unticked, and the branch stays where it is.
