## Problem

Two specs append to the same place in the same file.

## Solution

Append a second fact. Landed after the first, this branch conflicts with it, and
archive has to resolve the conflict, keep both facts, and see the tests green.
