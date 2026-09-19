# A new user's Linux machine, as bare as one gets: git and curl, and an
# ordinary user with a home directory. Everything else Aide needs has to
# come from its own installer — that is what scripts/test-linux-install
# checks.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash tester
USER tester
WORKDIR /home/tester

# The checkout is mounted read-only and owned by another uid.
RUN git config --global --add safe.directory '*' \
 && git config --global user.name "Aide Tester" \
 && git config --global user.email "tester@example.invalid" \
 && git config --global init.defaultBranch main
