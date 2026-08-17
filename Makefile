.PHONY: test generate publish serve-local require-host install-serve deploy-serve

test:
	bunx tsc --noEmit
	bun test

generate:
	bun run src/main.ts generate

publish: generate
	deploy/rsync-publish.sh

PORT ?= 8788

# Generate and serve on THIS machine: no ssh, no rsync, no launchd.
# ROOT is optional — serve.ts only needs it to build the project nav,
# and a built-in default would name someone's checkout location.
serve-local: generate
	bun run src/serve.ts serve --site out --port $(PORT) $(if $(ROOT),--root $(ROOT))

# --- Serving on a second host ------------------------------------------
# MINI is the ssh target and has NO default: a deploy aimed at a machine
# nobody named is worse than a deploy that refuses to start.
# Every path below is relative to that host's own $HOME, resolved over
# ssh at install time — never assumed from this machine.
MINI_SRC ?= develop/aide-dashboard
REMOTE_STATE ?= aide-dashboard
# bun via the mise shim: bare `bun` is not on launchd's PATH.
REMOTE_BUN ?= .local/share/mise/shims/bun
# A project identifier, not a per-operator one.
LABEL ?= com.aide-dashboard.serve
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
	ssh $(MINI) 'if [ -d $(MINI_SRC)/.git ]; then git -C $(MINI_SRC) pull -q --ff-only; \
		else git clone -q $(REPO_URL) $(MINI_SRC); fi && \
		cd $(MINI_SRC) && ~/$(REMOTE_BUN) install --silent'
	@home=$$(ssh $(MINI) 'echo $$HOME') && \
	plist=$$(mktemp -t aide-dashboard-plist) && \
	trap 'rm -f "$$plist"' EXIT && \
	bun run deploy/render-plist.ts \
		--label $(LABEL) \
		--bun-path "$$home/$(REMOTE_BUN)" \
		--script "$$home/$(MINI_SRC)/src/serve.ts" \
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
		--queue-projects "$(QUEUE_PROJECTS)" \
		$(if $(ROOT),--root "$(ROOT)") \
		$(if $(BIND),--bind "$(BIND)") \
		$(if $(CLAUDE_USAGE),--claude-usage "$(CLAUDE_USAGE)") \
		> "$$plist" && \
	scp -q "$$plist" $(MINI):Library/LaunchAgents/$(LABEL).plist
	ssh $(MINI) 'mkdir -p Library/Logs/aide-dashboard $(REMOTE_STATE)/site && \
		launchctl bootout gui/$$(id -u)/$(LABEL) 2>/dev/null; \
		launchctl bootstrap gui/$$(id -u) Library/LaunchAgents/$(LABEL).plist'

# Update an already-installed server: pull, deps, restart.
deploy-serve: install-serve
