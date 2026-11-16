"""An expected assessment: one Markdown file per archived spec, written and approved by a person, that says what a
good analysis and plan for that spec cover, with the evidence for each item, and which omissions are serious.

The file's header pins the spec's folder, the code commit just before its code landed and the commit that landed it,
and the sha256 of its archived description, so a case is always judged against the code and the description it was
written from. `Approved: no` until a person has read it; `run` refuses a case that is not approved.
"""
import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import landing
from gitutil import git

SECTIONS = {"R": "Requirements", "C": "Code and interactions", "T": "Tests", "S": "Serious omissions"}
DOCUMENTS = ("analysis", "plan")
HEADER = {
    "Spec": r"`(\d+-[a-z0-9-]+)`",
    "Code before": r"`([0-9a-f]{40})`",
    "Code landed": r"`([0-9a-f]{40})`",
    "Description sha256": r"`([0-9a-f]{64})`",
    "Approved": r"(no|\d{4}-\d{2}-\d{2})",
}
HEADER_LINE = re.compile(r"^- \*\*([A-Za-z0-9 ]+):\*\*[ \t]*(.*?)[ \t]*$")
ITEM_START = re.compile(r"^- \*\*([A-Z])(\d+)(?: \(([^)]*)\))?:\*\*[ \t]*(.*)$")


class CaseError(Exception):
    """A case file that cannot be used as it is: names the file and the item."""


@dataclass(frozen=True)
class Item:
    id: str
    text: str
    evidence: str
    documents: tuple = ()  # for a serious omission, the documents it applies to


@dataclass
class Case:
    path: Path
    number: str
    folder: str
    before: str
    landed: str
    description_sha256: str
    approved: Optional[str]  # the date it was approved, or None
    sha256: str
    items: dict = field(default_factory=dict)  # section letter -> [Item]

    def omissions(self, document):
        """The serious omissions that apply to `document` (analysis or plan)."""
        return [item for item in self.items["S"] if document in item.documents]


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _header(path, lines):
    found = {}
    for line in lines:
        match = HEADER_LINE.match(line)
        if match and match.group(1) in HEADER:
            found[match.group(1)] = match.group(2)
    values = {}
    for name, shape in HEADER.items():
        if name not in found:
            raise CaseError(f"{path}: the header has no `{name}:` line")
        value = re.fullmatch(shape, found[name])
        if not value:
            raise CaseError(f"{path}: `{name}:` reads {found[name]!r}, which is not {shape}")
        values[name] = value.group(1)
    return values


def _sections(path, lines):
    """Each section's item lines, joined so an item's indented continuation belongs to it."""
    by_title = {title: letter for letter, title in SECTIONS.items()}
    sections, current = {}, None
    for line in lines:
        heading = re.match(r"^## (.+?)\s*$", line)
        if heading:
            current = by_title.get(heading.group(1))
            if current is None:
                raise CaseError(f"{path}: `## {heading.group(1)}` is not one of the sections: {', '.join(SECTIONS.values())}")
            sections[current] = []
        elif current and line.startswith("- "):
            sections[current].append(line)
        elif current and line.startswith("  ") and sections[current]:
            sections[current][-1] += " " + line.strip()
    return sections


def _item(path, letter, line):
    match = ITEM_START.match(line)
    if not match:
        raise CaseError(f"{path}: {SECTIONS[letter]}: {line[:60]!r} is not an item `- **{letter}<n>:** <text> Evidence: <...>`")
    kind, n, named, body = match.groups()
    item_id = f"{kind}{n}"
    if kind != letter:
        raise CaseError(f"{path}: {item_id} sits under {SECTIONS[letter]}, whose items are lettered {letter}")
    documents = tuple(d.strip() for d in named.split(",")) if named is not None else ()
    if letter == "S" and (not documents or any(d not in DOCUMENTS for d in documents)):
        raise CaseError(f"{path}: {item_id} names the documents it applies to in brackets: analysis, plan or both")
    if letter != "S" and named is not None:
        raise CaseError(f"{path}: {item_id} names documents, and only a serious omission does")
    text, marker, evidence = body.partition("Evidence:")
    if not marker or not evidence.strip():
        raise CaseError(f"{path}: {item_id} has no evidence after `Evidence:`")
    if not text.strip():
        raise CaseError(f"{path}: {item_id} has no text before its evidence")
    return Item(item_id, text.strip(), evidence.strip(), documents)


def load(path):
    """The case in `path`; CaseError naming the file and the item when it breaks one of the rules."""
    path = Path(path)
    lines = path.read_text().splitlines()
    header = _header(path, lines)
    folder = header["Spec"]
    number = folder.split("-", 1)[0]
    if path.stem != number:
        raise CaseError(f"{path}: the file is named {path.name}, and its spec {folder} is number {number}")
    sections = _sections(path, lines)
    items, seen = {}, set()
    for letter, title in SECTIONS.items():
        if not sections.get(letter):
            raise CaseError(f"{path}: the section `## {title}` is missing or holds no item")
        items[letter] = [_item(path, letter, line) for line in sections[letter]]
        for item in items[letter]:
            if item.id in seen:
                raise CaseError(f"{path}: {item.id} is used twice")
            seen.add(item.id)
    return Case(path=path, number=number, folder=folder, before=header["Code before"], landed=header["Code landed"],
                description_sha256=header["Description sha256"],
                approved=None if header["Approved"] == "no" else header["Approved"], sha256=sha256_file(path), items=items)


def selected(cases_dir, numbers=None):
    """The case files to use: those `numbers` names, else every `<number>.md` in the folder, in number order."""
    folder = Path(cases_dir)
    if numbers:
        return [folder / f"{n}.md" for n in numbers]
    return sorted((p for p in folder.glob("*.md") if p.stem.isdigit()), key=lambda p: int(p.stem))


def consistent(case, code, specs_root, branch, code_landing):
    """What differs between the case and the archive and the code history; an empty list when nothing does."""
    archived = Path(specs_root) / "archive" / case.folder
    if not (archived / "1-description.md").is_file():
        return [f"{case.folder} is not archived under {specs_root}"]
    problems = []
    described = sha256_file(archived / "1-description.md")
    if described != case.description_sha256:
        problems.append(f"Description sha256 is {case.description_sha256}, and the archived description's is {described}")
    for name, sha in (("Code before", case.before), ("Code landed", case.landed)):
        if not git(code, "rev-parse", "--verify", "--quiet", f"{sha}^{{commit}}", check=False):
            problems.append(f"{name} {sha} is not a commit in {code}")
    if problems and any(p.startswith("Code") for p in problems):
        return problems
    try:
        found = landing.find_landing(code, branch, case.folder, str(archived), code_landing)
    except landing.NoLanding as error:
        return problems + [f"the landing of {case.folder} cannot be found: {error}"]
    if found.before != case.before:
        problems.append(f"Code before is {case.before}, and the landing gives {found.before}")
    if found.landed != case.landed:
        problems.append(f"Code landed is {case.landed}, and the landing gives {found.landed}")
    return problems
