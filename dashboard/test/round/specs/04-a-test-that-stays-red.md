## Problem

Code with a red test must not reach main.

## Solution

Implement writes a test for a fact it never adds. The tests are red, so archive
must refuse with no passing test record, and the branch stays where it is.
