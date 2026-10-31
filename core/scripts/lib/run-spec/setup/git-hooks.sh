#!/usr/bin/env bash
# run-spec/setup/git-hooks.sh — sourced by aide-run-spec before anything
# that runs git.
#
# The runner's own git runs no hooks. A hook is a program git starts by
# itself, and the runner runs git outside the sandbox, after a step has
# written to the working tree; a hook that reads the working tree (a
# relative `core.hooksPath`, lefthook's `lefthook.yml`) would run what the
# step wrote. Every `git` in this script and the files it sources is this
# function. It is not exported, so what the runner starts — the AI tool,
# the project's test command, the spec scripts — runs git as it would
# anywhere else. The landing does the same in `NO_GIT_HOOKS`
# (dashboard/src/integrations/no-git-hooks.ts).
git() { command git -c core.hooksPath=/dev/null "$@"; }
