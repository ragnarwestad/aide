"""Skills, rules and the runner's prompts carry no filler that urges care.

A line such as "think hard" or "verify twice" is read on every run and
changes nothing the model does. A line that asks for care names the concrete
check instead, so these phrases are absent and nothing stands in for them.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[7]

FILLER = re.compile(
    r"think hard|be thorough|double[- ]check|verify twice|check twice|be careful",
    re.IGNORECASE,
)


def prompt_files() -> list[Path]:
    files = [p for p in (ROOT / "core" / "skills").rglob("*.md")]
    files += [p for p in (ROOT / "core" / "rules").rglob("*.md")]
    files.append(ROOT / "core" / "scripts" / "aide-run-spec")
    files += (ROOT / "core" / "scripts" / "lib" / "run-spec").rglob("*.sh")
    return sorted(files)


@pytest.mark.validation
class TestNoFillerLines:
    def test_no_line_urges_care_without_naming_a_check(self):
        found = []
        for path in prompt_files():
            for number, line in enumerate(path.read_text().splitlines(), 1):
                if FILLER.search(line):
                    found.append(f"{path.relative_to(ROOT)}:{number}: {line.strip()}")
        assert not found, "filler lines:\n" + "\n".join(found)
