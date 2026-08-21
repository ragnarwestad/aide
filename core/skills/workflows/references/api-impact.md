# API impact and cross-project issues

## Table of contents

- [API impact analysis](#api-impact-analysis)
  - [Workflow](#workflow)
  - [Example](#example)
- [Cross-project issues](#cross-project-issues)
  - [Workflow for cross-project issues](#workflow-for-cross-project-issues)

---

## API impact analysis

**IMPORTANT:** Always assess API impact when analyzing an issue!

### Workflow

1. **Check what API documentation the project has**
   - An OpenAPI/Swagger spec, an API mapping document, or nothing —
     all three are normal
2. **Identify API calls**
   - Search for endpoints in the frontend code
   - Example: `'api/case/' + caseId`

3. **Locate the backend side**
   - With API docs: look the endpoint up there
   - Without: search the backend code for the route (controller
     annotations, router registrations) — find the exact file and line

4. **Assess the impact**
   - **Frontend only?** UI changes without API changes
   - **Backend only?** Logic changes without contract changes
   - **Both?** New fields, validation, changed API contract

### Example

**JIRA issue:** "Add a 'processing status' field to the case overview"

**Analysis:**
1. Frontend uses: `GET /api/case/{caseId}`
2. The backend endpoint lives in: `my-api/src/.../CaseController.java:156`
3. Assessment: **Both**

**Document in `2-analysis.md`:**
```markdown
## Affected projects

### my-api
- CaseController.java:156 - Add `processingStatus` to the response
- CaseDto.java:42 - Add new field

### my-app
- src/pages/case/CaseOverview.tsx:89 - Show `processingStatus` in the UI
```

---

## Cross-project issues

Many issues require changes in multiple projects.

### Workflow for cross-project issues

1. **Analyze** which projects are affected
2. **Document** in `2-analysis.md`:
   - List of affected files (with line numbers)
   - Dependencies between projects
3. **Implement** in the right order:
   - Often: Backend first, then frontend
   - Reason: The frontend depends on the backend API contract
4. **Test** the entire flow:
   - Backend tests (unit + integration)
   - Frontend tests (unit + e2e)
   - Manual testing (full stack)
