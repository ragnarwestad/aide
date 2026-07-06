#!/usr/bin/env python3
"""
Generate 2-level Table of Contents for TODO markdown files.
Extracts h2 (##) and h3 (###) headings and creates anchor links.
"""

import re
import sys
from pathlib import Path


def slugify(text: str) -> str:
    """Convert heading text to anchor slug."""
    # Remove markdown formatting
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)  # Bold
    text = re.sub(r'\*([^*]+)\*', r'\1', text)      # Italic
    text = re.sub(r'`([^`]+)`', r'\1', text)        # Code
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)  # Links

    # Convert to lowercase and replace spaces/special chars
    slug = text.lower().strip()
    slug = re.sub(r'[^\w\s-]', '', slug)  # Remove special chars except hyphen
    slug = re.sub(r'\s+', '-', slug)       # Spaces to hyphens
    slug = re.sub(r'-+', '-', slug)        # Multiple hyphens to single
    slug = slug.strip('-')
    return slug


def extract_headings(content: str) -> list:
    """Extract h2 and h3 headings from markdown content."""
    headings = []
    lines = content.split('\n')
    in_code_block = False

    for line in lines:
        # Track code blocks
        if line.strip().startswith('```'):
            in_code_block = not in_code_block
            continue

        if in_code_block:
            continue

        # Skip TOC section headings
        if re.match(r'^##\s*(Innholdsfortegnelse|Table of contents)', line, re.IGNORECASE):
            continue

        # Match h2 and h3
        h2_match = re.match(r'^##\s+(.+)$', line)
        h3_match = re.match(r'^###\s+(.+)$', line)

        if h2_match:
            text = h2_match.group(1).strip()
            headings.append((2, text, slugify(text)))
        elif h3_match:
            text = h3_match.group(1).strip()
            headings.append((3, text, slugify(text)))

    return headings


def generate_toc(headings: list) -> str:
    """Generate TOC markdown from headings."""
    if not headings:
        return ""

    lines = ["## Table of contents", ""]

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
    """Find position of first h2 that is NOT the TOC heading."""
    lines = content.split('\n')
    pos = 0
    in_code_block = False

    for line in lines:
        if line.strip().startswith('```'):
            in_code_block = not in_code_block

        if not in_code_block:
            # Check for h2 that is NOT the TOC heading
            if re.match(r'^##\s+', line) and not re.match(r'^##\s*(Innholdsfortegnelse|Table of contents)', line, re.IGNORECASE):
                return pos

        pos += len(line) + 1  # +1 for newline

    return -1


def update_file_toc(filepath: Path) -> bool:
    """Update TOC in a markdown file. Returns True if changed."""
    content = filepath.read_text(encoding='utf-8')
    original_content = content

    # Extract headings
    headings = extract_headings(content)

    if not headings:
        return False

    # Generate new TOC
    new_toc = generate_toc(headings)

    # Strategy: Find content before TOC section (h1 + metadata),
    # then find first real h2 section, replace everything in between with new TOC

    # Find h1 (title) - everything up to and including the line after h1
    h1_match = re.match(r'^(#\s+.+\n(?:\n|(?:\*\*[^*]+\*\*[^\n]*\n))*)', content)

    if not h1_match:
        # No h1, can't process
        return False

    header_section = h1_match.group(1)
    rest_of_content = content[h1_match.end():]

    # Find first real h2 in the rest
    first_h2_pos = find_first_real_h2(rest_of_content)

    if first_h2_pos == -1:
        # No real h2 sections found
        return False

    # Build new content: header + new TOC + content from first real h2
    new_content = header_section + '\n' + new_toc + rest_of_content[first_h2_pos:]

    # Clean up multiple consecutive blank lines
    new_content = re.sub(r'\n{4,}', '\n\n\n', new_content)

    if new_content != original_content:
        filepath.write_text(new_content, encoding='utf-8')
        return True

    return False


def main():
    if len(sys.argv) < 2:
        print("Usage: generate-toc.py <reports_path>")
        print("Example: generate-toc.py /path/to/aide-reports")
        sys.exit(1)

    todo_path = Path(sys.argv[1])

    if not todo_path.exists():
        print(f"Error: Path does not exist: {todo_path}")
        sys.exit(1)

    # Find all TODO directories
    todo_dirs = sorted(todo_path.glob("TODO-*"))

    if not todo_dirs:
        print(f"No TODO directories found in {todo_path}")
        sys.exit(1)

    print(f"Found {len(todo_dirs)} TODO directories\n")

    files_to_process = ["1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"]
    total_updated = 0

    for todo_dir in todo_dirs:
        dir_updated = 0
        for filename in files_to_process:
            filepath = todo_dir / filename
            if filepath.exists():
                if update_file_toc(filepath):
                    dir_updated += 1
                    total_updated += 1

        if dir_updated > 0:
            print(f"✅ {todo_dir.name}: {dir_updated} files updated")
        else:
            print(f"⏭️  {todo_dir.name}: no changes needed")

    print(f"\n📊 Total: {total_updated} files updated")


if __name__ == "__main__":
    main()
