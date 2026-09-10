.PHONY: test test-e2e test-all generate publish serve-local require-host install-serve deploy-serve

# Your machine's answers to the questions this Makefile refuses to guess
# — MINI, ROOT, BIND. Gitignored, because naming them here
# is exactly what spec 03 took out of the tracked files. Optional: with
# no file, every variable is still settable on the command line.
# See .env.deploy.example. Included FIRST so it wins over the `?=`
# defaults below.
-include .env.deploy

# rsync-publish.sh reads this from the ENVIRONMENT, and make does not
# pass its own variables to a recipe's shell unless told to. Without
# this line `make publish` refuses to run even with .env.deploy in
# place — the variable is set, just not where the script looks. (A
# value given on make's command line is exported automatically; one
# that comes from an included file is not, which is the case here.)
export AIDE_DASH_HOST

# The gate a merge runs, and the one to run while working: everything
# except the browser tests below.
#
# `test/e2e` is left out because those are the only tests that can fail
# with nothing wrong. They drive a real Chromium and measure what it
# painted, so on a host running several Claude sessions and another
# suite they lose to load and stop a merge that carried no fault --
# three times on 2026-09-05, once with 201 dangling processes killed at
# the end of the run. The other four thousand only compute, and never
# noticed. They also answer a different question from the one a merge
# asks: whether the page looks right, not whether the change broke
# something.
test:
	bunx tsc --noEmit
	# 20 s per test, not bun's 5 s: the git-backed route tests run beside
	# three other jobs' suites on the serving host and lose to load alone.
	# `--path-ignore-patterns`, not a list of directories to include:
	# tests live under `src/` too (the message catalogue's own), and
	# naming the directories left them out.
	bun test --timeout 20000 --path-ignore-patterns='**/test/e2e/**'

# The browser tests, on their own, for a quiet machine. Run them when
# layout or the page's own behaviour changed -- they are not part of
# `test`, so nothing runs them for you.
test-e2e:
	bun test --timeout 20000 test/e2e

# Both, for the rare time you want the lot.
test-all: test test-e2e

generate:
	bun run src/main.ts generate

publish: generate
	deploy/rsync-publish.sh

PORT ?= 8788
# Where `tailscale serve` terminates TLS in front of that port. 443 gives
# an address with no port at all; a host already using 443 for something
# else sets this instead. A variable rather than a literal because every
# other network value in install-serve is one.
TS_PORT ?= 443
# WHERE tailscale is, not whether the shell can find it. `ssh host 'cmd'`
# runs a NON-INTERACTIVE shell, which on macOS reads none of the login
# files that put /usr/local/bin on PATH — so `command -v tailscale` said
# "no" on a host that has it, the guard below took its absent-branch, and
# `install-serve` reported the plain deploy while quietly setting up no
# TLS at all (measured 2026-08-22, one deploy after spec 172 landed). The
# same trap caught `tmux` and `claude` over ssh the day before. A path
# rather than a lookup, and a variable so a host that keeps it elsewhere
# can say so.
TAILSCALE ?= /usr/local/bin/tailscale

# Generate and serve on THIS machine: no ssh, no rsync, no launchd.
# ROOT is optional — serve.ts only needs it to build the project nav,
# and a built-in default would name someone's checkout location.
serve-local: generate
	bun run src/serve/serve.ts serve --site out --port $(PORT) $(if $(ROOT),--root $(ROOT))

# --- Serving on a second host ------------------------------------------
# MINI is the ssh target and has NO default: a deploy aimed at a machine
# nobody named is worse than a deploy that refuses to start.
# Every path below is relative to that host's own $HOME, resolved over
# ssh at install time — never assumed from this machine.
# Two paths, not one: the dashboard's source is a subdirectory of the
# aide repo (spec 85), so the thing to clone is not the thing bun runs
# in. They were the same path back when the dashboard was its own repo,
# which is why one variable used to do both jobs.
#
# The checkout the SERVICE runs from is the dashboard's OWN (spec 205),
# never a person's. A landing merges the code there and runs
# AIDE_INSTALL_CMD there, then restarts this launchd job — so a job
# pointed at somebody's `develop/aide` reloads the code the landing did
# not touch, which is exactly what happened twice on 2026-08-24 (spec
# 223). `install-serve` clones or pulls this path directly over ssh: on
# a fresh host the service is not running yet, so nothing else can
# create it first, and once it boots the service's own periodic
# `ensureDashboardCheckout` takes over keeping it current. Must match
# `dashboardCheckoutRoot(DEFAULT_DASHBOARD_CHECKOUT_ROOT, "aide")` in
# dashboard/src/dashboard-checkout.ts — kept in sync by
# test/install-serve-paths.test.ts.
MINI_REPO ?= aide-dashboard/checkouts/aide/code
MINI_SRC ?= $(MINI_REPO)/dashboard
REMOTE_STATE ?= aide-dashboard
# bun via the mise shim: bare `bun` is not on launchd's PATH.
REMOTE_BUN ?= .local/share/mise/shims/bun
# A project identifier, not a per-operator one.
LABEL ?= com.aide-dashboard.serve
# The BOOTSTRAP seed only. Since spec 112 the allowlist lives in
# queue-config.json on the serving host, where the Projects panel on /
# writes it — so this value is what a host with no such file yet starts
# from, and is ignored once that file has a `projects` array. Changing it
# here does not change the allowlist on a host that has one.
QUEUE_PROJECTS ?= aide,aide-dashboard
REPO_URL := $(shell git config --get remote.origin.url)

require-host:
	@if [ -z "$(MINI)" ]; then \
		echo "MINI is not set — name the host to deploy to" >&2; \
		echo "(example: MINI=my-server make install-serve)" >&2; \
		exit 1; \
	fi

# Deploy the server on the serving host: clone-or-pull the source,
# install deps, render and install the plist, (re)start the launchd job.
# Idempotent.
install-serve: require-host
	ssh $(MINI) 'if [ -d $(MINI_REPO)/.git ]; then git -C $(MINI_REPO) pull -q --ff-only; \
		else git clone -q $(REPO_URL) $(MINI_REPO); fi && \
		cd $(MINI_SRC) && ~/$(REMOTE_BUN) install --silent'
	@home=$$(ssh $(MINI) 'echo $$HOME') && \
	plist=$$(mktemp -t aide-dashboard-plist) && \
	trap 'rm -f "$$plist"' EXIT && \
	bun run deploy/render-plist.ts \
		--label $(LABEL) \
		--bun-path "$$home/$(REMOTE_BUN)" \
		--script "$$home/$(MINI_SRC)/src/serve/serve.ts" \
		--working-directory "$$home/$(MINI_SRC)" \
		--log-path "$$home/Library/Logs/aide-dashboard/serve.log" \
		-- serve \
		--site "$$home/$(REMOTE_STATE)/site" \
		--port $(PORT) \
		--mirror "$$home/$(REMOTE_STATE)/aide-runs.json" \
		--queue-mirror "$$home/$(REMOTE_STATE)/aide-queue.json" \
		--token-file "$$home/$(REMOTE_STATE)/queue-token" \
		--result-dir "$$home/$(REMOTE_STATE)/jobs" \
		--queue-config "$$home/$(REMOTE_STATE)/queue-config.json" \
		--runner-bin "$$home/.local/bin/aide-run-spec" \
		--pdf-bin "$$home/.local/bin/aide-generate-pdf" \
		--queue-projects "$(QUEUE_PROJECTS)" \
		$(if $(ROOT),--root "$(ROOT)") \
		$(if $(BIND),--bind "$(BIND)") \
		> "$$plist" && \
	scp -q "$$plist" $(MINI):Library/LaunchAgents/$(LABEL).plist
	@# `bootout` returns before the job is gone. Bootstrapping into that
	@# gap fails with "Bootstrap failed: 5: Input/output error" and
	@# leaves NOTHING running — the old job is already dead. Measured on
	@# the 2026-08-17 move into aide/dashboard, after five earlier
	@# deploys where the old process happened to die fast enough. Wait
	@# for the label to actually disappear, and say so if it never does
	@# rather than bootstrapping into a failure.
	ssh $(MINI) 'set -e; mkdir -p Library/Logs/aide-dashboard $(REMOTE_STATE)/site; \
		launchctl bootout gui/$$(id -u)/$(LABEL) 2>/dev/null || true; \
		for i in $$(seq 1 50); do \
			launchctl print gui/$$(id -u)/$(LABEL) >/dev/null 2>&1 || break; \
			sleep 0.2; \
		done; \
		if launchctl print gui/$$(id -u)/$(LABEL) >/dev/null 2>&1; then \
			echo "$(LABEL) is still loaded after 10s — not bootstrapping over it" >&2; \
			exit 1; \
		fi; \
		launchctl bootstrap gui/$$(id -u) Library/LaunchAgents/$(LABEL).plist'
	@# Put TLS in front of the server (spec 172). `--bg` persists the rule
	@# in tailscaled's own state, so this is a re-run-per-change step, not
	@# a job of its own — which is why it belongs here rather than in
	@# someone's memory. A host without tailscale keeps the plain deploy
	@# it has always had; only a host WITH tailscale and the wrong BIND is
	@# a failure, because that one is silently broken rather than absent.
	@#
	@# The BIND test is a make-level conditional, not a shell one: `make
	@# -n` expands variables but never runs a shell, so a shell `if` would
	@# leave both branches in the dry run and the guard would be untestable.
ifeq ($(BIND),127.0.0.1)
	@if ssh $(MINI) 'test -x $(TAILSCALE)'; then \
		ssh $(MINI) '$(TAILSCALE) serve --bg --https $(TS_PORT) http://127.0.0.1:$(PORT)'; \
	else \
		echo "no tailscale at $(TAILSCALE) on $(MINI) — the dashboard answers on http://127.0.0.1:$(PORT) there, and nowhere else" >&2; \
	fi
else
	@if ssh $(MINI) 'test -x $(TAILSCALE)'; then \
		echo "tailscale is at $(TAILSCALE) on $(MINI), but BIND is '$(BIND)', not 127.0.0.1 —" >&2; \
		echo "tailscaled will not proxy to the host's own tailnet address" >&2; \
		echo "(measured 2026-08-21: a 75s hang, then a 502)." >&2; \
		echo "Set BIND=127.0.0.1 in .env.deploy and run this again." >&2; \
		exit 1; \
	else \
		echo "no tailscale at $(TAILSCALE) on $(MINI) — the dashboard answers on http://127.0.0.1:$(PORT) there, and nowhere else" >&2; \
	fi
endif

# Update an already-installed server: pull, deps, restart.
deploy-serve: install-serve
