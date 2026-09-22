---
paths:
  - "src/serve/**"
  - "test/serve/**"
---

# Signalling a process group

- **`process.kill(-pid)` is written in one file: `serve-helpers/signal-group.ts`.**
  `signalGroup`/`signalProcess` refuse any pid below 2, because `-1` is
  every process the user owns — the served dashboard, the terminal, the
  browser, the login session. A record that says `wrapperPid: 1` or
  `pgid: 0` is dropped, never signalled. `test/serve/signal-group.test.ts`
  fails on a second `process.kill(-` anywhere under `src`, and every test
  file whose fixtures carry made-up pids spies `process.kill` for the
  whole file.
