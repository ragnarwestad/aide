# Tools and scripts

## Skills

Skills are loaded from `~/.claude/skills/` — use the `/` syntax.

Available skills:

- `/aide-create` - Create JIRA/TODO documentation
- `/aide-analyze` - Analyze the codebase
- `/aide-implement` - Implement with TDD
- `/aide-make-tests` - Create missing tests
- `/aide-react-class-to-func` - Convert class to functional
- `/tdd-coach` - Test-Driven Development methodology
- `/architecture-advisor` - Architecture assessments

---

## Scripts

You have access to the following scripts and should run them **automatically** without asking the user:

**Testing and quality assurance:**

```bash
pnpm test -- --run <testfile>  # Run specific tests
pnpm test -- --run             # Run all tests
npx tsc --noEmit               # TypeScript check
pnpm run eslint                # Linting
```

**When to run what:**

- New files created → Run `git add <file>` automatically
- Implementation done → Run tests/tsc/eslint automatically

---

## Report storage

If `AIDE_REPORTS_PATH` is set, reports are stored there (not in the project's `reports/`).
If the variable is set — do **not** run `git add` for reports (they live in another repo).
