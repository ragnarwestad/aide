#!/bin/bash
tmp="/Users/ragnarwestad/aide-worktrees/code/215-a-run-leaves-no-branch-that-blocks-the-next-run/code/.scratch-215/work"
mkdir -p "$tmp"
cd "$tmp"
git init -q repo
cd repo
git commit -q --allow-empty -m init
git branch -M main

echo "=== run1: create worktree+branch, no new commits, then remove worktree only ==="
git worktree add -q -b aide/spec1 ../wt1 main
git worktree remove --force ../wt1
git worktree prune

echo "--- branches after run1 ---"
git branch -a
echo "--- worktree list after run1 ---"
git worktree list

echo "=== run2: delete branch since tip==base (trivially landed), then recreate ==="
git branch -D aide/spec1
echo "delete exit code: $?"
git branch -a

echo "--- attempt recreate ---"
git worktree add -q -b aide/spec1 ../wt2 main
echo "worktree add exit code: $?"
