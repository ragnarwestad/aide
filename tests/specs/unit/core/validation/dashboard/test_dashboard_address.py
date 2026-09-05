"""The dashboard has ONE documented address, and it is the HTTPS one (spec 172).

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
    "dashboard/docs/deploying.md",
    "docs/ROADMAP.md",
    ".aide/project.yaml",
    "implementations/claude-code/install.sh",
)

# The ones that carry a worked example of the address must show the
# HTTPS placeholder form. ROADMAP.md narrates the work instead, and
# dashboard/README.md now links to `docs/deploying.md` for the address
# rather than writing one out — so it has no example to be wrong about,
# while the plain-HTTP rule above still holds it to never gaining one.
EXAMPLE_FILES = (
    "dashboard/docs/deploying.md",
    ".aide/project.yaml",
    "implementations/claude-code/install.sh",
)

# A plain-HTTP URL naming the dashboard's port. `PORT ?= 8788`, the
# variable table's default column and serve.ts's own fallback are not
# URLs and stay as they are. The one plain-HTTP address that is still
# correct is the loopback one the TLS proxy forwards to — everything a
# READER is pointed at has to be the HTTPS address.
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
            f"{relative_path} still documents the dashboard over plain HTTP "
            f"on a port ({found}); spec 172 made the HTTPS address the only "
            f"one that answers"
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

    def test_the_roadmap_no_longer_names_the_port(self, workspace_root):
        # Arrange
        text = (workspace_root / "docs" / "ROADMAP.md").read_text(encoding="utf-8")

        # Act & Assert
        assert "8788" not in text, (
            "docs/ROADMAP.md still says the dashboard is served on port 8788; "
            "since spec 172 it is reached over HTTPS with no port"
        )


@pytest.mark.validation
class TestHttpsIsNoLongerDescribedAsUnfinished:
    """The deploy page narrated HTTPS as half-set-up while spec 172 was open."""

    def test_the_deploy_page_does_not_call_https_half_done(self, workspace_root):
        # Arrange
        text = (workspace_root / "dashboard" / "docs" / "deploying.md").read_text(
            encoding="utf-8"
        )

        # Act & Assert
        for phrase in ("half-done", "Spec 172 is that work"):
            assert phrase not in text, (
                f"dashboard/docs/deploying.md still says {phrase!r}; HTTPS is "
                f"set up by the deploy now, so the section describing it as "
                f"pending is wrong"
            )
