# Workflow optimization

## Table of contents

- [Workflow optimization](#workflow-optimization-1)
  - [Context management](#context-management)
  - [Course correction](#course-correction)
  - [Explore - Plan - Code workflow](#explore---plan---code-workflow)
  - [Iterating toward clear goals](#iterating-toward-clear-goals)
  - [Checklists for complex tasks](#checklists-for-complex-tasks)

---

## Workflow optimization

Based on [Anthropic's official guide](https://www.anthropic.com/engineering/claude-code-best-practices).

### Context management

**Use `/clear` between independent tasks:**
- Keeps performance up
- Prevents earlier context from distracting

**When to use /clear:**
- After completing a JIRA issue or TODO plan
- When switching between independent tasks

### Course correction

**Interrupt and redirect:**
- **Escape:** Abort the ongoing operation and give new instructions
- **Double-tap Escape:** Edit the previous prompt
- **Ask Claude to undo:** "Undo the last change"

**Ask Claude to plan first:**
- "Plan how you want to solve this before writing code"
- "Think hard" for more thorough analysis

### Explore - Plan - Code workflow

**Always follow these steps:**

**1. Explore**
```text
- "Read through SakOversikt.tsx and explain the structure"
- "Find all places where we use validateApplication"
```

**2. Plan**
```text
- "Make a plan for how we should implement this"
- "Think hard about the edge cases"
```

**3. Code (Implement)**
```text
- Write tests first (RED)
- Implement the solution (GREEN)
- Run regression tests (REFACTOR)
```

**4. Commit (Confirm)**
```text
- Manual testing
- Code review
- Git commit
```

### Iterating toward clear goals

**Use measurable targets:**
- **Tests:** Write tests that define the desired behavior
- **Screenshots:** Show the desired design as a target
- **Specifications:** Explicit acceptance criteria

### Checklists for complex tasks

**For large migrations:**

1. Ask Claude to create a Markdown checklist
2. Work systematically through each item
3. Update 4-status.md along the way

**Example:**
```markdown
## Migration plan: Redux to Zustand

- [ ] Migrate `caseSlice.ts` (10 actions)
- [ ] Migrate `userSlice.ts` (5 actions)
- [ ] Update all components using `useSelector`
- [ ] Remove Redux dependencies
- [ ] Run the full test suite
```
