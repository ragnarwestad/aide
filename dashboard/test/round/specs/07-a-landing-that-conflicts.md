## Problem

A conflict nobody resolves must fail the landing, and the row must say so.

## Solution

Implement appends a fact and, behind the branch's back, lands a competing line on
main. Archive leaves the conflict open, so the landing cannot merge the branch:
the job fails, the branch stays on origin, and the archive line reads failed.
