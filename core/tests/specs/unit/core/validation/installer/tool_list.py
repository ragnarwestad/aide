from pathlib import Path
import shutil


FIELDS = ("id", "implementation", "cli", "name", "row", "upgrade", "install")


def read_tools(root: Path):
    rows = []
    for line in (root / "core/scripts/lib/ai-tools/tools.txt").read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        rows.append(dict(zip(FIELDS, (part.strip() for part in line.split("|", 6)))))
    return rows


def copy_with_fake_tool(root: Path, target: Path, paths):
    for relative in paths:
        source = root / relative
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, destination)
        else:
            shutil.copy2(source, destination)
    tools = target / "core/scripts/lib/ai-tools/tools.txt"
    with tools.open("a") as handle:
        handle.write(
            "fake | fake-impl | fake-cli | Fake Tool | Fake CLI | "
            "npm:@fake/cli | mise use -g npm:@fake/cli@latest\n"
        )
