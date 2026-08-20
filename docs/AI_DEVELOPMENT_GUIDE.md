# AI Development Guide

## Table of contents

- [Architecture principles](#architecture-principles)
  - [AI-agnostic design](#ai-agnostic-design)
  - [Layered architecture](#layered-architecture)
- [Design patterns in use](#design-patterns-in-use)
  - [Pattern 21: Tool Calling](#pattern-21-tool-calling)
  - [Pattern 22: Code Execution](#pattern-22-code-execution)
  - [Pattern 23: Multi-agent Collaboration](#pattern-23-multi-agent-collaboration)
  - [Pattern 13: Chain of Thought](#pattern-13-chain-of-thought)
  - [Pattern 6: Basic RAG](#pattern-6-basic-rag-retrieval-augmented-generation)
  - [Pattern 17: Reflection](#pattern-17-reflection)
- [AI best practices](#ai-best-practices)
  - [From Anthropic: Claude Code Best Practices](#from-anthropic-claude-code-best-practices)
  - [From OpenAI: Best Practices for Prompt Engineering](#from-openai-best-practices-for-prompt-engineering)
  - [From GitHub: Copilot Best Practices](#from-github-copilot-best-practices)
- [Resources and inspiration](#resources-and-inspiration)
  - [Generative AI Design Patterns](#generative-ai-design-patterns)
  - [Anthropic Resources](#anthropic-resources)
  - [OpenAI Resources](#openai-resources)
  - [Other resources](#other-resources)
- [Implementation details](#implementation-details)
  - [Why a 4-file document structure?](#why-a-4-file-document-structure)
  - [Why slash commands (Claude Code)?](#why-slash-commands-claude-code)
  - [Why a TDD approach?](#why-a-tdd-approach)
  - [Why AI-agnostic design?](#why-ai-agnostic-design)
- [Contributing to the project](#contributing-to-the-project)
  - [Adding a new AI implementation](#adding-a-new-ai-implementation)
  - [Adding a new design pattern](#adding-a-new-design-pattern)
  - [Updating best practices](#updating-best-practices)

---

## Architecture principles

### AI-agnostic design

**Core principle:** Separate generic content from AI-specific implementation.

**Structure:**

```text
core/                    # AI-agnostic (workflows, docs, scripts)
implementations/         # AI-specific (claude-code, codex, copilot)
specs/                 # Output (AI-agnostic)
```

**Why:**
- Not locked in to a single AI vendor
- Easy to add new AI tools
- Reuse of workflows, templates and scripts
- The team can choose the best tool for each task

**See:** [DEVELOPING.md](../DEVELOPING.md#architecture)

### Layered architecture

| Layer              | Responsibility                       | Example                        |
|--------------------|--------------------------------------|--------------------------------|
| **Core**           | Workflows, standards, data           | `core/rules/workflows.md`      |
| **Implementation** | AI-specific commands/instructions    | `implementations/claude-code/` |
| **Scripts**        | CLI tools                            | `core/scripts/`                |
| **Templates**      | Document structures                  | `core/templates/todo/`         |
| **Output**         | Generated documentation and analysis | `specs/<NN>-PROJ-XXXX-slug/`   |

---

## Design patterns in use

This project is inspired by [Lakshman Oruganti's Generative AI Design Patterns](https://github.com/lakshmanok/generative-ai-design-patterns) (O'Reilly book).

### Pattern 21: Tool Calling

**Concept:** LLMs emit special tokens to call APIs with parameters. A postprocessor runs the function and returns results to the model.

**Our implementation:**
- Claude Code slash commands: `/aide-create`, `/aide-analyze`, `/aide-implement`
- AI tools call scripts and read JIRA data from the user → Generate documentation

**Example:**
```bash
# Claude Code creates the document structure
/aide-create PROJ-7890
  ↓
User pastes in JIRA data  # Data is copied manually from the JIRA browser
  ↓
AI fills in 1-description.md with metadata and problem description
```

**Why:** Gives AI tools access to external systems (git, codebase) via tool calling.

### Pattern 22: Code Execution

**Concept:** AI agents generate code that is executed by external systems.

**Our implementation:**
- AI generates tests (RED)
- AI implements the solution (GREEN)
- Bash commands run `pnpm test`, `pnpm run build`
- AI interprets the output and iterates

**Example:**
```typescript
// AI generates a test
test('validateApplication should reject invalid personnummer', () => {
  expect(validateApplication({ personnummer: '12345678901' })).toBe(false)
})

// Run the test
pnpm test -- validateApplication  # Test fails (RED)

// AI implements the solution
function validateApplication(data) {
  return isValidPersonnummer(data.personnummer)
}

// Run the test again
pnpm test -- validateApplication  # Test passes (GREEN)
```

**Why:** The TDD approach gives the AI a clear goal (a test that must pass) instead of vague descriptions.

### Pattern 23: Multi-agent Collaboration

**Concept:** Specialized single-purpose agents organized in hierarchical structures.

**Our implementation (Claude Code):**
- `task-analyzer` - Analyzes JIRA issues and TODO plans, detects complexity
- `tdd-implementer` - Implements solutions with TDD (RED → GREEN → REFACTOR)
- `test-coverage-improver` - Creates missing unit tests
- `react-class-to-functional-converter` - Converts React class components to functional components
- `redux-form-analyzer` - Analyzes Redux Form for migration

**Why:** Specialized agents are better at specific tasks than a single generalist agent.

**See:** [implementations/claude-code/README.md](../implementations/claude-code/README.md)

### Pattern 13: Chain of Thought

**Concept:** Break complex problems into intermediate steps before the final answer.

**Our implementation:**
- **Explore** → Read relevant files, understand the structure
- **Plan** → Think through approaches, identify edge cases
- **Code** → Implement with TDD (RED → GREEN → REFACTOR)
- **Commit** → Verify and commit

**Why:** AI that jumps straight to coding without understanding the problem gives worse results.

**See:** [workflows.md](../core/rules/workflows.md)

### Pattern 6: Basic RAG (Retrieval-Augmented Generation)

**Concept:** Ground responses by adding relevant knowledge base information to prompts.

**Our implementation:**
- Testing rules: `core/rules/testing.md`
- Workflows: `core/rules/workflows.md`
- The AI reads the relevant documents before generating

**Example:**

```text
User: "Add a processing status field to the case overview"
  ↓
AI searches the codebase for the API call
  ↓
AI finds: GET /api/sak/{sakId} → my-api/.../SakController.java:156
  ↓
AI concludes: Both frontend (my-app) and backend (my-api) must be changed
```

**Why:** Grounding reduces hallucinations and ensures the AI works with the actual codebase structure.

### Pattern 17: Reflection

**Concept:** The AI evaluates and improves its own output.

**Our implementation:**
- 4-file document structure: `1-description.md`, `2-analysis.md`, `3-solution.md`, `4-status.md`
- The AI can re-run `/aide-analyze` after code changes
- The AI updates `4-status.md` during implementation

**Why:** Iterative improvement of the analysis and plan gives better results than one-shot generation.

---

## AI best practices

### From Anthropic: Claude Code Best Practices

**Source:** [Anthropic Engineering Blog](https://www.anthropic.com/engineering/claude-code-best-practices)

**Key points:**

1. **Explore → Plan → Code → Commit workflow**
   - Steps 1-2 are critical - without them the AI jumps straight to coding
   - Already built into `core/rules/workflows.md`

2. **Test-Driven Development**
   - Iterate toward a clear goal (a test that must pass)
   - Already built into the `3-solution.md` TDD approach

3. **Visual iteration**
   - Use screenshots and design mocks
   - Added to `core/rules/documentation.md` (assets folders)

4. **Context management**
   - Use `/clear` between independent tasks
   - Added to `core/rules/workflows.md` (Workflow optimization)

5. **Specific instructions**
   - Detailed descriptions give a significantly higher success rate
   - Added to `core/rules/documentation.md` (Best practices)

**See:** [documentation.md](../core/rules/documentation.md#best-practices-for-ai-assisted-documentation) and [workflows.md](../core/rules/workflows.md#workflow-optimization)

### From OpenAI: Best Practices for Prompt Engineering

**Principles:**

1. **Write clear instructions**
   - Already implemented: Detailed templates in `core/templates/`
   - Specific instructions in `CLAUDE.md`, `copilot-instructions.md`

2. **Provide reference text**
   - Already implemented: `core/rules/`
   - The AI reads documentation before generating (RAG pattern)

3. **Split complex tasks into simpler subtasks**
   - Already implemented: 4-file document structure
   - Phase-based implementation (Create → Analyze → Implement → Verify)

4. **Give the model time to "think"**
   - Already implemented: Explore and Plan phases before Code
   - AI-specific "deep thinking" features can be enabled as needed

### From GitHub: Copilot Best Practices

**Principles:**

1. **Use descriptive function names**
   - Implemented: Naming conventions in the project coding standard

2. **Provide context through comments**
   - Implemented: Before/after examples in `3-solution.md`

3. **Break down large functions**
   - Implemented: Refactoring guidelines in the project coding standard

---

## Resources and inspiration

### Generative AI Design Patterns

**Repo:** [lakshmanok/generative-ai-design-patterns](https://github.com/lakshmanok/generative-ai-design-patterns)

**Book:** "Generative AI Design Patterns" (O'Reilly)

**32 patterns organized into categories:**

1. **Patterns 1-5:** Prompt engineering basics
2. **Patterns 6-12:** Knowledge & context management (RAG, semantic search)
3. **Patterns 13-16:** Reasoning & decision-making (Chain of Thought, Tree of Thoughts)
4. **Patterns 17-20:** Reliability & safety (LLM-as-Judge, reflection, guardrails)
5. **Patterns 21-23:** Agent action & tool orchestration ⭐ (Tool Calling, Code Execution, Multi-agent)
6. **Patterns 24-32:** Advanced patterns (template generation, etc.)

**Which patterns we use:**
- Pattern 6: Basic RAG (API mapping, documentation)
- Pattern 13: Chain of Thought (Explore → Plan → Code)
- Pattern 17: Reflection (iterative improvement of the analysis)
- Pattern 21: Tool Calling (JIRA API, git, scripts)
- Pattern 22: Code Execution (TDD testing)
- Pattern 23: Multi-agent Collaboration (specialized agents)

### Anthropic Resources

**Claude Code Best Practices:**
- [Blog post](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Documentation](https://docs.claude.com/en/docs/claude-code)

**Prompt Engineering:**
- [Prompt Engineering Guide](https://docs.anthropic.com/claude/docs/prompt-engineering)
- [System Prompts](https://docs.anthropic.com/claude/docs/system-prompts)

### OpenAI Resources

**Best Practices:**
- [Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [GPT Best Practices](https://platform.openai.com/docs/guides/gpt-best-practices)

**Function Calling:**
- [Function Calling Guide](https://platform.openai.com/docs/guides/function-calling)

### Other resources

**AI Agent Frameworks:**
- [LangChain](https://www.langchain.com/) - Framework for building AI applications
- [AutoGPT](https://github.com/Significant-Gravitas/AutoGPT) - Autonomous agents
- [BabyAGI](https://github.com/yoheinakajima/babyagi) - Task-driven autonomous agent

**Testing AI Systems:**
- [OpenAI Evals](https://github.com/openai/evals) - Framework for evaluating AI systems
- [Promptfoo](https://www.promptfoo.dev/) - Test and evaluate LLM output quality

---

## Implementation details

### Why a 4-file document structure?

**Design choice:**
- `1-description.md` - Problem description (read-only after creation)
- `2-analysis.md` - Codebase analysis (can be re-run)
- `3-solution.md` - Implementation plan (iteratively improved)
- `4-status.md` - Progress tracking (updated continuously)

**Why 4 files, not one big file?**
1. **Separation of concerns:** Each file has one responsibility
2. **Re-entrancy:** `2-analysis.md` can be regenerated without overwriting `1-description.md`
3. **Readability:** Humans read `1-description.md` → `2-analysis.md` → `3-solution.md`
4. **AI parsing:** The AI can read one file at a time (reduces token usage)

**Inspired by:** Software engineering best practices (Single Responsibility Principle)

### Why slash commands (Claude Code)?

**Design choice:**
- `/aide-create PROJ-XXXX` - Create the document structure
- `/aide-analyze PROJ-XXXX` - Analyze the codebase
- `/aide-implement PROJ-XXXX` - Implement the solution

**Why slash commands, not natural language?**
1. **Precision:** Avoids ambiguity (vs. "analyze this issue")
2. **Consistency:** The same command gives the same result
3. **Discoverability:** `/` shows all available commands
4. **Composability:** Commands can be called from other commands

**Alternative (GitHub Copilot/Codex):** Prompt templates in `implementations/copilot/prompts/` and `implementations/codex/prompts/`

### Why a TDD approach?

**Design choice:** RED → GREEN → REFACTOR

**Why TDD for AI-assisted development?**
1. **Clear goal:** The AI has a concrete target (a test that must pass)
2. **Verifiability:** The AI can run tests and see whether they pass
3. **Iteration:** The AI can iterate until the tests pass
4. **Regression safety:** The full test suite is run after implementation

**Inspired by:** Test-Driven Development (Kent Beck)

### Why AI-agnostic design?

**Design choice:** Separate `core/` from `implementations/`

**Why not a single AI-specific implementation?**
1. **Resilience:** Not locked in to one vendor (if Claude has downtime, use Codex/Copilot)
2. **Flexibility:** Choose the best tool for each task
3. **Learning:** Compare how different AI tools handle the same tasks
4. **Future-proof:** Easy to add new AI tools

**Trade-off:** A more complex structure, but significantly more robust and flexible.

---

## Contributing to the project

### Adding a new AI implementation

1. **Create the directory:** `implementations/<ai-tool>/`
2. **Create README.md:** Setup guide and quick start
3. **Add instruction/config files** for the tool:
   - Claude Code: skills in `core/skills/`, rules in `core/rules/`, agents in `implementations/claude-code/agents/`
   - Copilot: `core/AGENTS.md` → `~/.copilot/copilot-instructions.md` (generated via `core/scripts/build-agents-md.sh`)
   - Codex: `core/AGENTS.md` → `~/.codex/AGENTS.md`, plus `implementations/codex/config.toml`
   - New AI: the equivalent format for that tool
4. **Create install.sh** following the pattern of the existing implementations
5. **Test the workflow:** Create → Analyze → Implement → Verify

### Adding a new design pattern

1. **Identify the pattern:** Which pattern solves which problem?
2. **Document it in this file:** Add it under "Design patterns in use"
3. **Implement:** Update `core/rules/` or `implementations/`
4. **Test:** Verify that the pattern works in practice

### Updating best practices

1. **Find a new resource:** Blog post, research article, documentation
2. **Evaluate relevance:** Does it fit the project's architecture?
3. **Document it here:** Add it under "AI best practices"
4. **Implement:** Update the relevant files (`core/rules/workflows.md`, `core/rules/documentation.md`)

---

## See also

- [README.md](../README.md) - The project's main page
- [workflows.md](../core/rules/workflows.md) - JIRA issue and TODO plan workflows
- [documentation.md](../core/rules/documentation.md) - Documentation standard
- [implementations/claude-code/README.md](../implementations/claude-code/README.md) - Claude Code implementation
