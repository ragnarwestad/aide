# Complexity detection and analysis patterns

## Classification

**Grading rule:** The grade is the highest band Operation, Keywords or
API impact reaches; Number of files is read last, as a signal, never a
fourth vote, and never enough by itself to move a spec the other three
read as LOW. Worked example: a wording fix replacing one string across
an implementation file and its test — Operation is fix/replace (LOW),
Keywords name the specific files (LOW), API impact is none (LOW).
Touching four files sits inside the MEDIUM file-count range, but that
range is not a vote, so the grade stays LOW.

| Factor                               | LOW                     | MEDIUM               | HIGH                       |
|--------------------------------------|-------------------------|----------------------|----------------------------|
| Operation                            | remove/replace/fix      | refactor/improve     | migrate/upgrade            |
| Keywords                             | specific file mentioned | one component/module | "all", "migrate", "entire" |
| API impact                           | none                    | minor changes        | new/changed contracts      |
| Number of files (signal, not a vote) | typically 1-5           | typically 5-15       | typically 15+              |

See the workflows rules § Complexity detection for details.

## Analysis per level

### LOW (Quick Fix, < 15 min analysis)

1. Find the single file
2. Read the file, identify line numbers
3. Check whether tests exist
4. Document the findings (< 80 lines in 2-analysis.md)

### MEDIUM (Component analysis, 20-45 min)

1. Find the main file
2. Read it and identify dependencies (imports/exports)
3. Find related files (tests, consumers of the component)
4. Check API impact (use the project's API docs if any, else search the backend code)
5. Document all affected files with file:line (100-200 lines)

### HIGH (Broad analysis, 1-3 hours)

1. Search broadly for patterns in the codebase
2. Categorize files: LOW/MEDIUM/HIGH complexity per file
3. Analyze ripple effects and API impact
4. Create a phase-based migration plan (pilot → batch 1 → batch 2 → complex)
5. Document with categorization and migration plan (200-400 lines)

## Example: Expected output (MEDIUM)

```text
Codebase analysis completed for XX-slug

Findings:
- Complexity: MEDIUM (15 files affected)
- Type: Refactoring
- Risk level: Low

Affected files (categorized):
LOW complexity (8 files):
- src/forms/SimpleForm.tsx:12 (< 10 fields, basic validation)
- src/forms/ContactForm.tsx:45 (simple form)

MEDIUM complexity (5 files):
- src/forms/UserProfileForm.tsx:120 (15 fields, sync validation)
- src/forms/AddressForm.tsx:89 (custom components)

HIGH complexity (2 files):
- src/forms/WizardForm.tsx:234 (multi-step, FieldArray)
- src/forms/DynamicForm.tsx:456 (async validation)

Implementation plan created:
- Phase 1: Pilot (3-5 simple forms) - 1-2 days
- Phase 2: Batch 1 (LOW complexity) - 3-5 days
- Phase 3: Batch 2 (MEDIUM complexity) - 5-7 days
- Phase 4: Complex forms - 2-3 days

Files updated:
- specs/XX-slug/2-analysis.md
- specs/XX-slug/3-solution.md
- specs/XX-slug/4-status.md
```
