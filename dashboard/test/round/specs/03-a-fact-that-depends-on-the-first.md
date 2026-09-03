## Problem

A spec that names a dependency must wait for it.

## Solution

Append a fact. Implement and archive are held back until the first spec is
archived; analyze runs regardless.
