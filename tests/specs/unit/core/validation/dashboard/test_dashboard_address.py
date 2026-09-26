"""Where the documented dashboard answers, written down without naming a machine.

The dashboard binds loopback and answers at `http://127.0.0.1:8788` on the
serving host; HTTPS and other devices are an optional proxy, documented on
its own page (`dashboard/docs/tailscale.md`), which carries the HTTPS
placeholder address.

Until spec 172 the dashboard was served over plain HTTP on a port, and
that address was written down in four places that no single test could
see at once: the dashboard's own README, the root manifest, the ROADMAP,
and the hook block `implementations/claude-code/install.sh` prints for
people to paste. When the address changed, one of them would have been
left behind — and a stale address in the pasted hook block is silent:
`aide-emit-run` posts into the void and no run ever appears.

`dashboard/test/no-hardcoded-host.test.ts` guards the same files against
naming ONE operator's machine, but it only scans inside `dashboard/`, so
`docs/ROADMAP.md` and `implementations/claude-code/install.sh` have no
guard at all. Both rules are checked here, across both toolchains' trees.
"""
import re

import pytest


# Every file that writes down where the dashboard answers.
ADDRESS_FILES = (
    "dashboard/README.md",
    "dashboard/docs/hosting.md",
    "dashboard/docs/tailscale.md",
    "docs/ROADMAP.md",
    ".aide/project.yaml",
    "implementations/claude-code/install.sh",
)

# The page for the optional HTTPS proxy is the one that writes out the
# HTTPS address, and it must use the placeholder form.
EXAMPLE_FILES = (
    "dashboard/docs/tailscale.md",
)

# A plain-HTTP URL naming the dashboard's port. `PORT ?= 8788`, the
# variable table's default column and serve.ts's own fallback are not
# URLs and stay as they are. The one plain-HTTP address that is still
# correct is the loopback one the TLS proxy forwards to — everything a
# READER is pointed at has to be the HTTPS address.
# noinspection HttpUrlsUsage
PLAIN_HTTP_DASHBOARD_URL = re.compile(
    r"http://(?!127\.0\.0\.1|localhost)[^\s\"'`)]*:8788"
)

# The two ways the serving host's real address has been written down:
# the Tailscale IP the dashboard used to answer on, and the tailnet host
# name the new certificate is issued for. Both identify one machine, and
# the second is the one this spec makes tempting to paste.
# A REAL tailnet name, not the `<tailnet>.ts.net` placeholder: the
# character before `.ts.net` has to be part of a host label for this to
# match, and a placeholder's is `>`.
OPERATOR_ADDRESS = (
    re.compile(r"100\.115\.106\.17"),
    re.compile(r"[A-Za-z0-9-]\.ts\.net", re.IGNORECASE),
)


@pytest.mark.validation
class TestDocumentedAddressIsHttps:
    """No file still sends a reader to the retired plain-HTTP address."""

    @pytest.mark.parametrize("relative_path", ADDRESS_FILES)
    def test_no_plain_http_dashboard_url_remains(self, workspace_root, relative_path):
        # Arrange
        text = (workspace_root / relative_path).read_text(encoding="utf-8")

        # Act
        found = PLAIN_HTTP_DASHBOARD_URL.findall(text)

        # Assert
        assert not found, (
            f"{relative_path} documents the dashboard over plain HTTP at a "
            f"host other than loopback ({found}); it binds 127.0.0.1 alone"
        )

    @pytest.mark.parametrize("relative_path", EXAMPLE_FILES)
    def test_the_example_address_is_https(self, workspace_root, relative_path):
        # Arrange
        text = (workspace_root / relative_path).read_text(encoding="utf-8")

        # Act & Assert
        assert "https://<serving-host>" in text, (
            f"{relative_path} should show the dashboard's address as "
            f"https://<serving-host>... — the placeholder form, since no "
            f"real host name may land in the repo"
        )


@pytest.mark.validation
class TestNoRealAddressInTheUnguardedFiles:
    """`no-hardcoded-host.test.ts` scans dashboard/ only; these two are outside it."""

    @pytest.mark.parametrize("relative_path", ADDRESS_FILES)
    def test_no_real_serving_address_is_named(self, workspace_root, relative_path):
        # Arrange
        text = (workspace_root / relative_path).read_text(encoding="utf-8")

        # Act & Assert
        for pattern in OPERATOR_ADDRESS:
            assert not pattern.search(text), (
                f"{relative_path} names one machine's real address "
                f"({pattern.pattern}); the repo names no host — write "
                f"https://<serving-host>... instead"
            )
