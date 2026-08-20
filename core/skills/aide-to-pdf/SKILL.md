---
name: aide-to-pdf
description: >-
  Generate PDF from JIRA or TODO documentation.
  Use when: exporting documentation to PDF, generating a print-friendly spec.
  Do NOT use for: creating documentation (use aide-create)
argument-hint: "[ISSUE_ID]"
effort: medium
---

You will help the user **generate a PDF** from JIRA or TODO documentation.

## Input

The user has run:
```bash
/aide-to-pdf <ISSUE_ID>
```

**Examples:**
- `/aide-to-pdf PROJ-7637` - JIRA issue
- `/aide-to-pdf 17-fix-validation` - TODO plan

## Your task

1. **Validate input:**
   - If the input matches `PROJ-<number>`: JIRA issue (the key is part of the slug)
   - If the input is a number only (`NN`): number shorthand
   - Anything else: full directory ID (`NN-slug`)
   - If no input: Ask the user for a number or full ID

2. **Determine REPORTS_ROOT:**
   ```bash
   # The lib resolves it: .aide/config in the project root wins,
   # otherwise <project-root>/specs
   source ~/.local/bin/_aide-spec-lib.sh
   REPORTS_ROOT="$(aide_specs_root)"
   ```

3. **Resolve to the full directory ID** (flat structure: everything lives as `<NN>-slug/` directly under REPORTS_ROOT):
   ```bash
   if echo "$INPUT" | grep -qE '^PROJ-[0-9]+$'; then
     # JIRA: find the directory containing the key
     DIR=$(find "$REPORTS_ROOT" -maxdepth 1 -type d -name "*${INPUT}*" | head -1 | xargs basename)
   elif echo "$INPUT" | grep -qE '^[0-9]+$'; then
     # Number shorthand: find <NN>-*
     NN=$(printf '%02d' "$INPUT")
     DIR=$(find "$REPORTS_ROOT" -maxdepth 1 -type d -name "${NN}-*" | head -1 | xargs basename)
   else
     # Assume full directory ID
     DIR="$INPUT"
   fi

   if [ -z "$DIR" ] || [ ! -d "$REPORTS_ROOT/$DIR" ]; then
     echo "Found no issue for: $INPUT"
     exit 1
   fi
   # Example: 27 → finds 27-step-ts-conversion-analysis
   ```

4. **Check that documentation exists:**
   - `$REPORTS_ROOT/<NN-slug>/` (flat structure for both JIRA and TODO)
   - If not: Inform the user that they must run `/aide-create` first

5. **Generate PDF:**
   ```bash
   # Pass the resolved directory ID (full NN-slug) to the script
   aide-generate-pdf "$DIR"
   ```

   **IMPORTANT:** The `aide-generate-pdf` script resolves the specs root the same way (via `aide_specs_root`).

   The script will:
   - Combine all markdown files (1-description, 2-analysis, 3-solution, 4-status)
   - Add a cover page with metadata
   - Convert to PDF with header/footer
   - Output: `$REPORTS_ROOT/<NN-slug>/<NN-slug>.pdf`

6. **Give the user the result:**
   - Show the path to the PDF file
   - Explain how to open it: `open <path>`

## Error handling

**If `md-to-pdf` is not installed:**
```text
md-to-pdf is not installed

Install with:
npm install -g md-to-pdf

Or run from the project:
npx md-to-pdf
```

**If documentation does not exist:**
```text
Could not find documentation for <ISSUE_ID>

Have you run the create command first?

/aide-create <ISSUE_ID>
/aide-analyze <ISSUE_ID>
```

## Notes

- **Automatic JIRA/TODO detection:** Same logic as `/aide-create`
- **Output location:** Same directory as the markdown files (keeps everything together)
- **AIDE_SPECS_PATH:** read from `.aide/config` in the project root (no environment variable)
- **Styling:** The PDF includes a header with the issue number and a footer with page numbers
