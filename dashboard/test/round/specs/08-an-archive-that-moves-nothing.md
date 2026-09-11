## Problem

A step that says it is done without having done anything must not pass as done.

## Solution

Implement appends a fact. The archive session moves the spec folder back out
of archive/ and still reports success — the runner's own cross-check finds
the folder where it was, the job fails, and the row says the folder was never
moved.
