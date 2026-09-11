## Problem

A conflict nobody resolves must fail the landing, and the row must say so.

## Solution

Implement appends a fact. Archive does its work and then, behind the branch's
back, lands a competing line on main — as if someone landed by hand between the
step and its landing. The landing cannot merge the branch: the job fails, the
branch stays on origin, and the archive line reads failed.
