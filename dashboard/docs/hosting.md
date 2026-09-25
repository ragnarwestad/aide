# Hosting the dashboard

Where the dashboard is served from, how HTTPS is put in front of it, how to stand one up on a second machine or
run the whole thing on one, and what the host does on its own once it is there.

Moving an EXISTING board is not one operation: it is a fresh install on the new machine, plus carrying over the
directories [Moving the board's own directories](#moving-the-boards-own-directories) lists, plus stopping the old
machine's launchd job. Nothing here automates that.

Two pages sit beside this one:

- [The dashboard's README](../README.md#installation) — installing it in the first place
- [Tailscale](tailscale.md) — the optional way to reach it from a phone or another computer

## Table of contents

- [HTTPS and other devices](#https-and-other-devices)
- [A proxy's own header](#a-proxys-own-header)
- [Installing it as an app](#installing-it-as-an-app)
- [On a second host](#on-a-second-host)
- [Moving the board's own directories](#moving-the-boards-own-directories)
- [Naming your machines once, in .env.deploy](#naming-your-machines-once-in-envdeploy)
- [Running it without a second host](#running-it-without-a-second-host)
- [Keeping the host's specs current](#keeping-the-hosts-specs-current)
- [Reviewing what an unattended run writes](#reviewing-what-an-unattended-run-writes)
- [Not written down yet](#not-written-down-yet)
- [Known gaps](#known-gaps)

---

## HTTPS and other devices

An installed board binds `127.0.0.1` and answers on the machine it runs on alone, at `http://127.0.0.1:8788` —
`BIND` in the Makefile puts it there. The server's own default, with no `--bind`, is `0.0.0.0`. HTTPS, and
reaching it from a phone or another computer, come from a proxy on the serving host that terminates TLS and forwards
to that address; the dashboard does no certificate handling of its own. Keep `BIND` at `127.0.0.1` behind such a
proxy, so the port is not open on the local network too. The proxy passes the client's `Host` on, which has to be one
of the dashboard's own names ("Which requests the dashboard answers" in `running-specs.md`); `allowedHosts` in `queue-config.json` — the file `--queue-config` names, which the installed job puts at
`~/.aide/dashboard/queue-config.json` — adds
the proxy's. The dashboard's README, under Installation, points to one way to set one up.

Installing the dashboard as an app on a phone or a desktop needs HTTPS: a service worker needs a secure context.

## A proxy's own header

A proxy in front of the dashboard that signs its readers in already knows who the reader is — it sends the
signed-in user's name as a request header on every request it forwards. `headerAuth`, an optional block in `queue-config.json`, names
that header and the identifiers allowed in it. The dashboard asks for no sign-in, so the block is read and checked at
start-up and gates nothing:

```json
{
  "headerAuth": {
    "header": "X-Forwarded-Email",
    "users": ["alice@example.com"]
  }
}
```

**Only honoured when `BIND` is `127.0.0.1` (or `::1`).** A header from anywhere else can be set by anyone who can
reach the port, so a server bound to any other address — `0.0.0.0` included — refuses to start at all while
`headerAuth` is set, with a message naming both the header and the offending bind address. This is the same
loopback requirement "HTTPS and other devices" above already puts on the whole deploy, so a serving host that
already binds `127.0.0.1` needs nothing further to turn this on.

**Nothing in the dashboard matches that header against `users` today** — the key is parsed and its shape checked,
and the only thing the server does with it is refuse to start when it is set alongside a non-loopback bind. Were
the match implemented, it would be exact-string, not a prefix or a domain suffix. Some proxies carry more than the bare identifier — Google
IAP's header, for instance, prefixes it with `accounts.google.com:`. Whatever the proxy actually sends has to be the
literal string listed in `users`; a looser match (a suffix, a substring) would risk admitting more than intended, and
a wrong guess about the prefix is safer refused than silently widened.

Headers some proxies send, for the `header` above:

- **oauth2-proxy** — `X-Forwarded-Email`
- **Cloudflare Access** — `Cf-Access-Authenticated-User-Email`

Every caller — the proxy's readers, API callers and the spec 80 emitter — is held to the same rule, whether or not
`headerAuth` is set.

## Installing it as an app

The served dashboard is a web app you can install: Chrome and Edge offer it from the address bar, and iOS Safari from
Share → "Add to Home Screen". It then opens in a window of its own, with the mark as its icon and the page's own
background behind the title bar.

An installed app is launched on `start_url` — `/`, with no query string — and opens straight into the spec list.

Nine routes make it work — `/manifest.webmanifest`, `/sw.js`, `/icon-512.svg`, `/icon-512-maskable.svg`,
`/icon-192.png`, `/icon-512.png`, `/icon-512-maskable.png`, `/apple-touch-icon.png` and `/badge-96.png`. All nine are
computed in `src/render/ui/pwa.ts`, so nothing has to be kept in sync by hand. The served board answers all nine from
memory — no file behind any of them. The five PNGs are drawn
from the SVG icons at start-up (`src/render/ui/icon-png.ts`); Chrome on Android offers an install, not a home-screen
shortcut, only when the manifest lists raster icons of 192 and 512 pixels and a maskable one. A browser will not install a page whose manifest is a data URI, which is why these are
routes at all; they answer any request with a `Host` of the dashboard's own. The spec page fetches one more thing —
its own editor or viewer script — and everything else a page needs is carried inline.

**A notification carries the mark.** A push names `/icon-192.png` as its icon — the picture in the notification — and
`/badge-96.png` as its badge, the small glyph Android draws in the status bar. The badge is the only image here with an
alpha channel, and that is the whole reason it exists separately: Android draws a badge as a white silhouette of
whatever is opaque, so an app icon, whose background covers the canvas, silhouettes to a solid square. `/badge-96.png`
is the four bars with nothing behind them. Named by the service worker alone — it is not an app icon, so the manifest
does not list it.

The service worker caches **nothing**. Every line of this dashboard is live state, and a queue served out of yesterday's
storage would be worse than no app at all: it passes every request through to the server and answers a page load with a
short "not reachable" page when the server is out of reach. That is all it is for — that, and being what a browser
looks for before it offers to install anything.

The worker also shows a notification for every push the server sends and opens the spec on a tap; which events send
one, and what is kept, is in [Running specs](running-specs.md#push-notifications-on-a-phone-or-laptop). A device can
receive them only where the worker can run, so the same HTTPS requirement applies, and on iOS only from the installed
app.

None of this works over plain HTTP: a service worker needs a secure context, which is what "HTTPS and other devices"
above is about.
The manifest and the icons are served either way, and the tags on the page are inert until then.

## On a second host

`MINI=<host> make install-serve` first runs `deploy/check-prerequisites.sh` there, and stops if Aide, bun, jq or
git is missing — or if the host has no `launchctl`, or the user has no GUI login session, which is the likeliest
of the six to bite on a fresh machine. Then it clones or pulls the repo there (the clone URL comes from this checkout's own `origin`),
installs deps, renders a launchd plist and starts the job. No plist is committed:
`deploy/render-plist.ts` builds it per invocation from the target's own
`$HOME`, resolved over ssh at install time. Logs go to
`~/Library/Logs/aide-dashboard/serve.log` on that host. Every line there
carries the moment it was written, and a test board that the dashboard
stops gets a line saying who asked and which process group was signalled.

**The repo it clones there is the dashboard's OWN checkout —
`~/.aide/dashboard/checkouts/aide/code` — not a checkout a user edits.** That is the directory a code landing merges
into and runs
`AIDE_INSTALL_CMD` in. The landing never restarts the launchd job: a restart mid-run kills every job's process, and
no rule for a safe moment held up. It logs that the served page runs older code than main, and the user restarts
when it suits — the Deploy button on the project's own page (`/projects/aide`) reinstalls and restarts. The reinstall
drops from the launchd job's plist every option the serve code no longer accepts, since a job still passing one would
not start again, and the restart takes the job down and loads it from that plist. By hand on the host,
`launchctl kickstart -k gui/$(id -u)/com.aide-dashboard.serve` restarts it on the arguments it was loaded with; after
changing the plist, `launchctl bootout` and `launchctl bootstrap` it instead. The button's restart step answers before the restart
fires; the dialog then waits for a process with a new `startedAt` to answer `/api/version`, checks it, and reloads the page. While jobs are
running the restart waits for them (two hours at most), and every page shows a warning line under the header naming
them until it fires. Point the job anywhere else and a restart
reloads code the landing never touched — the served page then sits on old code with every row reporting
success. `GET /api/version` answers the commit SHA the running process actually booted with, read once at start and
never refreshed, and `startedAt`, when that process booted — it needs no credential, so a restart check can reach it. The path is written once in the Makefile (`MINI_REPO`) and once in
`src/git/dashboard-checkout.ts` (`dashboardCheckoutRoot`), and
`test/git/checkout/install-serve-paths.test.ts` reads both and fails if they disagree.

`install-serve` creates that checkout itself, with plain `git clone`
over ssh, so a fresh host needs neither the checkout nor a running service beforehand. Once the service boots from it,
its own periodic
`ensureDashboardCheckout` keeps it current from then on.

**An already-installed service migrates by re-running the same command.** `make install-serve` is idempotent and is
already the documented upgrade path (`deploy-serve: install-serve`) — it rewrites the plist with the new location and
restarts the job. Nothing else is needed, and the user's own checkout on that host goes back to being just a working
copy: no service reads from it, so letting it fall behind stops mattering.

**Check your `.env.deploy` for a `MINI_REPO` override before upgrading.** It is gitignored and per-machine, so a host
that names its own checkout there keeps pointing the service at that checkout — which is the exact bug above,
reintroduced for that one operator. Remove the line and let the default apply.

Everything is overridable, nothing personal is baked in:

All paths are relative to the serving host's own `$HOME`.

| Variable         | Default                               | What it is                                                        |
|------------------|---------------------------------------|-------------------------------------------------------------------|
| `MINI`           | — required                            | the ssh target                                                    |
| `PORT`           | `8788`                                | port to serve on, behind the proxy                                |
| `MINI_REPO`      | `.aide/dashboard/checkouts/aide/code` | the repo to clone or pull — the dashboard's own checkout          |
| `MINI_SRC`       | `$(MINI_REPO)/dashboard`              | the directory bun runs in, and what the plist points at           |
| `REMOTE_STATE`   | `.aide/dashboard`                     | mirrors, queue state, logs                                        |
| `REMOTE_BUN`     | `.local/share/mise/shims/bun`         | bun on that host                                                  |
| `LABEL`          | `com.aide-dashboard.serve`            | launchd job label                                                 |
| `QUEUE_PROJECTS` | `aide`                                | the allowlist's first-boot seed                                   |
| `ROOT`           | `.aide/dashboard/projects`            | projects root there — see below                                   |
| `BIND`           | `127.0.0.1`                           | address to bind                                                   |

**The projects root is a directory of links to the dashboard's own checkouts.** The dashboard lists projects from
`ROOT` and lands their work in `.aide/dashboard/checkouts/<project>/code`; when those are two different copies, the list
lags the landings until someone pulls the listed copy, and a `.aide/config` has to exist in both. So on the serving host
`ROOT` is `.aide/dashboard/projects/`, holding one symlink per project to `.aide/dashboard/checkouts/<project>/code` — the
one copy the dashboard both reads and writes. A project with no checkout of its own (a scratch project) links to
wherever it lives. With `ROOT` unset, `install-serve` makes that directory and links the `aide` checkout into it, and
Add on the Projects page clones a new project into its checkout and makes its link. Each linked checkout keeps its own `.aide/config`, written by the dashboard when it clones the
project.

## Moving the board's own directories

Everything the dashboard owns — its checkouts, projects root, worktrees,
`site`, `jobs`, `pdf-cache`, `schedule-output`, `round-logs` and the JSON
mirrors — lives under one directory, `~/.aide/dashboard/`. It used to be
`~/aide-dashboard/`, a name indistinguishable from the code project's
own; `.aide` is the name Aide already gives what is configuration, and
`dashboard` says whose it is. Moving an already-running installation is
a one-time, per-host operation — nothing in a code deploy does it for you.

**Do this with the service stopped, not merely with the queue empty.**
Checking that nothing is `running` or `queued` on the dashboard's own
page says nothing about a job someone starts in the next five minutes.
`launchctl bootout gui/$(id -u)/com.aide-dashboard.serve` (over ssh, or
on the host) stops the process that could start one, for the whole
duration of the move. Stop every test server too: each runs from a
worktree of the moved checkout.

**Move the directory before you deploy the new code, never after.**
`install-serve` decides whether to `git clone` or `git -C ... pull` by
whether `MINI_REPO` already has a `.git` in it. Deploy the code first and
the new default (`.aide/dashboard/checkouts/aide/code`) is empty, so
`install-serve` clones fresh there instead of continuing the checkout
still sitting at the old name. Move first, and `install-serve` finds the
same checkout, `.git` and all, right where the new default now looks for
it. Three things inside the directory carry the old absolute path and
are repaired after the move: the symlinks in `projects/` (one per
project, into `checkouts/`), git's own record of every worktree cut from
a moved checkout (`git worktree repair`), and the launchd plist, which
`install-serve` rewrites.

    set -e
    mkdir -p ~/.aide
    mv ~/aide-dashboard ~/.aide/dashboard
    cd ~/.aide/dashboard/projects
    for l in *; do t="$(readlink "$l")"; case "$t" in "$HOME/aide-dashboard/"*) ln -sfn "$HOME/.aide/dashboard/${t#"$HOME"/aide-dashboard/}" "$l" ;; esac; done
    for r in ~/.aide/dashboard/checkouts/*/code ~/.aide/dashboard/checkouts/*/specs; do git -C "$r" worktree repair >/dev/null 2>&1 || true; git -C "$r" worktree prune; done

Update `.env.deploy` on this machine to match — `ROOT=.aide/dashboard/projects`,
and drop any `MINI_REPO` override, since the new default already names
the moved checkout. Then run the ordinary upgrade:

    MINI=<host> make -C dashboard deploy-serve

which re-clones-or-pulls (a pull, now that the checkout moved with its
`.git` intact), rewrites the plist with the new `--root`, and restarts
the job — exactly the path every other upgrade already takes.

**A job started anyway, mid-move, does not corrupt anything — it leaves
a stray, mostly-empty directory behind at whichever old name the code it
is running still points at.** `ensureDashboardCheckout` treats a missing
checkout as a first use and clones a fresh one; `run-spec-checkouts.sh`
treats a missing worktree base as new and `mkdir -p`s it. Neither one
errors, and neither one touches the data already moved — but that run's
own checkout or worktree now lives in a directory this procedure is
about to leave behind, so treat it as failed and re-queue it once the
move is finished, and remove the stray directory by hand.

The header's own machine name (`boardText()` in `dashboard/src/render/ui/shell.ts`) is `AIDE_DASH_HOST` when it is
set, and the serving machine's `hostname()` otherwise.

## Naming your machines once, in .env.deploy

Copy `.env.deploy.example` to `.env.deploy` and fill in your own machines. The Makefile includes it, so
`make install-serve` stops needing a wall of variables on the command line. The file is gitignored — which is the point: the
tracked repo names nobody's machine, and this is where yours lives instead.

## Running it without a second host

`dashboard/install.sh` (`make install-local`) is `install-serve` on the machine it runs on: the same prerequisite
check, checkout, plist and launchd job, with a local shell in place of ssh. It takes the same variables, except
`MINI`.

`dashboard/serve.sh` is the same service with no launchd, for Linux: the same arguments and state, run in a terminal
until it is stopped. It refuses to start where the launchd service already runs, since two servers on one state would
run the same queue twice.

`make serve-local` serves the checkout it is run in, from the same machine — no build step, no ssh, no rsync, no
launchd, no second host involved. `PORT=` and an optional `ROOT=` (the directory to scan for projects) are the only
knobs. It is for trying a change, not as a service.

## Keeping the host's specs current

**The board keeps its own copy current by itself.** It lists specs from the clone it owns,
`~/.aide/dashboard/checkouts/<project>/specs`, and its own sweep fetches and fast-forwards that clone for every
allowed project. A spec pushed from another machine reaches the list without anyone doing anything.

What is NOT pulled is the person's own checkout on that host — the one under `~/develop`, which a project was added
from and which somebody working on the host edits. `aide-pull-specs` is the unattended pull for that:

```bash
aide-pull-specs ~/develop/aide-specs [~/develop/other-specs ...]
```

Two cases make it worth a cron entry. A project with no `origin` has no clone of its own, so the board reads that
checkout directly and a stale one is a stale list. And anyone working on the host — over ssh, or at the screen —
wants it current for the same reason they would on a laptop.

Each repo is pulled only when it is safe to do so with nobody watching: a git working tree, no uncommitted changes
to TRACKED files — an untracked scratch file is no obstacle to a fast-forward and does not stop it — sitting on its
own default branch, and a fast-forward. Anything else is skipped with a reason on stdout, and the repos beside it
are still pulled. Nothing is ever committed, merged or reset. A repo already up to date prints nothing, so a cron
entry mails only when something happened.

Installing it is by hand, once, on the host. Every two minutes:

```cron
*/2 * * * * $HOME/.local/bin/aide-pull-specs $HOME/develop/aide-specs
```

**Point it at specs, not at code.** Merging code and installing it belong together (`AIDE_INSTALL_CMD`), and a
background pull would move the code under a server that goes on running the old version — merged, but not
deployed, and reported as deployed. Code that landed some other way is REPORTED instead of pulled: for every
project that has an install command configured, the project's Deploy tab compares the checkout against `origin`
and says how many commits behind it is, and which commit the service runs. It only ever looks; nothing there
fetches more than the default branch, and nothing merges, pulls or moves a checkout.

## Reviewing what an unattended run writes

A step on this host writes code with nobody reading it, and the landing's test gate asks only whether the suite is
green. The `security-guidance` plugin is a second opinion on that code, installed for the user the service runs
as:

```bash
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install security-guidance@claude-plugins-official
```

It is hooks, not skills, so it costs a run no context: a regex check on every `Edit`/`Write`, and a review of the
diff by a separate model call — at the end of a turn AND at the end of every subagent. A skill that fans work out
to agents therefore triggers one per agent, not one per step. Findings reach the session that wrote the code,
before the step finishes. It needs `python3` on the PATH the hooks are started with — `/usr/bin/python3` is
enough — and it spends on the same AI account the runs do.

**Read its log before trusting it, and read it here rather than on a laptop.** Every firing is recorded in
`~/.claude/security/log.txt`:

```bash
grep -E "LLM code review|reviews took|empty review set" ~/.claude/security/log.txt | tail -20
```

`empty review set` means the turn changed no files, which is the ordinary answer for a turn that only ran git.
A line naming the review and one saying how long it took is a real run, and the log is where to see what the
extra seconds per file-writing turn come to inside a step's own time limit.

## Not written down yet

What an operator needs and will not find here, or anywhere else in these pages:

- **Backup and restore.** The host owns state nothing else has: `queue.json` and the other mirrors, the jobs
  directory, the checkouts, the worktrees. Nothing says which of it is precious, which regenerates itself, or how
  to take a copy.
- **How the host authenticates.** The runs use an AI account and push over git; a keychain that locks after a
  reboot is the classic unattended failure, and nothing here says how to check either.
- **A health check.** `GET /api/version` answers with the commit the service booted and when, and that is the whole of it:
  no liveness check, and nothing on what launchd does when the process dies.
- **Disk growth.** `serve.log`, `~/.claude/security/log.txt`, the jobs directory, `pdf-cache`, `round-logs` and the
  worktrees all grow, and nothing prunes any of them.
- **Decommissioning a host.** Stopping the job is `launchctl bootout`; what to remove afterwards is not written.

## Known gaps

The Deploy button's restart is not gated on `isDashboardRoot`. A landing never restarts anything; it uses
`isDashboardRoot` (`land-branch/merge.ts`) to decide whether to LOG that the served page now runs older code than
main. The Deploy button's `restart` step (`routes/deploy-steps.ts`) does restart, and carries no equivalent
check: pressing Deploy on any project with an install command, on a host where this dashboard's own
launchd job is registered, triggers the same restart wait and fire. No current page depends on this
being scoped further, since the Deploy tab's own `serving` comparison only ever exists for the
dashboard's own project — but a future project added to the dashboard whose install is slow or
disruptive would restart the dashboard itself as a side effect of deploying something unrelated.
