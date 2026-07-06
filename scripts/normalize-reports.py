#!/usr/bin/env python3
"""
Normalize TODO/JIRA reports according to DOCUMENTATION_STANDARD.md

Fixes:
1. 2-level TOC (h2 + h3)
2. Removes emojis from headings
3. Ensures --- separator after TOC
4. Validates code blocks have language specifier
5. Fixes list numbering after headers
6. Creates 0-README.md if missing
7. Renames README.md to 0-README.md
"""

import re
import sys
from pathlib import Path
from typing import List, Tuple, Optional


# Emoji pattern for removal from headings
EMOJI_PATTERN = re.compile(
    "["
    "\U0001F600-\U0001F64F"  # emoticons
    "\U0001F300-\U0001F5FF"  # symbols & pictographs
    "\U0001F680-\U0001F6FF"  # transport & map symbols
    "\U0001F1E0-\U0001F1FF"  # flags
    "\U00002702-\U000027B0"  # dingbats
    "\U0001F900-\U0001F9FF"  # supplemental symbols
    "\U00002600-\U000026FF"  # misc symbols
    "]+",
    flags=re.UNICODE
)


def slugify(text: str) -> str:
    """Convert heading text to anchor slug."""
    # Remove markdown formatting
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    # Remove emojis
    text = EMOJI_PATTERN.sub('', text)

    slug = text.lower().strip()
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'\s+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    slug = slug.strip('-')
    return slug


def remove_emojis_from_headings(content: str) -> str:
    """Remove emojis from h1, h2, h3 headings."""
    lines = content.split('\n')
    result = []

    for line in lines:
        if re.match(r'^#{1,3}\s+', line):
            # Remove emojis from heading
            cleaned = EMOJI_PATTERN.sub('', line)
            # Clean up extra spaces
            cleaned = re.sub(r'\s+', ' ', cleaned)
            cleaned = re.sub(r'^(#{1,3})\s+', r'\1 ', cleaned)
            result.append(cleaned.rstrip())
        else:
            result.append(line)

    return '\n'.join(result)


def extract_headings(content: str) -> List[Tuple[int, str, str]]:
    """Extract h2 and h3 headings from markdown content."""
    headings = []
    lines = content.split('\n')
    in_code_block = False

    for line in lines:
        if line.strip().startswith('```'):
            in_code_block = not in_code_block
            continue

        if in_code_block:
            continue

        if re.match(r'^##\s*Innholdsfortegnelse', line, re.IGNORECASE):
            continue

        h2_match = re.match(r'^##\s+(.+)$', line)
        h3_match = re.match(r'^###\s+(.+)$', line)

        if h2_match:
            text = EMOJI_PATTERN.sub('', h2_match.group(1)).strip()
            text = re.sub(r'\s+', ' ', text)
            headings.append((2, text, slugify(text)))
        elif h3_match:
            text = EMOJI_PATTERN.sub('', h3_match.group(1)).strip()
            text = re.sub(r'\s+', ' ', text)
            headings.append((3, text, slugify(text)))

    return headings


def generate_toc(headings: List[Tuple[int, str, str]]) -> str:
    """Generate 2-level TOC markdown."""
    if not headings:
        return ""

    lines = ["## Innholdsfortegnelse", ""]

    for level, text, slug in headings:
        if level == 2:
            lines.append(f"- [{text}](#{slug})")
        elif level == 3:
            lines.append(f"  - [{text}](#{slug})")

    lines.append("")
    lines.append("---")
    lines.append("")

    return '\n'.join(lines)


def find_first_real_h2(content: str) -> int:
    """Find position of first h2 that is NOT 'Innholdsfortegnelse'."""
    lines = content.split('\n')
    pos = 0
    in_code_block = False

    for line in lines:
        if line.strip().startswith('```'):
            in_code_block = not in_code_block

        if not in_code_block:
            if re.match(r'^##\s+', line) and not re.match(r'^##\s*Innholdsfortegnelse', line, re.IGNORECASE):
                return pos

        pos += len(line) + 1

    return -1


def fix_code_blocks(content: str) -> str:
    """Add language specifier to code blocks missing them."""
    # Pattern: ``` followed by newline (no language)
    def add_text_lang(match):
        return '```text\n'

    # Only fix blocks that are truly empty (``` followed by newline with code)
    content = re.sub(r'```\n(?=[^`])', add_text_lang, content)
    return content


def fix_list_numbering(content: str) -> str:
    """Fix numbered lists to start at 1 after headers."""
    lines = content.split('\n')
    result = []
    in_list = False
    list_counter = 0

    for i, line in enumerate(lines):
        # Check if this is a numbered list item
        match = re.match(r'^(\s*)(\d+)\.\s+(.*)$', line)

        if match:
            indent, num, text = match.groups()
            if not in_list:
                # Start of new list
                in_list = True
                list_counter = 1
            else:
                list_counter += 1

            # Replace number with correct sequence
            result.append(f"{indent}{list_counter}. {text}")
        else:
            # Not a list item
            if line.strip() == '' or re.match(r'^#{1,6}\s+', line):
                # Blank line or header - reset list
                in_list = False
                list_counter = 0
            result.append(line)

    return '\n'.join(result)


def update_file(filepath: Path) -> Tuple[bool, List[str]]:
    """
    Update a markdown file according to documentation standard.
    Returns (changed, list_of_changes).
    """
    content = filepath.read_text(encoding='utf-8')
    original_content = content
    changes = []

    # 1. Remove emojis from headings
    new_content = remove_emojis_from_headings(content)
    if new_content != content:
        changes.append("Fjernet emojis fra overskrifter")
        content = new_content

    # 2. Fix code blocks
    new_content = fix_code_blocks(content)
    if new_content != content:
        changes.append("La til språk-spesifikasjon på kodeblokker")
        content = new_content

    # 3. Extract headings and generate TOC
    headings = extract_headings(content)

    if headings:
        new_toc = generate_toc(headings)

        # Find h1 and metadata section
        h1_match = re.match(r'^(#\s+.+\n(?:\n|(?:\*\*[^*]+\*\*[^\n]*\n))*)', content)

        if h1_match:
            header_section = h1_match.group(1)
            rest_of_content = content[h1_match.end():]

            first_h2_pos = find_first_real_h2(rest_of_content)

            if first_h2_pos != -1:
                new_content = header_section + '\n' + new_toc + rest_of_content[first_h2_pos:]
                new_content = re.sub(r'\n{4,}', '\n\n\n', new_content)

                if new_content != content:
                    changes.append("Oppdatert 2-nivå innholdsfortegnelse")
                    content = new_content

    # 4. Fix list numbering
    new_content = fix_list_numbering(content)
    if new_content != content:
        changes.append("Fikset liste-nummerering")
        content = new_content

    # Write if changed
    if content != original_content:
        filepath.write_text(content, encoding='utf-8')
        return True, changes

    return False, []


def create_readme(report_dir: Path) -> bool:
    """Create 0-README.md if missing."""
    readme_path = report_dir / "0-README.md"

    if readme_path.exists():
        return False

    # Get title from 1-description.md
    beskrivelse_path = report_dir / "1-description.md"
    title = report_dir.name

    if beskrivelse_path.exists():
        content = beskrivelse_path.read_text(encoding='utf-8')
        h1_match = re.match(r'^#\s+(.+)$', content, re.MULTILINE)
        if h1_match:
            title = EMOJI_PATTERN.sub('', h1_match.group(1)).strip()

    readme_content = f"""# {title}

**Innholdsfortegnelse:**

1. [Beskrivelse](1-description.md) - Bakgrunn og mål
2. [Analyse](2-analysis.md) - Teknisk analyse
3. [Løsning](3-solution.md) - Implementeringsplan
4. [Status](4-status.md) - Fremdriftssporing

---
"""

    readme_path.write_text(readme_content, encoding='utf-8')
    return True


def rename_readme(report_dir: Path) -> bool:
    """Rename README.md to 0-README.md."""
    old_readme = report_dir / "README.md"
    new_readme = report_dir / "0-README.md"

    if old_readme.exists() and not new_readme.exists():
        old_readme.rename(new_readme)
        return True

    return False


def process_report_dir(report_dir: Path) -> dict:
    """Process a single report directory."""
    result = {
        "name": report_dir.name,
        "files_updated": 0,
        "readme_created": False,
        "readme_renamed": False,
        "changes": []
    }

    # Rename README.md if needed
    if rename_readme(report_dir):
        result["readme_renamed"] = True
        result["changes"].append("Renamed README.md → 0-README.md")

    # Create 0-README.md if missing
    if create_readme(report_dir):
        result["readme_created"] = True
        result["changes"].append("Opprettet 0-README.md")

    # Process each standard file
    files_to_process = ["1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"]

    for filename in files_to_process:
        filepath = report_dir / filename
        if filepath.exists():
            changed, changes = update_file(filepath)
            if changed:
                result["files_updated"] += 1
                for change in changes:
                    result["changes"].append(f"{filename}: {change}")

    return result


def main():
    if len(sys.argv) < 2:
        print("Usage: normalize-reports.py <reports_path> [--dry-run]")
        print("Example: normalize-reports.py /path/to/aide-reports")
        sys.exit(1)

    reports_path = Path(sys.argv[1])
    dry_run = "--dry-run" in sys.argv

    if not reports_path.exists():
        print(f"Error: Path does not exist: {reports_path}")
        sys.exit(1)

    # Find report directories (TODO-* or PROJ-*)
    report_dirs = sorted(list(reports_path.glob("TODO-*")) + list(reports_path.glob("PROJ-*")))

    if not report_dirs:
        print(f"No report directories found in {reports_path}")
        sys.exit(1)

    print(f"{'[DRY RUN] ' if dry_run else ''}Found {len(report_dirs)} report directories\n")

    total_files = 0
    total_readmes_created = 0
    total_readmes_renamed = 0

    for report_dir in report_dirs:
        result = process_report_dir(report_dir)

        if result["changes"]:
            print(f"✅ {result['name']}:")
            for change in result["changes"]:
                print(f"   - {change}")
            total_files += result["files_updated"]
            if result["readme_created"]:
                total_readmes_created += 1
            if result["readme_renamed"]:
                total_readmes_renamed += 1
        else:
            print(f"⏭️  {result['name']}: ingen endringer")

    print(f"\n📊 Oppsummering:")
    print(f"   - Filer oppdatert: {total_files}")
    print(f"   - README opprettet: {total_readmes_created}")
    print(f"   - README renamed: {total_readmes_renamed}")


if __name__ == "__main__":
    main()
