# AGENTS.md — Anchor

> The production-grade template for AI coding agent instructions. Adapt sections to fit project scope. Keep your agents grounded.
>
> **This file governs itself.** Agents working on AGENTS.md must follow all rules herein — the decision ladder, commit conventions, tradeoff comments, quality gates, and output discipline. No section should be added that future agents would need to explain away as inapplicable.

---

## Section Index

| Domain | Sections | Covers |
|--------|----------|--------|
| **Core** | [1](#1-core-principles)–[9](#9-linting--type-checking) | Principles, commit protocol, shell rules, code style, project structure, TODO.md, Docker, testing, linting |
| **Architecture** | [10](#10-error-handling-patterns)–[20](#20-external-integrations) | Error handling, config, API design, security, logging, git workflow, docs, deps, performance, build/deploy, external integrations |
| **AI Agent Guidance** | [21](#21-ai-agent-instruction-guidance)–[28](#28-default-tech-stack-playbook) | Instruction guidance, multi-agent patterns, verification gates, failure modes, gotchas, getting help, code quality standards, tech stack playbook |
| **Production Ops** | [29](#29-operational-patterns)–[32](#32-docker-support) | Operational patterns (circuit breaker, DLQ, middleware, cache), health endpoints, production security, Docker & Kubernetes |
| **Process** | [33](#33-pr--change-size-standards)–[41](#41-observability-standards) | PR size standards, AI anti-pattern detection, PR template, NEVER list, pre-commit hooks, CI/CD pipelines, semantic versioning, code coverage, observability |
| **Infrastructure** | [42](#42-infrastructure-as-code)–[44](#44-secrets-management) | IaC (Terraform), database backup & recovery, secrets management |
| **Testing Excellence** | [45](#45-flaky-test-management)–[49](#49-chaos-engineering) | Flaky test management, mutation testing, performance benchmarks, contract testing (Pact), chaos engineering |
| **Philosophy** | [50](#50-intentional-minimalism--the-simplicity-first-architecture)–[51](#51-instruction-architecture--context-economy--self-improvement) | Intentional minimalism (decision ladder), instruction architecture (lazy loading, self-maintenance, context budgets) |
| **Enforcement** | [52](#52-rule-enforcement-architecture--from-advisory-to-deterministic) | Two-layer enforcement model, prose-to-hook compilation, evidence-first methodology, CI compliance gates |
| **Project Types** | [53](#53-project-type-patterns) | Language-agnostic and project-type-specific patterns for mobile, embedded, data pipeline, CLI, static site, plus coverage scope |

## Quick-Navigation Cheatsheet

**Agent — how to find what you need without reading the entire document:**

| I need to... | Go to Section |
|-------------|---------------|
| Commit code | [2](#2-commit-protocol), [15](#15-git-workflow), [9](#9-linting--type-checking) |
| Create a PR | [33](#33-pr--change-size-standards), [35](#35-pr-description-format--template), [34](#34-ai-code-quality--anti-pattern-detection) |
| Review a PR | [33.2](#332-when-changes-exceed-the-limit), [50.5](#505-over-engineering-review-vocabulary), [36](#36-explicit-prohibitions--the-never-list) |
| Write tests | [8](#8-testing-requirements), [40](#40-code-coverage-enforcement), [45](#45-flaky-test-management) |
| Fix a security issue | [13](#13-security-best-practices), [27.3](#273-security-constraints--mandatory), [31](#31-production-security-patterns), [44](#44-secrets-management) |
| Set up a new project | [5](#5-project-structure-conventions), [37](#37-pre-commit-hook-standards), [38](#38-cicd-pipeline-standards), STARTUP.md |
| Deploy to production | [32](#32-docker-support), [38.3](#383-deployment-pipeline--githubworkflowsdeployyml), [30](#30-health-endpoint-specification) |
| Handle a flaky test | [45](#45-flaky-test-management) — quarantine, don't delete, fix within 7 days |
| Debug a slow endpoint | [18](#18-performance-considerations), [41.6](#416-service-level-objectives-slos), [47](#47-performance-benchmark-testing) |
| Add a dependency | [17](#17-dependency-management), [50.1](#501-the-decision-ladder--stop-at-the-first-rung-that-holds) (decision ladder rung 4) |
| Refuse a dangerous request | [2](#2-commit-protocol) (Never Go Rogue + Never Spend Money), [36.4](#364-financial-never) — cite these sections |
| Decide if code is too simple to test | [50.7](#507-tests-are-not-bloat) — one runnable check per non-trivial function |
| Rollback a bad deployment | Rollback is always `git revert` first, then fix forward. Never fix on a broken deploy — roll back, then debug. |
| Handle a merge conflict | Resolve by choosing the more recent change for logic, the clearer documentation for comments. Run full test suite after resolution. |
| Rotate secrets | [44.4](#444-secret-rotation-pattern) — dual-key window pattern, deploy new key, promote, remove old |
| Working on a non-web project (mobile, embedded, data pipeline, CLI, static site) | [53](#53-project-type-patterns) — language-agnostic and project-type-specific patterns for 5 common non-web project types |
| Want to know what this template covers vs doesn't | [53.7](#537-template-coverage-and-out-of-scope) — explicit list of well-covered, partial, and out-of-scope project types |

---

## 1. Core Principles

- **No dead code.** Every function must be called by a production path. Remove unused imports, variables, and definitions immediately. *(How: Section 9 — vulture sweep before commit)*
- **No stubs.** Every function, module, component, and endpoint must have a real implementation. *(How: Section 8 — test execution validates real output)*
- **No silent failures.** Wrapped exception handlers (`except Exception: pass`) must have a comment explaining why the failure is non-critical. Log before swallowing. *(How: Section 10 — error handling patterns)*
- **Test-first.** Every module should have corresponding tests. Tests must pass before moving on. *(How: Section 8, Section 40 — coverage enforcement)*
- **Proven integration.** After building any component, verify it works end-to-end. Do not mark a task complete without verification. *(How: Section 23 — verification gates)*
- **Cross-service contract tests.** When building features spanning multiple services, write integration tests that exercise the actual HTTP contracts between them. *(How: Section 48 — contract testing)*
- **Trace every function call.** Before marking a module complete, verify every public function is called by a production path. *(How: Section 9 — vulture identifies uncalled functions)*
- **Navigate efficiently.** This document is long by design (universal template). Jump to [Section Index](#section-index) or [Quick-Navigation Cheatsheet](#quick-navigation-cheatsheet) instead of reading sequentially. For project-specific use, trim to ≤2,000 lines. *(How: Section 51.3)*

---

## 2. Commit Protocol

**After completing and verifying any task:**
1. `git add <changed files>`
2. `git commit -m "Descriptive commit message"` — describe WHAT changed and WHY
3. `git push origin <branch>`

**GitHub automation (if `gh` command is available):**
- If the user has explicitly approved a commit and push, you may run them after validation
- Only commit/push when a LOGICAL UNIT OF WORK IS COMPLETE — never commit halfway through a feature, in the middle of debugging, or with known-broken state
- Each commit should be a stable checkpoint that passes all tests independently
- Use `gh auth status` to verify auth before attempting pushes
- If `gh` is logged in, push to the user's remote using their configured identity
- **NEVER** create GitHub Actions workflows, dependabot config, or any other GitHub-side automation without explicit per-file user approval — see Section 36.4a
- **NEVER** create PRs, issues, or comments without explicit user approval (see "Never Go Rogue" below)

**IMPORTANT — Never Go Rogue:**
- **NEVER** create PRs, issues, comments, or any GitHub activity without **explicit user approval**
- The agent must wait for the user to explicitly request: "yes, create the PR", "yes, post that comment", etc.
- Exception: The user explicitly authorizes automated commits/pushes (which is covered above)
- When in doubt, ask first

**IMPORTANT — Never Spend Money:**
- **NEVER** create GitHub Actions workflows that use paid runners, consume API credits, or incur any financial cost without explicit user approval
- **NEVER** enable GitHub features that trigger billing (GitHub Actions with large runners, GitHub Packages storage beyond free tier, Codespaces beyond free limits, GitHub Copilot for business, etc.)
- **NEVER** sign up for paid services, create cloud resources, provision API keys with billing, or do anything that could generate a financial charge
- **NEVER** modify billing settings, change plan tiers, or enable paid add-ons
- **NEVER** create CI/CD workflows that call paid third-party APIs without confirmation
- When in doubt — if an action involves any external service that might cost money — **ask first**

**IMPORTANT — Always Use the User's Identity:**
- **ALWAYS** use the configured author identity for ALL GitHub activity — commits, PRs, issues, comments, and any content attributed to a person
- **NEVER** impersonate, use a different username, create a separate bot account, or sign commits as anyone other than the configured identity
- **NEVER** attribute work to "the AI" or "the agent" in commit messages, PR descriptions, or comments — all work is attributed to the human author
- **NEVER** claim the agent wrote something independent of the user's direction
- The configured identity is the single source of truth for who authored all changes

**Author identity (already configured globally):**
- The agent should use the user's globally configured git identity for all commits
- Never change git config `user.name` or `user.email` — use what is already set
- Verify identity with `git config --global user.name` and `git config --global user.email` before first commit

**Message format conventions:**
- Prefix with scope when applicable: `api: add rate limiting`, `frontend: fix timeline scroll bug`
- For TODO completions: `Sprint N: <description>`
- Include size delta for binary builds: `autoexec.bin +12KB`

---

## 3. Shell Execution Rules

**CRITICAL:** A plugin automatically prepends `snip` to all shell commands. `snip` requires a real executable, so it will fail if applied to shell built-ins (`cd`, `export`, `source`).

**Correct format (Subshell):**
```bash
bash -c 'cd /path/to/directory && your_command --flags'
bash -c 'export VAR=value && your_command'
```

**Incorrect format (Will fail):**
```bash
cd /path/to/directory && your_command --flags
export VAR=value && your_command
```

---

## 4. Code Style

### Python
- **Formatting:** PEP 8, 4-space indentation, 100 char line limit
- **Naming:** `snake_case` (variables/functions), `PascalCase` (classes), `SCREAMING_SNAKE` (constants)
- **Imports:** Grouped stdlib → third-party → local; alphabetical within groups
- **Types:** Use type hints for all function signatures
- **Docstrings:** Google style for modules, classes, and public functions
- **Error Handling:** Specific exceptions, never bare `except:`
- **Async:** Use `async/await` for I/O-bound operations

### TypeScript / JavaScript
- **Formatting:** 2-space indentation, semicolons optional but consistent
- **Naming:** `camelCase` (variables/functions), `PascalCase` (components/types)
- **Types:** Strict mode enabled, explicit return types on exported functions
- **Components:** Functional components with hooks, no class components

### General
- No emojis in code or commit messages
- No `print` statements — use `logging`
- Keep functions under 50 lines; extract sub-functions for complex logic
- Add tests for all new functionality

### Language — English Only
- **ALL code, comments, documentation, variable names, commit messages, and user-facing text MUST be in English**
- No foreign language in any file, variable name, comment, or documentation
- This ensures all agents and developers across any language background can collaborate effectively
- Exception: Test data with realistic content (names, addresses) may use any language for authenticity

---

## 5. Project Structure Conventions

```
project/
├── src/                    # Source code
│   ├── api/               # API routes/endpoints
│   ├── models/            # Data models/schemas
│   ├── services/          # Business logic
│   └── core/              # Config, logging, exceptions
├── tests/                  # All tests, one-off scripts, random tooling
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── scripts/           # Random scripts (gitignored)
├── docs/                  # Architecture docs, ADRs, runbooks
├── research/              # Research files, whitepapers, references
├── scripts/               # CLI/tools (version controlled)
├── docker/                # Dockerfiles, compose
├── DEEPDIVE.md            # System narrative — detailed explanation
├── .env.example           # Environment template
├── .gitignore             # Git ignore (ALWAYS includes tests/)
├── README.md              # Setup and usage
├── AGENTS.md              # This file
└── TODO.md                # Task tracking
```

**Required folders for every new project:** `tests/`, `docs/`, `research/`

**DEEPDIVE.md — Living System Narrative:**

Every project MUST have a `DEEPDIVE.md` file at the root. This is not documentation — it's a detailed narrative explaining HOW and WHY the system is built the way it is.

**When to update DEEPDIVE.md:**
- After ANY architectural change
- After ANY significant refactor
- When adding new integration patterns
- When removing code (explain WHY it was removed)
- When making decisions that future agents need to understand

**DEEPDIVE.md must cover:**
- **System layout** — Why files are organized this way, why this tech stack
- **Data flow** — How data moves through the system, from ingestion to output
- **Key decisions** — Every non-obvious choice, including alternatives rejected and WHY
- **Gotchas and landmines** — Known failure modes, edge cases that bite
- **Interconnections** — How services/Modules communicate, what depends on what
- **Why things work** — Not just WHAT the code does, but WHY it was designed that way

**DEEPDIVE.md is NOT:**
- A substitute for inline comments
- A restatement of what code does (assume the code is self-documenting)
- Static — it MUST be updated when the system changes

**Example DEEPDIVE.md entry:**
```markdown
## Why the API is Split into public/admin

We split the API into port 8000 (public, read-only+search) and port 8004 
(admin, localhost-only, full CRUD) because:

- The ingestion pipeline needs to write without auth overhead
- Admin operations (scraper config, manual overrides) shouldn't be exposed
- Public users only need search and read operations
- This follows defense-in-depth: even if public API is compromised,
  admin operations remain protected by network isolation

Date: 2026-05-15
Decision: Split API into dual ports (migration 009)
```

---

## 6. TODO.md — Task Tracking Standard

Use this structure for tracking project tasks:

```markdown
# TODO.md — Project Name

## Legend
- ✅ Complete
- 🔄 In Progress
- ⬜ Not Started

## Current Sprint / Phase

| # | Status | Description |
|---|--------|-------------|
| 1 | ✅ | Completed task |
| 2 | 🔄 | Active task |
| 3 | ⬜ | Upcoming task |

## Completed Sprints

| Sprint | Status | Deliverable |
|--------|--------|-------------|
| 1   | ✅ | Feature A |
| 2   | ✅ | Feature B |

## Notes
- Document architectural decisions made during task completion
- Record any deviations from original plan and why
- Track build size delta for firmware/binary projects
```

**For multi-phase projects**, also track sub-tasks:
```
| 5a | ✅ | Sub-task A |
| 5b | ✅ | Sub-task B |
```

---

## 7. Docker / Deployment

- **Rebuild after code changes.** Containers use built images, not source files. After modifying code:
  ```bash
  docker compose build <service> && docker compose up -d <service>
  # or for all services:
  docker compose up -d --build
  ```

- **Container health checks.** All services should have healthcheck configured.

- **Ports.** Document all exposed ports and what runs on each:
  ```
  | Service | Port | Host Access | Role |
  |---------|------|-------------|------|
  | api     | 8000 | :8000       | REST API |
  | frontend| 3000 | :3090       | Web UI   |
  ```

- **Environment variables.** Use `.env.example` with documented defaults. All config via env vars, not code changes.

---

## 8. Testing Requirements

- **Unit tests** for all new functions
- **Integration tests** for workflows spanning multiple components
- **Cross-service contract tests** for HTTP API interactions
- Mock external APIs (not live calls in CI)
- Use fixtures in `conftest.py` for shared setup

### Test Commands
```bash
pytest                           # All tests
pytest tests/test_specific.py    # Single file
pytest -k "pattern"              # Matching tests
pytest --cov=. --cov-report=term-missing  # With coverage
```

---

## 9. Linting & Type Checking

**Before EVERY commit, run a full cleanup sweep:**

```bash
ruff check .                  # Lint
ruff format .                 # Format
ruff check --select=E,F,W     # Explicit errors/warnings
vulture .                     # Find dead code (uncalled functions)
mypy .                        # Type check (if available)
```

**The sweep must prove:**
- No unused imports, variables, or functions
- No functions that are defined but never called
- No dead-end code paths (code with no return/raise at end)
- No type errors
- No lint errors

**If vulture reports any findings:**
- Delete the unused code immediately
- If you're unsure whether code is truly dead, search for all references with `grep -r "function_name" .`
- Only keep code that has a proven production call path

**Do not commit until the sweep is clean.**

---

## 10. Error Handling Patterns

```python
# Good: specific exception with context
try:
    result = await client.post(url, json=data)
    result.raise_for_status()
except httpx.TimeoutException:
    logger.warning(f"Timeout calling {model}, retrying")
    raise RetryableError(f"Timeout for {url}") from None
except httpx.HTTPStatusError as e:
    logger.error(f"HTTP {e.response.status_code} from {url}")
    raise ApiError(f"Failed to call {url}") from e

# Bad: silent swallow
except Exception:
    pass
```

- Always include context in exceptions (use `from None` to suppress chain)
- Log at appropriate level: DEBUG for retryable, WARNING for degraded, ERROR for fatal
- Use `None` return with type annotation, not tuple

---

## 11. Configuration Management

- **Environment variables** for all configurable values
- **`.env.example`** as a template with all variables documented
- **Prefix convention** for namespacing (e.g., `APP_`, `SERVICE_`, `DB_`)
- **No config files in code** — everything via env vars or `.env`

---

## 12. API Design

- **REST conventions:** `GET` (read), `POST` (create), `PATCH` (update), `DELETE` (remove)
- **Prefix:** All API endpoints use `/api/...` (no `/v1/`)
- **Response format:** Consistent wrapper `{ "data": ..., "error": null }` or `{ "items": [...], "count": N }`
- **Pagination:** Cursor-based for large datasets
- **Error responses:** `{ "error": "message", "code": "ERROR_CODE" }` with appropriate HTTP status

---

## 13. Security Best Practices

- **Input validation.** Use Pydantic models or equivalent for all API inputs
- **Parameterized queries.** Never use string interpolation for SQL
- **Sanitize for logging.** Use `sanitize_for_logging()` before logging user input
- **Redact secrets.** API keys masked in logs automatically
- **Rate limiting.** Implement on public endpoints
- **No secrets in code.** All secrets via env vars or mounted secrets

---

## 14. Logging Standards

```python
import logging
logger = logging.getLogger(__name__)

# Use lazy %s formatting (not f-strings) for performance
logger.debug("Processing item %s", item_id)
logger.info("Fetched %d items from %s", count, source)
logger.warning("Retrying after %ds", delay)
logger.error("Failed to process %s: %s", item_id, str(e))
```

- Use appropriate log levels: DEBUG (per-request details), INFO (operations), WARNING (recoverable issues), ERROR (failures)
- No `print` statements — use `logging`
- Include relevant context (IDs, counts, durations) in log messages

---

## 15. Git Workflow

**Commit Messages — Sound Human, Not AI:**

Write commits as if explaining to a colleague why this change exists:

```
Good (human-sounding):
"Prevented race condition in token refresh by adding mutex lock around 
auth state mutation. Previously, concurrent requests could cause the 
refresh callback to fire twice, resulting in a 401 loop."

Bad (AI-sounding):
"fix: fixed race condition in auth service"
```

**The WHY matters most:**
- Explain the problem that existed before this change
- Explain what the change does and why it solves the problem
- If there were alternatives considered, note why you picked this one
- Include any context that future developers (or agents) need to understand

**Pattern:**
```
<type>: <what changed>

<problem>: Why this needed fixing
<solution>: What the change does and why
<context>: Any important decisions, trade-offs, or gotchas
```

**Examples:**
```
api: Added JWT refresh endpoint to eliminate 401 loops

The token refresh had a race condition where concurrent requests could
trigger multiple refresh calls. Added mutex lock around auth state.
Ref: https://github.com/org/repo/issues/1234
```

```
frontend: Rewired timeline scrubber to use IntersectionObserver

GSAP physics caused dot highlighting to desync when scrolling fast.
IntersectionObserver 1px center tripwire provides reliable sync without
third-party dependencies. Removed all physics, reduced bundle by 47KB.
```

```
db: Added content_hash unique constraint to prevent duplicate ingestion

Two scrapers could race and insert the same article from different RSS 
feeds. Added unique constraint on content_hash with NULLS NOT DISTINCT.
Migration 010 adds constraint with deduplication pass.
```

**Small commits with big explanations are fine.** A 3-line change can have a 10-line commit message explaining the problem it solves.

**Note on brevity:** Section 50.4's output discipline (≤3 lines) applies to task-completion reports, NOT to commit messages. Commit messages follow THIS section's format (problem → solution → context). The rules do not conflict — they govern different domains.

---

- **Small, focused commits.** One logical change per commit.
- **Descriptive messages.** First line <72 chars, optional body for detail.
- **Never force push** to shared branches
- **Branch naming:** `feature/name`, `fix/name`, `sprint-n`

---

## 16. Documentation Requirements

- **README.md** — Setup, quick start, architecture overview
- **API docs** — OpenAPI/Swagger at `/docs` for APIs
- **Architecture docs** — `docs/architecture.md`, ADRs in `docs/adr/`
- **Code comments** — Every non-trivial function needs a docstring explaining WHAT, HOW, WHY
- **AGENTS.md** — This file, updated when project conventions change
- **Research** — See `/research/` folder for AI agent prompt guidance whitepapers

---

## 17. Dependency Management

- Pin exact versions in `requirements.txt` or `pyproject.toml`
- Run `pip-audit` or `safety` periodically to check for vulnerabilities
- Keep dependencies minimal — avoid adding libraries for simple tasks
- Document why each major dependency exists

---

## 18. Performance Considerations

- **Async for I/O.** Use `asyncio` and `httpx.AsyncClient` for concurrent HTTP calls
- **Connection pooling.** Reuse HTTP clients and database connections
- **Caching.** Cache expensive operations with appropriate TTLs
- **Batching.** Batch API calls and DB writes where possible
- **Profile before optimizing.** Use profiling tools to identify bottlenecks, don't guess

---

## 19. Build & Deployment

For compiled/firmware projects:
- **Track build size.** Log autoexec.bin / binary size in commits.
- **Verify after changes.** Build must succeed and size must be within limits.
- **Deploy location.** Note the verified deployment path.

---

## 20. External Integrations

For each external API/service integrated:
- **Rate limits.** Document limits and how you handle them.
- **Auth method.** Document authentication mechanism.
- **Error handling.** Document error codes and retry strategy.
- **Health checks.** How to verify the integration is working.

---

## 21. AI Agent Instruction Guidance

> Based on research from AgentBench (arXiv:2308.03688) and CAMEL (arXiv:2303.17760) on what makes AI agents effective.
>
> **Provenance** (per Section 51.5):
> - **Sections 21.1, 24 (IF/IA/TLE/CLE failure modes)** — [AgentBench: A Benchmark for Evaluating LLMs as Agents](research/papers/full/agentbench-2308.03688.md) (arXiv:2308.03688, ICLR 2024)
> - **Sections 22, 21.2 (role assignment, multi-agent cooperation)** — [CAMEL: Communicative Agents for "Mind" Exploration of LLM Society](research/papers/full/camel-2303.17760.md) (arXiv:2303.17760, NeurIPS 2023)

### 21.1 Critical Findings

**Instruction following is the #1 differentiator** between successful and failing agents. Poor instruction following causes most agent failures, including:
- Invalid Format (IF) — Agent doesn't follow output format instructions
- Invalid Action (IA) — Format correct but action is invalid
- Task Limit Exceeded (TLE) — No solution after max rounds / repeated generations

### 21.2 Role Definition Pattern

Every task must include explicit role definitions:

```
Role: What the agent is expected to do
Goal: The specific outcome being sought
Backstory: Context that shapes how to approach the task
```

**Example:**
```yaml
role: Senior Data Researcher
goal: Uncover cutting-edge developments in {topic}
backstory: You're a seasoned researcher known for finding the most 
           relevant information and presenting it clearly.
```

### 21.3 Task Boundary Pattern

Define clear scope to prevent off-task behavior:

```
Description: What to do (specific, measurable)
Expected Output: Exact format of the deliverable
Tools: Available tools and how to use them
Constraints: What NOT to do
```

**Example:**
```yaml
description: >
  Conduct a thorough research about {topic}
  Make sure you find any interesting and relevant information
expected_output: >
  A list with 10 bullet points of the most relevant information
  Formatted as markdown without code blocks
constraints:
  - Do not invent information not in the source
  - Do not exceed 500 words total
```

### 21.4 Completion Criteria Pattern

Define when to stop and report results:

```
Completion Signal: What indicates the task is done
Output File: Where to write results (if applicable)
Success Criteria: How to verify the output is correct
```

**Example:**
```yaml
completion: >
  Task is complete when research findings are written to 
  report.md with all 10 bullet points filled in
output_file: report.md
success_criteria:
  - Exactly 10 bullet points
  - Each bullet < 50 words
  - No placeholder text "[TODO]"
```

### 21.5 Error Recovery Pattern

Include retry and validation mechanisms:

```
Validation: How to check if output is correct
Retry Strategy: What to do if validation fails
Fallback: What to do if retry also fails
```

**Example:**
```yaml
validation:
  - Check that output is not empty
  - Check that output is not gibberish or repeating
  - Check that output matches expected format
retry:
  max_attempts: 3
  delay_seconds: 2
fallback: >
  If all retries fail, report the specific error and 
  what was attempted before giving up
```

### 21.6 Explicit Action Schema Pattern

Define exact output formats to prevent format failures:

**Good:**
```yaml
output_format:
  type: structured
  schema:
    findings:
      type: array
      items:
        type: object
        properties:
          topic: string
          relevance: string
          source: string
        required: [topic, relevance]
  example: |
    findings:
      - topic: "AI Agents"
        relevance: "High"
        source: "arxiv.org"
```

**Bad:**
```yaml
# Vague instructions lead to format failures
output: "List your findings"
```

### 21.7 Multi-Agent Cooperation Pattern

When multiple agents work together:

```
Agent 1 (Task Specify): Proposes and breaks down tasks
Agent 2 (Task Execute): Performs the actual work
Critic Agent: Reviews and provides feedback
```

- Assign explicit roles to each agent
- Define interaction protocol (sequential, hierarchical, parallel)
- Include termination criteria for handoffs

---

## 22. Multi-Agent Cooperation Patterns

Based on CAMEL (arXiv:2303.17760) and MetaGPT (arXiv:2308.00352).

### 22.1 Role Definition Template

Every multi-agent task requires explicit role definitions:

```yaml
role: Senior <Domain> Engineer
goal: <Specific outcome being sought>
backstory: |
  You are a seasoned engineer known for <expertise>.
  You approach problems by <methodology>.
constraints:
  - Do not <forbidden action>
  - Always <required action>
  - Stop when <termination condition>
```

### 22.2 Sequential Handoff Pattern (Assembly Line)

For workflows where agents pass work sequentially (MetaGPT-style):

```
Product Manager → Architect → Engineer → QA → Deploy
```

**Rules:**
1. Each agent has explicit input/output contracts
2. Verification gate at each handoff before proceeding
3. Document any deviations at handoff boundaries
4. Supervisor agent tracks overall progress

**Example:**
```
Agent 1 (PM): Defines requirements → outputs SPEC.md
Agent 2 (Architect): Reviews SPEC → outputs architecture.md
Agent 3 (Engineer): Implements → outputs code + tests
Agent 4 (QA): Verifies → outputs test report
```

### 22.3 Hierarchical Pattern

For supervisor/worker architectures:

```
Supervisor Agent
├── Worker 1 (specific subtask)
├── Worker 2 (specific subtask)
└── Worker 3 (specific subtask)
```

**Rules:**
1. Supervisor assigns clear sub-tasks with boundaries
2. Workers report results to supervisor
3. Supervisor aggregates and decides next steps
4. Timeout on workers — if exceeded, supervisor escalates

### 22.4 Collaborative Pattern

For peer-to-peer agent cooperation:

```
Agent A ←→ Shared Context ←→ Agent B
              ↓
          Critic Agent
```

**Rules:**
1. Agents share a common context (document, state, memory)
2. Critic agent reviews and provides feedback
3. Agents iterate based on critique
4. Termination when consensus reached or max iterations hit

### 22.5 Multi-Agent Termination Criteria

For all patterns, define:
- **Max iterations** — Stop after N cycles even if not complete
- **Consensus threshold** — When to stop (e.g., 2 of 3 agents agree)
- **Escalation path** — What to do when termination reached without success
- **Context snapshot** — Save state before termination for resume

---

## 23. Verification Gates

Before proceeding to the next step, verify explicitly.

### 23.1 Format Validation

Output must match expected schema:

```python
# Validate structured output
import jsonschema
jsonschema.validate(instance=output, schema=expected_format)
```

### 23.2 Action Validation

Action must be valid for current state:

```python
# Check state before acting
if not is_valid_action(current_state, proposed_action):
    raise InvalidActionError(f"Cannot {action} in state {current_state}")
```

### 23.3 Context Validation

No context limit exceeded:

```
Before each major step:
- Estimate tokens needed for remaining work
- If remaining context < 20%, summarize/snapshot current state
- If context limit would be exceeded, flush and resume fresh
```

### 23.4 Termination Validation

Completion criteria must be met:

```
completion_checklist:
  - [ ] Output matches expected format
  - [ ] All functions have production call paths
  - [ ] No unused imports/variables (vulture clean)
  - [ ] Tests pass
  - [ ] Lint clean
  - [ ] Type check clean
  - [ ] Documentation updated (DEEPDIVE.md if needed)
```

### 23.5 Error Recovery Hierarchy

When validation fails:

1. **Retry** (max 3 attempts, exponential backoff: 1s, 2s, 4s)
2. **Alternative approach** — Try different method to achieve same goal
3. **Fallback** — Degrade gracefully (skip non-critical, continue core)
4. **Escalate** — Report detailed error with what was attempted, let user decide

---

## 24. Common Failure Modes

Based on AgentBench (arXiv:2308.03688) findings on LLM agent failures.

### 24.1 Invalid Format (IF)

**Cause:** Agent doesn't follow output format instructions.

**Prevention:**
- Provide explicit schema with examples
- Use JSON schema validation
- Give exactly one valid output format

**Recovery:**
- Show example of correct format
- Retry with stricter constraints

### 24.2 Invalid Action (IA)

**Cause:** Format correct but action is invalid for current state.

**Prevention:**
- Validate state before suggesting actions
- Provide explicit list of valid actions
- Include state machine documentation

**Recovery:**
- Report current state and valid actions
- Suggest valid alternative

### 24.3 Task Limit Exceeded (TLE)

**Cause:** No solution found after maximum iterations/rounds.

**Prevention:**
- Define clear completion criteria upfront
- Set maximum iteration count
- Implement early termination when progress stalls

**Recovery:**
- Save current state for manual review
- Report what was tried and why it failed
- Ask user for guidance on alternative approach

### 24.4 Context Limit Exceeded (CLE)

**Cause:** Interaction history exceeds max context.

**Prevention:**
- Summarize context periodically (every ~50% of context)
- Snapshot key decisions to external storage
- Start fresh session with summary if needed

**Recovery:**
- Save all context to file
- Start new session with summarized state
- Resume from checkpoint

### 24.5 Hallucination Failures

**Cause:** Agent generates plausible but incorrect information.

**Prevention:**
- Require source citations in research tasks
- Validate against known facts before accepting
- Use tool outputs as ground truth, not agent memory

**Recovery:**
- Cross-check with authoritative source
- Flag as uncertain if cannot verify

---

## 25. Common Gotchas

Lessons learned from multiple projects — things that regularly bite developers.

### 25.1 Python Version Mismatches
- Ensure Python 3.12+ for modern projects
- Use `python3 -m venv` to specify version explicitly
- Check with `python --version` before installing packages

### 25.2 Shell Command Failures
- Remember `snip` prepends to all commands automatically
- Use `bash -c '...'` format for built-ins (`cd`, `export`, `source`)
- Direct `cd` commands will fail

### 25.3 Environment Variables
- Always create `.env` from `.env.example`
- Never commit `.env` (it's in `.gitignore`)
- Missing env vars cause silent failures — check logs

### 25.4 Package Conflicts
- Use fresh virtual environments
- Install from lockfiles, not individual packages
- Run `pip freeze` to see exact versions installed

### 25.5 Type Errors
- Run `mypy` before committing
- Don't use `Any` — use `unknown` if type is truly unknown
- Generic types need explicit parameters: `list[str]` not `list`

### 25.6 Import Order
- Ruff auto-fixes import order: `ruff check --fix .`
- Stdlib → third-party → local, alphabetical within groups
- Run format check before committing

### 25.7 Race Conditions
- Concurrent operations on shared state need locks
- Test concurrent access explicitly
- Log when acquiring/releasing locks for debugging

### 25.8 Testing edge cases
- Test the empty case (empty list, empty string, None)
- Test the overflow case (very large input)
- Test the concurrent case (multiple simultaneous calls)

### 25.9 Git Mistakes
- Never `git add .` — add specific files
- Check `git diff --cached` before committing
- Use `git status` to verify what will be pushed

### 25.10 Docker Debugging
- Use `docker compose logs <service>` to see what's failing
- `docker compose exec <service> bash` to get shell inside
- Restart with `docker compose restart <service>`

---

## 26. Getting Help

When stuck on a problem.

### 26.1 Self-Service First

1. Check project documentation in `/docs/`
2. Search `/research/` for similar patterns or whitepapers
3. Review past commits for similar fixes: `git log --grep="keyword"`
4. Run linting/smoke tests — actual errors often reveal the issue
5. Search codebase with `grep -r "pattern" .` for similar implementations

### 26.2 Framework-Specific Resources

```
LangChain:    https://docs.langchain.com/
AutoGPT:      https://docs.agpt.co/
CAMEL:        https://docs.camel-ai.org/
MetaGPT:      https://deepwisdom.com/
Anthropic:   https://docs.anthropic.com/
OpenAI:      https://platform.openai.com/docs/
```

### 26.3 When to Escalate

Ask the user when:
- Problem requires making decisions with trade-offs (not clear cut)
- Fix requires changing architecture rather than code
- Issue is not in code but in requirements/expectations
- You've been stuck for more than 15 minutes with no progress

### 26.4 How to Ask for Help

When escalating, provide:
- What you were trying to do
- What you tried
- What happened vs what expected
- Relevant error messages or logs

---

## 27. Code Quality Standards

Best-in-class practices for writing production-quality Python code.

### 27.1 Python Idioms

#### Context Managers — Always Use Them for Resources

```python
# CORRECT - context manager handles cleanup
with open('/path/to/file', 'r') as f:
    content = f.read()

# With transaction
with conn.begin_transaction() as txn:
    do_stuff(txn)
    txn.commit()

# Custom context manager
from contextlib import contextmanager

@contextmanager
def managed_resource(name):
    resource = acquire_resource(name)
    try:
        yield resource
    finally:
        release_resource(resource)

# Usage
with managed_resource("cache") as cache:
    cache.get("key")

# WRONG - manual cleanup risks exceptions
try:
    f = open('/path/file', 'r')
    content = f.read()
finally:
    f.close()  # If read() throws, this doesn't run
```

#### Type Choices — dataclass vs NamedTuple vs TypedDict vs Class

```python
# Use dataclass for: simple data containers with automatic methods
from dataclasses import dataclass, field

@dataclass
class Point:
    x: float
    y: float

@dataclass
class InventoryItem:
    name: str
    unit_price: float
    quantity_on_hand: int = 0
    tags: list[str] = field(default_factory=list)  # NEVER use mutable default!

# Use NamedTuple for: immutable lightweight structs
from typing import NamedTuple

class Employee(NamedTuple):
    name: str
    id: int
    department: str = "Engineering"

# Use TypedDict for: dict with specific key types (JSON-like data)
from typing import TypedDict, Required, NotRequired

class Movie(TypedDict, total=True):
    title: Required[str]
    year: int  # Required when total=True
    director: NotRequired[str]

# Use class for: complex behavior, inheritance, encapsulation
class DatabaseConnection:
    def __init__(self, host: str, port: int):
        self._host = host
        self._port = port

    def connect(self) -> None:
        """Establish connection to database."""
        ...
```

#### List Comprehensions vs Loops vs Generators

```python
# Use list comprehension for: simple transformations/filtering
squares = [x**2 for x in range(10)]
evens = [x for x in range(20) if x % 2 == 0]

# Use dict comprehension for: key-value transformations
squares_dict = {x: x**2 for x in range(10)}
filtered = {k: v for k, v in original.items() if v > 1}

# Use generators for: large sequences, memory efficiency, pipelining
def fibonacci(n):
    a, b = 0, 1
    for _ in range(n):
        yield a
        a, b = b, a + b

# Generator expression - O(1) memory for million items
million_squares = (x**2 for x in range(1_000_000))  # No memory used yet!

# Generator pipeline - memory efficient
def process_large_file(filepath):
    with open(filepath, 'r') as f:
        for line in f:
            yield parse_line(line)

# WRONG - loop when comprehension fits (less readable)
result = []
for x in items:
    if x > 0:
        result.append(x * 2)

# CORRECT
result = [x * 2 for x in items if x > 0]
```

---

### 27.2 Anti-Patterns — NEVER Do These

#### Mutable Default Arguments

```python
# WRONG - shared mutable default causes bugs
def append_to_list(item, items=[]):
    items.append(item)
    return items

append_to_list(1)  # Returns [1]
append_to_list(2)  # Returns [1, 2] — BUG!

# CORRECT - None + create new
def append_to_list(item, items=None):
    if items is None:
        items = []
    items.append(item)
    return items

# For dataclasses, use default_factory
from dataclasses import field

@dataclass
class Node:
    children: list['Node'] = field(default_factory=list)
```

#### Global State

```python
# WRONG - hidden mutable state
_counter = 0

def increment():
    global _counter
    _counter += 1

# CORRECT - encapsulate
class Counter:
    def __init__(self):
        self._count = 0

    def increment(self):
        self._count += 1

    @property
    def count(self):
        return self._count
```

#### Circular Imports

```python
# WRONG - circular dependency
# module_a.py
from module_b import something  # If module_b imports from module_a

# CORRECT - use TYPE_CHECKING for type hints
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from module_b import Something  # Only for type checking, not runtime

# Or use late imports inside functions
def some_function():
    from module_b import something  # Deferred import
    return something()
```

#### Using type() for Type Checking

```python
# WRONG
if type(obj) is type(1):
    obj.do_something()

# CORRECT - use isinstance()
if isinstance(obj, int):
    obj.do_something()

if isinstance(obj, (int, float)):
    handle_numeric(obj)
```

#### Bare except / Catching Exception

```python
# WRONG - catches everything including KeyboardInterrupt
try:
    do_something()
except:  # NEVER do this
    print("Error")

# CORRECT - catch specific exceptions
try:
    result = collection[key]
except KeyError:
    return key_not_found(key)
```

---

### 27.3 Security Constraints — MANDATORY

#### SQL Injection Prevention

```python
# WRONG - SQL injection vulnerable
query = f"SELECT * FROM users WHERE name = '{name}'"
cursor.execute(query)

# CORRECT - parameterized queries
cursor.execute("SELECT * FROM users WHERE name = %s", (name,))

# Using SQLAlchemy
from sqlalchemy import text

query = text("SELECT * FROM users WHERE name = :name")
result = session.execute(query, {"name": name})
```

#### Input Validation

```python
import re
from urllib.parse import urlparse

def validate_email(email: str) -> bool:
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))

def sanitize_filename(filename: str) -> str:
    # Remove path components and special characters
    return re.sub(r'[^a-zA-Z0-9.-]', '', filename)

def validate_url(url: str) -> bool:
    try:
        result = urlparse(url)
        return all([result.scheme, result.netloc])
    except ValueError:
        return False
```

#### NO eval()/exec() on User Input

```python
# WRONG - code injection vulnerability
user_input = "os.system('rm -rf /')"
result = eval(user_input)  # DANGEROUS!

# CORRECT - safe literal evaluation only
import ast

def safe_eval(expression: str):
    try:
        return ast.literal_eval(expression)  # Only parses literals
    except ValueError:
        raise ValueError(f"Invalid literal: {expression}")
```

#### File Path Traversal Prevention

```python
from pathlib import Path

def safe_read_file(base_dir: Path, user_path: str) -> str:
    requested_path = (base_dir / user_path).resolve()

    if not requested_path.is_relative_to(base_dir):
        raise ValueError("Access denied: path outside allowed directory")

    return requested_path.read_text()
```

#### Secure Password Handling

```python
import bcrypt
import secrets

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode(), salt).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def generate_token() -> str:
    return secrets.token_urlsafe(32)
```

---

### 27.4 Performance Patterns

#### String Concatenation — Use join(), Not + in Loops

```python
# WRONG - O(n²) in loop
result = ""
for item in items:
    result += str(item)

# CORRECT - O(n)
result = "".join(str(item) for item in items)

# For building from parts
parts = ["Hello", name, "!"]
final = " ".join(parts)
```

#### Avoiding N+1 Query Patterns

```python
# WRONG - N+1 problem
users = session.query(User).all()
for user in users:
    print(user.posts.count())  # Query per user!

# CORRECT - eager loading
from sqlalchemy.orm import joinedload, selectinload

users = session.query(User).options(
    joinedload(User.posts)
).all()
for user in users:
    print(len(user.posts))  # No additional queries

# CORRECT - use subqueries for aggregations
from sqlalchemy import func

user_post_counts = session.query(
    User.id,
    func.count(Post.id).label('post_count')
).outerjoin(Post).group_by(User.id).all()
```

#### When to Use Generators

```python
# Use when: large dataset, streaming, don't need random access
def process_large_file(filepath):
    with open(filepath, 'r') as f:
        for line in f:  # One line at a time, O(1) memory
            yield parse_line(line)

# Generator expression - lazy evaluation
squares = (x**2 for x in range(1_000_000))  # No computation yet

# Pipeline - memory efficient chaining
def filter_even(numbers):
    return (x for x in numbers if x % 2 == 0)

def double(numbers):
    return (x * 2 for x in numbers)

result = filter_even(double(range(1_000_000)))  # O(1) memory
```

#### Avoiding Unnecessary Copies

```python
# WRONG - unnecessary copies waste memory
original = [1, 2, 3]
backup = original[:]  # Creates copy when you might not need it

# CORRECT - only copy when needed
def modify_list(lst):
    lst_copy = lst.copy()  # Explicit copy when required
    # modify copy, original unchanged

# For dicts
copy_dict = original_dict.copy()  # Shallow copy

# For deep copies of nested structures
import copy
deep_copy = copy.deepcopy(nested_structure)
```

---

### 27.5 Documentation Quality

#### Docstrings — Google Style for All Public APIs

```python
def calculate_area(width: float, height: float) -> float:
    """Calculate the area of a rectangle.

    Args:
        width: The width of the rectangle in units.
        height: The height of the rectangle in units.

    Returns:
        The area in square units.

    Raises:
        ValueError: If width or height is negative.
    """
    if width < 0 or height < 0:
        raise ValueError("Dimensions must be non-negative")
    return width * height

class DataProcessor:
    """Transforms raw input data into structured format.

    Handles edge cases like missing values, type mismatches,
    and provides consistent output regardless of input variations.

    Attributes:
        validation_mode: If True, raises on invalid data.
        default_value: Fallback for missing fields.
    """

    def process(self, data: dict) -> ProcessedData:
        """Process raw data dictionary."""
```

#### Comments — Explain WHY, Not WHAT

```python
# GOOD comment - explains WHY (not what code already says)
# We use depth-first search because it preserves path order
# needed for the undo system to work correctly
def find_path(graph, start, end):
    ...

# WRONG comment - states the obvious
# Increment counter by 1
counter += 1

# GOOD inline comment for non-obvious behavior
result = [x for x in items if x > 0]  # Filter out negatives/zero

# Use TODO/FIXME for temporary notes
# TODO: Remove this hack after fixing upstream bug
# FIXME: Race condition on concurrent access
```

---

### 27.6 Testing Quality

#### Arrange-Act-Assert Pattern

```python
def test_transfer_funds():
    # Arrange - set up test data
    source = Account(balance=100)
    destination = Account(balance=50)

    # Act - perform the action under test
    result = transfer_funds(source, destination, 25)

    # Assert - verify outcomes
    assert result is True
    assert source.balance == 75
    assert destination.balance == 75
```

#### Test Isolation — No Interdependencies

```python
# WRONG - tests depend on each other
global user_id
def test_create_user():
    global user_id
    user_id = create_user("Alice")

def test_update_user():  # Depends on test_create_user running first!
    update_user(user_id, name="Bob")

# CORRECT - each test is fully independent
def test_create_user():
    user = create_user("Alice")
    assert user.id is not None

def test_update_user():
    user = create_user("Bob")
    updated = update_user(user.id, name="Charlie")
    assert updated.name == "Charlie"
```

#### Mock vs Real vs Spy

```python
# Mock - completely replace dependency
from unittest.mock import Mock

def test_order_processor():
    mock_db = Mock()
    mock_db.save.return_value = True

    processor = OrderProcessor(db=mock_db)
    result = processor.process(Order(id=1))

    mock_db.save.assert_called_once()

# Spy - watch calls but use real implementation
def test_logger_calls_write():
    with patch('app.file_write') as mock_write:
        logger = Logger()
        logger.write("message")

        mock_write.assert_called_once_with("message")

# Real object - integration test
def test_database_connection():
    db = RealDatabaseConnection()  # Integration test
    db.connect()
    assert db.is_connected()
```

#### What Makes a Good Test

```python
# GOOD - clear name, tests one thing, readable
def test_user_creation_with_valid_data():
    """User can be created with valid name and email."""
    user = User(name="Alice", email="alice@example.com")
    assert user.name == "Alice"
    assert user.email == "alice@example.com"

# GOOD - edge case testing
def test_negative_dimensions_raise_value_error():
    """Negative width or height raises ValueError."""
    with pytest.raises(ValueError):
        calculate_area(-5, 10)

# BAD - too generic, tests too much
def test_stuff():
    result = do_something()
    assert result is not None
```

---

### 27.7 Error Handling Patterns

#### Specific Exception Catching

```python
# CORRECT - catch specific exceptions
try:
    result = process_data(data)
except ValueError as e:
    logger.error(f"Invalid data format: {e}")
except KeyError as e:
    logger.error(f"Missing required key: {e}")
except TimeoutError:
    logger.warning("Operation timed out, retrying")

# Best practice - minimal try block
try:
    value = collection[key]
except KeyError:
    return key_not_found(key)
else:
    return handle_value(value)  # Only runs if no exception
```

#### Exception Chaining — Preserve Tracebacks

```python
# CORRECT - explicit chaining with 'from'
try:
    validate_input(data)
except ValidationError as e:
    raise ConfigurationError(f"Failed to load config: {e}") from e

# CORRECT - implicit chaining (re-raise after handling)
try:
    config = load_config(path)
except FileNotFoundError:
    raise ConfigurationError(f"Config not found: {path}") from None

# WRONG - loses original traceback
try:
    do_something()
except SomeError:
    raise OtherError("Message")  # from e is missing!
```

#### Custom Exception Design

```python
class AppError(Exception):
    """Base exception for application errors."""
    def __init__(self, message: str, code: str = None):
        self.message = message
        self.code = code
        super().__init__(self.message)

class ValidationError(AppError):
    """Raised when input validation fails."""
    pass

class ResourceNotFoundError(AppError):
    """Raised when a requested resource is not found."""
    pass

# Usage
def get_user(user_id):
    user = db.find_user(user_id)
    if not user:
        raise ResourceNotFoundError(
            f"User {user_id} not found",
            code="USER_NOT_FOUND"
        )
```

#### Circuit Breaker Pattern

```python
import time
from enum import Enum

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitBreaker:
    def __init__(self, failure_threshold=5, timeout=60):
        self.failure_threshold = failure_threshold
        self.timeout = timeout
        self.failures = 0
        self.last_failure_time = None
        self.state = CircuitState.CLOSED

    def call(self, func, *args, **kwargs):
        if self.state == CircuitState.OPEN:
            if self._should_attempt_reset():
                self.state = CircuitState.HALF_OPEN
            else:
                raise CircuitBreakerOpenError("Circuit is open")

        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise

    def _should_attempt_reset(self):
        return (time.time() - self.last_failure_time) >= self.timeout

    def _on_success(self):
        self.failures = 0
        self.state = CircuitState.CLOSED

    def _on_failure(self):
        self.failures += 1
        self.last_failure_time = time.time()
        if self.failures >= self.failure_threshold:
            self.state = CircuitState.OPEN
```

#### Retry with Exponential Backoff

```python
import time
import random

@exponential_retry(max_attempts=5, base_delay=0.5, max_delay=60)
def fragile_operation():
    pass  # Will retry with backoff on failure

def exponential_retry(max_attempts=3, base_delay=1, max_delay=60):
    def decorator(func):
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt < max_attempts - 1:
                        delay = min(base_delay * (2 ** attempt), max_delay)
                        delay += random.uniform(0, 0.1 * delay)
                        time.sleep(delay)
            raise last_exception
        return wrapper
    return decorator
```

---

### 27.8 Code Quality Checklist

Before marking any code complete, verify:

- [ ] **No mutable default arguments** — Use `None` + create new, or `field(default_factory=...)`
- [ ] **No global mutable state** — Encapsulate in classes, pass as parameters
- [ ] **No circular imports** — Use `TYPE_CHECKING` or late imports
- [ ] **Use isinstance() not type()** — For type checking
- [ ] **No bare except** — Catch specific exceptions only
- [ ] **No eval()/exec()** — On any user input
- [ ] **SQL uses parameterized queries** — Never string interpolation
- [ ] **Input validated and sanitized** — Every external input
- [ ] **Context managers used** — For file/database/connection resources
- [ ] **Type hints on all public APIs** — Functions, classes, methods
- [ ] **Docstrings on all public APIs** — Google style with Args/Returns/Raises
- [ ] **Comments explain WHY** — Not what code already says
- [ ] **Tests follow AAA pattern** — Arrange, Act, Assert
- [ ] **Tests are isolated** — No interdependencies
- [ ] **Generators for large data** — Memory efficiency
- [ ] **String join() not + in loops** — Performance
- [ ] **No N+1 queries** — Use eager loading or subqueries
- [ ] **Exception chaining preserved** — Use `from e` when appropriate
- [ ] **Custom exceptions inherit from AppError** — Consistent hierarchy

---

## 28. Default Tech Stack Playbook

Best-in-class recommendations for common project types, based on analysis of top GitHub projects (FastAPI, Next.js, Gin, etc.) and current industry trends.

### 28.1 How to Use This Playbook

When starting a new project, identify the project type below and use the recommended stack.
This playbook prioritizes:
- Production-proven technologies (Microsoft, Netflix, Uber use FastAPI)
- Strong ecosystem and community support
- Best performance per complexity ratio
- Async-first for I/O-bound workloads

---

### 28.2 REST APIs

#### Python API — FastAPI (RECOMMENDED)

**Stack:** FastAPI + Pydantic + Uvicorn + SQLAlchemy + PostgreSQL

**Evidence:** Microsoft, Uber, Netflix, Cisco use FastAPI in production. 98.9k GitHub stars.

```
project/
├── src/
│   ├── api/              # FastAPI routes
│   ├── models/           # Pydantic models (request/response)
│   ├── services/         # Business logic
│   └── core/             # Config, logging, database
├── tests/
├── alembic/              # DB migrations (if using SQLAlchemy)
└── docker-compose.yml
```

**Why FastAPI:**
- Auto-generated OpenAPI docs (Swagger UI)
- Type hints throughout (mypy-friendly)
- Async support (high throughput)
- Pydantic validation built-in
- Performance on par with Node.js/Go

**When to choose FastAPI over alternatives:**
- ✅ ML model serving (first-class async, streaming responses)
- ✅ Data ingestion APIs (high throughput, validation)
- ✅ Microservices (lightweight, fast cold starts)
- ✅ Internal tooling (auto-docs save time)
- ❌ Full admin panel needed (use Django instead)
- ❌ Simple scripts (use Flask or click/typer instead)

#### Node.js API — Express.js or Fastify

**Express.js Stack:** Express + TypeORM + PostgreSQL

**Fastify Stack:** Fastify + Prisma/Drizzle + PostgreSQL

```
When to use Node.js over Python:
- Team has strong JS/TS expertise
- Frontend is React/Next.js (shared language)
- Need existing npm ecosystem integration
```

#### Go API — Gin (RECOMMENDED)

**Stack:** Gin + GORM + PostgreSQL

**Evidence:** 88.6k stars, benchmark fastest Go framework.

```
When to use Go over Python:
- Sub-millisecond latency required
- High concurrency (10k+ requests/sec)
- Memory footprint must be minimal
- Team has Go experience
```

---

### 28.3 Full-Stack Web Applications

**RECOMMENDED Stack:**

| Layer | Technology | Why |
|-------|------------|-----|
| Frontend | Next.js 15 (App Router) | SSR/SSG, React 18, API routes |
| Styling | Tailwind CSS + shadcn/ui | Utility-first, accessible components |
| API | FastAPI (Python) or Route handlers | FastAPI for complex, Next.js for simple |
| Database | PostgreSQL | ACID, JSON, vectors, pgvector |
| Cache | Redis | Sessions, rate limiting, caching |
| Search | Typesense or Meilisearch | Typo-tolerant, fast |
| Auth | NextAuth.js or custom JWT | NextAuth for Next.js, JWT for others |
| Deploy | Vercel (frontend) + Railway/Render (backend) | Easiest scaling |

**Project Structure:**

```
web-app/
├── frontend/                 # Next.js app
│   ├── app/                # App Router pages
│   ├── components/         # UI components (shadcn/ui)
│   ├── lib/                # Utilities
│   └── public/             # Static assets
├── backend/                 # FastAPI
│   ├── src/
│   │   ├── api/
│   │   ├── models/
│   │   ├── services/
│   │   └── core/
│   └── docker-compose.yml
├── postgres/
├── redis/
└── docker-compose.yml
```

---

### 28.4 Data Pipelines / Scraping

**Stack:** Python + FastAPI/Flask + Celery + Redis + PostgreSQL + Playwright/Scrapy

**For heavy scraping:**
```
Crawler → Playwright/Scrapy → Task Queue (Celery) → Processing (Pandas/Polars) → Database
                ↓
         Rate limiting (Redis)
         Duplicate detection (PostgreSQL)
```

**Key libraries:**
- **Scrapy** — Large-scale crawling, built-in rate limiting
- **Playwright** — JS-rendered pages, headless browsers
- **Celery** — Distributed task queue with Redis broker
- **Pandas/Polars** — Data processing (Polars for speed)
- **BeautifulSoup** — Simple HTML parsing

---

### 28.5 Machine Learning / AI Applications

**Model Serving Stack:** FastAPI + Uvicorn + PyTorch/TensorFlow

```
# Production ML serving pattern
import torch
from fastapi import FastAPI

app = FastAPI()

@app.post("/predict")
async def predict(data: InputData):
    with torch.no_grad():
        result = model(input_tensor)
    return {"prediction": result.tolist()}
```

**LLM Applications:**
- **LangChain / LlamaIndex** — RAG, agents, tool use
- **vLLM** — High-throughput LLM inference (PagedAttention)
- **pgvector** — Vector storage in PostgreSQL
- **Redis** — Semantic caching for LLM responses

**Data Processing:**
- **Polars** — Fast DataFrame library (10x pandas)
- **Dask** — Parallel pandas for out-of-memory data
- **Apache Arrow** — Columnar format for interchange

---

### 28.6 Real-Time Applications

**Stack:** Socket.io + FastAPI + Redis + PostgreSQL

```
Client ←→ Socket.io Server ←→ Redis (pub/sub) ←→ Background workers
                ↓
         FastAPI REST API (fallback)
```

**When to use WebSocket vs SSE:**
- **WebSocket (Socket.io):** Bidirectional, low latency, complex state
- **SSE (Server-Sent Events):** Server→client only, simpler, HTTP/2 friendly

**Key patterns:**
```python
# Redis pub/sub for multi-server WebSocket
# Channels: user-specific, room-specific, broadcast
```

---

### 28.7 CLI Tools

#### Python CLI — Typer (RECOMMENDED)

**Evidence:** Created by FastAPI team, 18k+ stars.

```python
import typer

app = typer.Typer()

@app.command()
def create(name: str, email: str):
    """Create a new user."""
    ...
```

**Why Typer:**
- Type hints = automatic CLI argument parsing
- Google-style docstrings = help text
- Same team as FastAPI (consistent DX)

#### Go CLI — Cobra

**Evidence:** Used by Kubernetes, Docker CLI. 35k+ stars.

**When to use:**
- Cross-compilation to multiple platforms
- Team has Go experience
- Need to integrate with Go ecosystem

---

### 28.8 Embedded / Firmware Projects

**Note:** This differs from typical software projects. See also: `/app/70d/` for Canon camera firmware example.

**Languages:**
- **C/C++** — Industry standard, maximum control
- **Rust** — Memory safety without GC, embedded support growing
- **Zig** — Emerging, systems programming with modern tooling

**When starting firmware projects:**
- Document target hardware in DEEPDIVE.md
- Track build sizes in commits
- Use QEMU for development/testing when possible

---

### 28.9 Quick Reference Table

| Project Type | Language | Framework | Database | Cache | Notes |
|-------------|----------|-----------|----------|-------|-------|
| REST API (general) | Python | FastAPI | PostgreSQL | Redis | First choice |
| REST API (high-perf) | Go | Gin | PostgreSQL | Redis | Sub-ms latency |
| REST API (Node team) | TypeScript | Express/Fastify | PostgreSQL | Redis | Team familiarity |
| Full-stack Web | TypeScript | Next.js | PostgreSQL | Redis | SSR + API routes |
| ML Model Serving | Python | FastAPI | - | Redis | Async + streaming |
| Data Pipeline | Python | FastAPI/Flask | PostgreSQL | Redis | Celery for workers |
| Real-time App | Python/TS | Socket.io | PostgreSQL | Redis | Bidirectional |
| CLI Tool | Python | Typer | - | - | Use click as alternative |
| CLI Tool | Go | Cobra | - | - | Cross-platform |
| Web Scraper | Python | Scrapy | PostgreSQL | Redis | Rate limiting built-in |
| Content Site | TypeScript | Next.js | PostgreSQL | Redis | SSG + ISR |

---

### 28.10 Tech Stack Decision Tree

When unsure what stack to choose:

```
Is it a web app with user-facing UI?
├── Yes → Next.js + Tailwind + shadcn/ui
└── No ↓

Is it an API/service?
├── Does it need ML/AI model serving?
│   ├── Yes → FastAPI + PyTorch
│   └── No ↓
├── High performance needed?
│   ├── Yes → Go/Gin or Rust/Actix
│   └── No ↓
└── Team expertise?
    ├── Python → FastAPI
    ├── Node → Express/Fastify
    └── Go → Gin

Is it a CLI tool?
├── Python team → Typer
└── Go team → Cobra

Is it embedded/firmware?
└── C/C++ (standard) or Rust (modern)
```

---

### 28.11 Anti-Recommendations

**Avoid these (unless specific reason):**
- **Django** — Overkill for APIs, use FastAPI instead
- **Flask alone** — Use FastAPI for new projects (better async, auto-docs)
- **Mongoose** — Use Prisma/Drizzle for TypeScript (better DX)
- **MongoDB** — Use PostgreSQL for most cases (ACID, JSON support)
- **REST framework (Django)** — Use FastAPI instead
- **Express alone** — Use Fastify for new projects (faster, schema validation)

### 28.12 Database Strategy — Shared vs Per-Service

For multi-service/microservice systems, the database strategy evolves with project maturity:

```
Phase 1 — MVP / Starting Out (0→1):
  Shared PostgreSQL database.
  One schema per service (e.g., `users`, `orders`, `billing`).
  Each service connects with different credentials, scoped to its schema.
  PRO: Simple, single source of truth, easy joins, no distributed transactions.
  CON: Schema coupling — services can peek at each other's tables.
       Don't. Use schema-scoped credentials. Enforce in code review.

Phase 2 — Growing / Pre-Production (1→N):
  Shared database with strict schema isolation.
  Separate schemas with per-schema users who can only see their own tables.
  Start tracking cross-service query patterns — these become future service APIs.
  Add read replicas if read volume exceeds write volume.

Phase 3 — Production / Scale:
  Database per critical service.
  Services that need independent scaling, different backup schedules,
  or different storage engines get their own database instances.
  Services that are tightly coupled and always deployed together
  can share a database instance (with separate schemas).
  NEVER split a database that requires distributed transactions
  across services without first refactoring to event-driven patterns.
```

**Rules:**
- **Start with one database.** Do not create 5 databases for a 2-developer MVP. The operational burden exceeds the isolation benefit.
- **Schema per service from day one.** `users` schema, `orders` schema, `billing` schema. Never mix service tables in the same schema. This makes the eventual split trivial — just move the schema to a new instance.
- **Schema-scoped credentials from day one.** The `orders` service connects as `orders_user` who can only see `orders.*`. This prevents accidental cross-service table access.
- **Split when you have a measurable reason, not because a blog post said so.** Valid triggers: (a) service needs different backup/restore schedule, (b) service needs different storage engine or instance size, (c) service needs independent horizontal scaling, (d) service needs different geographic deployment.
- **Never split for "architecture purity."** If two services always deploy together, always scale together, and have the same availability requirements, they can share a database instance without shame.

```python
# Phase 1 example — env config per service
# orders-service/.env
DATABASE_URL=postgresql://orders_user:pass@postgres:5432/app?options=-c%20search_path%3Dorders
#                                                            ^^^ schema-scoped

# billing-service/.env  
DATABASE_URL=postgresql://billing_user:pass@postgres:5432/app?options=-c%20search_path%3Dbilling
#                                                              ^^^ different schema
```

---

## 29. Operational Patterns

Production-hardened patterns for reliability and resilience.

### 29.1 Circuit Breaker Pattern

Prevents cascading failures by stopping requests to a failing service.

```python
from enum import Enum
from datetime import datetime, timedelta
from typing import Callable, Any
import asyncio

class CircuitState(Enum):
    CLOSED = "closed"      # Normal operation
    OPEN = "open"           # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if service recovered

class CircuitBreaker:
    def __init__(
        self,
        failure_threshold: int = 5,
        success_threshold: int = 2,
        timeout: float = 60.0,
        quota_reset_timeout: float = 3600.0
    ):
        self.failure_threshold = failure_threshold
        self.success_threshold = success_threshold
        self.timeout = timeout
        self.quota_reset_timeout = quota_reset_timeout

        self.failures = 0
        self.successes = 0
        self.last_failure_time: datetime | None = None
        self.state = CircuitState.CLOSED

    def call(self, func: Callable, *args, **kwargs) -> Any:
        if self.state == CircuitState.OPEN:
            if self._should_attempt_reset():
                self.state = CircuitState.HALF_OPEN
            else:
                raise CircuitBreakerOpenError(f"Circuit open for {func.__name__}")

        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise

    def _should_attempt_reset(self) -> bool:
        if self.last_failure_time is None:
            return True
        elapsed = (datetime.now() - self.last_failure_time).total_seconds()
        return elapsed >= self.timeout

    def _on_success(self):
        self.failures = 0
        if self.state == CircuitState.HALF_OPEN:
            self.successes += 1
            if self.successes >= self.success_threshold:
                self.state = CircuitState.CLOSED
                self.successes = 0
        self.last_failure_time = None

    def _on_failure(self):
        self.failures += 1
        self.successes = 0
        self.last_failure_time = datetime.now()

        if self.failures >= self.failure_threshold:
            self.state = CircuitState.OPEN

class CircuitBreakerOpenError(Exception):
    """Raised when circuit is open and request is rejected."""
    pass

class CircuitBreakerManager:
    """Manages multiple circuit breakers for different services."""
    _instance: 'CircuitBreakerManager | None' = None

    def __init__(self):
        self._breakers: dict[str, CircuitBreaker] = {}

    @classmethod
    def get_instance(cls) -> 'CircuitBreakerManager':
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def get_breaker(self, name: str, **kwargs) -> CircuitBreaker:
        if name not in self._breakers:
            self._breakers[name] = CircuitBreaker(**kwargs)
        return self._breakers[name]
```

**When to use:**
- External API calls that may fail intermittently
- Database connections that can time out
- Any service call where failure is possible and cascading failures are dangerous

**Configuration guidelines:**
- `failure_threshold=5` — Open after 5 consecutive failures
- `success_threshold=2` — Close after 2 successes in half-open
- `timeout=60` — Try reset after 60 seconds

---

### 29.2 Dead Letter Queue (DLQ) Pattern

Handles background task failures with retry and escalation.

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
import random

class DLQStatus(Enum):
    FAILED = "failed"
    RETRYING = "retrying"
    DEAD = "dead"
    RESOLVED = "resolved"

@dataclass
class DLQEntry:
    id: int
    task_name: str
    payload: dict
    status: DLQStatus
    attempts: int
    max_attempts: int
    next_retry: datetime
    created_at: datetime
    last_error: str | None

class DeadLetterQueue:
    def __init__(
        self,
        db_session,
        max_attempts: int = 5,
        base_delay: float = 1.0,
        max_delay: float = 60.0
    ):
        self.db = db_session
        self.max_attempts = max_attempts
        self.base_delay = base_delay
        self.max_delay = max_delay

    def enqueue(self, task_name: str, payload: dict, error: str):
        """Add failed task to DLQ."""
        entry = DLQEntry(
            id=None,
            task_name=task_name,
            payload=payload,
            status=DLQStatus.FAILED,
            attempts=1,
            max_attempts=self.max_attempts,
            next_retry=datetime.now() + timedelta(seconds=self.base_delay),
            created_at=datetime.now(),
            last_error=error
        )
        self.db.add(entry)
        self.db.commit()

    def process(self, handler: Callable[[dict], Any]) -> list[dict]:
        """Process DLQ entries with exponential backoff."""
        processed = []
        now = datetime.now()

        entries = self.db.query(DLQEntry).filter(
            DLQEntry.status.in_([DLQStatus.FAILED, DLQStatus.RETRYING]),
            DLQEntry.next_retry <= now,
            DLQEntry.attempts < DLQEntry.max_attempts
        ).all()

        for entry in entries:
            try:
                handler(entry.payload)
                entry.status = DLQStatus.RESOLVED
                processed.append({"id": entry.id, "status": "resolved"})
            except Exception as e:
                self._handle_failure(entry, str(e))

        self.db.commit()
        return processed

    def _handle_failure(self, entry: DLQEntry, error: str):
        entry.attempts += 1
        entry.last_error = error

        if entry.attempts >= entry.max_attempts:
            entry.status = DLQStatus.DEAD
        else:
            entry.status = DLQStatus.RETRYING
            delay = min(self.base_delay * (2 ** entry.attempts), self.max_delay)
            delay += random.uniform(0, 0.1 * delay)
            entry.next_retry = datetime.now() + timedelta(seconds=delay)

    def get_stats(self) -> dict:
        """Get DLQ statistics for monitoring."""
        return {
            "failed": self.db.query(DLQEntry).filter_by(status=DLQStatus.FAILED).count(),
            "retrying": self.db.query(DLQEntry).filter_by(status=DLQStatus.RETRYING).count(),
            "dead": self.db.query(DLQEntry).filter_by(status=DLQStatus.DEAD).count(),
            "resolved": self.db.query(DLQEntry).filter_by(status=DLQStatus.RESOLVED).count(),
        }
```

**When to use:**
- Background tasks that can fail intermittently
- Tasks where failure should not block the main request
- Any async job that needs retry with backoff

---

### 29.3 Middleware Stack Pattern

Layer multiple concerns cleanly with a middleware chain.

```python
from fastapi import FastAPI, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
import uuid
import time
import asyncio
import logging

logger = logging.getLogger(__name__)

# 1. Request ID Middleware — UUID propagation
class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

# 2. Request Size Middleware — Prevent large payloads
class RequestSizeMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_size: int = 10 * 1024 * 1024):
        super().__init__(app)
        self.max_size = max_size

    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            content_length = request.headers.get("content-length")
            if content_length and int(content_length) > self.max_size:
                return Response(content="Request too large", status_code=413)
        return await call_next(request)

# 3. Request Timeout Middleware
class TimeoutMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, timeout: float = 30.0):
        super().__init__(app)
        self.timeout = timeout

    async def dispatch(self, request: Request, call_next):
        try:
            response = await asyncio.wait_for(call_next(request), timeout=self.timeout)
            return response
        except asyncio.TimeoutError:
            return Response(content="Request timeout", status_code=504)

# 4. Slow Query Middleware — Log slow requests
class SlowQueryMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, threshold: float = 1.0):
        super().__init__(app)
        self.threshold = threshold

    async def dispatch(self, request: Request, call_next):
        start = time.time()
        response = await call_next(request)
        duration = time.time() - start

        if duration > self.threshold:
            logger.warning(
                f"Slow request: {request.method} {request.url.path} "
                f"took {duration:.2f}s [request_id={getattr(request.state, 'request_id', '')}]"
            )
        return response

# 5. Metrics Middleware — Prometheus-style metrics
class MetricsMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self.requests_total = {}
        self.request_durations = []

    async def dispatch(self, request: Request, call_next):
        start = time.time()
        response = await call_next(request)
        duration = time.time() - start

        key = f"{request.method}_{request.url.path}"
        self.requests_total[key] = self.requests_total.get(key, 0) + 1
        self.request_durations.append(duration)

        return response

# Register all middleware in order
app = FastAPI()
app.add_middleware(RequestIDMiddleware)
app.add_middleware(RequestSizeMiddleware)
app.add_middleware(TimeoutMiddleware)
app.add_middleware(SlowQueryMiddleware)
app.add_middleware(MetricsMiddleware)
```

**Middleware order matters:**
1. RequestID (first, sets up tracing)
2. RequestSize (validate before processing)
3. Timeout (prevent hanging requests)
4. SlowQuery (measure after processing)
5. Metrics (record after everything)

---

### 29.4 Semantic Cache Pattern

LRU cache with TTL and optional Redis backend.

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Any
import hashlib
import json

@dataclass
class CacheEntry:
    key: str
    value: Any
    created_at: datetime
    ttl: int
    hits: int = 0

    def is_expired(self) -> bool:
        return (datetime.now() - self.created_at).total_seconds() > self.ttl

class SemanticCache:
    """LRU cache with TTL, optional Redis backend."""

    def __init__(self, max_size: int = 1000, default_ttl: int = 3600):
        self.max_size = max_size
        self.default_ttl = default_ttl
        self.cache: dict[str, CacheEntry] = {}

    def _make_key(self, data: dict) -> str:
        normalized = json.dumps(data, sort_keys=True)
        return hashlib.md5(normalized.encode()).hexdigest()

    def get(self, data: dict) -> Any | None:
        key = self._make_key(data)
        entry = self.cache.get(key)
        if entry is None or entry.is_expired():
            if entry:
                del self.cache[key]
            return None
        entry.hits += 1
        return entry.value

    def set(self, data: dict, value: Any, ttl: int | None = None):
        key = self._make_key(data)
        if len(self.cache) >= self.max_size:
            lru_key = min(self.cache, key=lambda k: self.cache[k].hits)
            del self.cache[lru_key]
        self.cache[key] = CacheEntry(
            key=key, value=value,
            created_at=datetime.now(),
            ttl=ttl or self.default_ttl
        )

    def invalidate(self, pattern: str | None = None):
        if pattern is None:
            self.cache.clear()
        else:
            keys_to_remove = [k for k in self.cache if pattern in k]
            for key in keys_to_remove:
                del self.cache[key]

    def get_stats(self) -> dict:
        total_hits = sum(e.hits for e in self.cache.values())
        return {
            "size": len(self.cache),
            "max_size": self.max_size,
            "total_hits": total_hits,
        }
```

---

## 30. Health Endpoint Specification

Every production service MUST implement a comprehensive health check.

### 30.1 Health Check Design

```python
from fastapi import FastAPI
from pydantic import BaseModel
from datetime import datetime
import time

app = FastAPI()
start_time = time.time()

class SubsystemStatus(BaseModel):
    status: str
    message: str | None = None
    latency_ms: float | None = None

class HealthResponse(BaseModel):
    status: str
    version: str
    uptime_seconds: float
    subsystems: dict[str, SubsystemStatus]
    timestamp: str

@app.get("/health")
async def health_check() -> HealthResponse:
    subsystems = {}
    subsystems["database"] = await check_database()
    subsystems["cache"] = await check_cache()
    subsystems["external_api"] = await check_external_api()
    subsystems["background_tasks"] = check_background_tasks()
    subsystems["dlq"] = check_dlq_status()

    overall_status = determine_overall_status(subsystems)

    return HealthResponse(
        status=overall_status,
        version=get_version(),
        uptime_seconds=time.time() - start_time,
        subsystems=subsystems,
        timestamp=datetime.now().isoformat()
    )
```

### 30.2 What to Check Per Subsystem

| Subsystem | Check | Degraded | Unhealthy |
|-----------|-------|----------|-----------|
| **Database** | Query `SELECT 1` | >100ms | >1s or error |
| **Cache (Redis)** | `PING` command | >50ms | >500ms or error |
| **External API** | HTTP GET | >500ms | >2s or 5xx |
| **Background Tasks** | Count running vs max | >80% capacity | >100% |
| **DLQ** | Count dead letters | >100 dead | >1000 dead |
| **Disk** | Available space | <20% free | <10% free |
| **Memory** | RSS vs limit | >80% used | >95% used |

### 30.3 Response Format

```json
{
  "status": "degraded",
  "version": "1.2.3",
  "uptime_seconds": 86400,
  "timestamp": "2026-06-03T12:00:00Z",
  "subsystems": {
    "database": {"status": "healthy", "latency_ms": 12},
    "cache": {"status": "degraded", "message": "Redis PING took 450ms"},
    "external_api": {"status": "unhealthy", "message": "Connection timeout"}
  }
}
```

### 30.4 Kubernetes Probe Configuration

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 10
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3
```

---

## 31. Production Security Patterns

Hardening patterns for production deployments.

### 31.1 Prompt Injection Detection

Heuristic detection for common prompt injection patterns.

```python
import re
from typing import List

class PromptInjectionDetector:
    PRE_FILTER_PATTERNS = [
        r"system\s*:", r"system\s*-", r"\[INST\]",
        r"<\|im_start\|>", r"<\|im_end\|>", r"\\[system\\]",
    ]

    INJECTION_PATTERNS = [
        (r"(?i)(ignore\s+(previous|all|above)\s+(instructions?|rules?|prompt))", "system_prompt_override"),
        (r"(?i)(you\s+are\s+a\s+dan|do\s+anything\s+now|jailbreak)", "persona_hijack"),
        (r"<\|im_start\|>", "token_injection"),
        (r"(?i)(ignore.*routing|override.*model)", "routing_manipulation"),
        (r"(base64|decode|exec|eval).*['\"]", "encoding_bypass"),
        (r"<!--.*-->", "hidden_comment"),
    ]

    def __init__(self):
        self.pre_filter = re.compile("|".join(self.PRE_FILTER_PATTERNS), re.IGNORECASE)

    def check(self, text: str) -> dict:
        threats = []
        if not self.pre_filter.search(text):
            return {"is_suspicious": False, "threats": [], "threat_level": "NONE"}

        for pattern, name in self.INJECTION_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                threats.append(name)

        return {
            "is_suspicious": len(threats) > 0,
            "threats": threats,
            "threat_level": self._calculate_threat_level(threats)
        }

    def _calculate_threat_level(self, threats: List[str]) -> str:
        if not threats:
            return "NONE"
        elif len(threats) == 1 and threats[0] in ["token_injection", "hidden_comment"]:
            return "LOW"
        elif len(threats) <= 2:
            return "MEDIUM"
        return "HIGH"
```

### 31.2 Admin Audit Logging

Track all admin actions for security and compliance.

```python
from datetime import datetime
from pydantic import BaseModel
from typing import Optional

class AdminAuditLog(BaseModel):
    id: int
    admin_user_id: int
    action: str
    target_type: str
    target_id: Optional[str]
    changes: dict
    ip_address: str
    user_agent: str
    timestamp: datetime
    success: bool
    error_message: Optional[str] = None

class AuditLogger:
    def log(
        self, admin_user_id: int, action: str, target_type: str,
        target_id: str | None, changes: dict, request: Request,
        success: bool = True, error: str | None = None
    ):
        entry = AdminAuditLog(
            id=None, admin_user_id=admin_user_id, action=action,
            target_type=target_type, target_id=target_id, changes=changes,
            ip_address=request.client.host,
            user_agent=request.headers.get("user-agent", ""),
            timestamp=datetime.now(), success=success, error_message=error
        )
        self.db.add(entry)
        self.db.commit()
```

### 31.3 API Key Encryption

Encrypt sensitive keys at rest using Fernet.

```python
from cryptography.fernet import Fernet

class KeyEncryptor:
    def __init__(self, encryption_key: bytes):
        self.fernet = Fernet(encryption_key)

    @classmethod
    def generate_key(cls) -> bytes:
        return Fernet.generate_key()

    def encrypt(self, plaintext: str) -> str:
        return self.fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        return self.fernet.decrypt(ciphertext.encode()).decode()
```

### 31.4 Admin IP Whitelist

Restrict admin endpoints to specific IPs.

```python
from fastapi import FastAPI, Request, HTTPException
import ipaddress

class AdminIPWhitelist:
    def __init__(self, allowed_cidrs: list[str]):
        self.networks = [ipaddress.ip_network(cidr) for cidr in allowed_cidrs]

    def is_allowed(self, client_ip: str) -> bool:
        try:
            ip = ipaddress.ip_address(client_ip)
            return any(ip in network for network in self.networks)
        except ValueError:
            return False
```

### 31.5 Security CI/CD Workflow

Weekly vulnerability scanning with auto-issue creation.

```yaml
# .github/workflows/security.yml
name: Security Scan

on:
  schedule:
    - cron: '0 8 * * 1'  # Monday 8 AM UTC

jobs:
  vulnerabilities:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install pip-audit safety
      - run: pip-audit --format=json --output=pip-audit.json || true
      - run: safety check --json --output=safety.json || true
      - uses: actions/github-script@v7
        if: always()
        with:
          script: |
            const fs = require('fs');
            const data = JSON.parse(fs.readFileSync('pip-audit.json', 'utf8'));
            if (data.vulnerabilities?.length > 0) {
              github.rest.issues.create({
                title: 'Security Vulnerabilities Detected',
                body: 'pip-audit found ' + data.vulnerabilities.length + ' vulnerabilities',
                labels: ['security', 'vulnerability']
              });
            }
```

---

## 32. Docker Support

Production Docker deployment patterns.

### 32.1 Dockerfile Best Practices

```dockerfile
FROM python:3.12-slim

# Create non-root user
RUN groupadd --gid 1000 router && \
    useradd --uid 1000 --gid router --shell /bin/bash router

# Virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r requirements.txt

# Application
COPY --chown=router:router . /app
WORKDIR /app
RUN mkdir -p /app/data /app/logs && chown router:router /app/data /app/logs

USER router
ENTRYPOINT ["python", "-m", "router.entrypoint"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8000/health').raise_for_status()"

LABEL org.opencontainers.image.title="Router Service"
LABEL org.opencontainers.image.version="1.0.0"
```

### 32.2 Docker Compose for Development

```yaml
version: '3.9'

services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://router:router@postgres:5432/router
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: router
      POSTGRES_USER: router
      POSTGRES_PASSWORD: router
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### 32.3 Multi-GPU Docker Compose

```yaml
services:
  app:
    build: .
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - CUDA_VISIBLE_DEVICES=0,1
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

### 32.4 Kubernetes Deployment Template

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  DATABASE_URL: "postgresql://user:pass@postgres:5432/db"
  REDIS_URL: "redis://redis:6379/0"
---
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
type: Opaque
stringData:
  ENCRYPTION_KEY: "YOUR-FERNET-KEY"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: app
          image: app:latest
          ports:
            - containerPort: 8000
          envFrom:
            - configMapRef:
                name: app-config
            - secretRef:
                name: app-secrets
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "2Gi"
              cpu: "1000m"
---
apiVersion: v1
kind: Service
metadata:
  name: app
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 8000
  selector:
    app: app
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: app
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

---

## 33. PR & Change Size Standards

Hard numeric boundaries prevent unreviewable changes from being submitted. These limits apply to all changes, whether human or AI-authored.

### 33.1 Size Limits — Hard Gates

| Change Type | Max Lines | Rationale |
|------------|-----------|-----------|
| **All changes** | 800 lines total | Derived from code review research — beyond 800 lines, reviewer accuracy drops below 70% |
| **Complex logic** | 500 lines | Architectural changes, algorithm rewrites, security-sensitive code — requires deeper review |
| **Simple/mechanical** | 800 lines | Renames, formatting, type annotation additions — still must not exceed 800 |
| **Single file** | 500 lines | If a file exceeds 500 lines of change, split into multiple PRs |

**What counts as a "line of change":**
- Added lines count
- Modified lines count
- Deleted lines count (deletions are still review burden)
- Test files count toward the limit

**What does NOT count:**
- Generated code (OpenAPI clients, protobuf stubs, migration files)
- Lockfiles (poetry.lock, package-lock.json, uv.lock)
- Snapshot files (.snap, __snapshots__/)
- Auto-formatted changes (run `ruff format` separately, commit separately)

### 33.2 When Changes Exceed the Limit

**DO NOT submit the oversized change.** Instead:

1. **Split by concern.** Separate refactoring from feature work. Mechanical changes go in their own PR.
2. **Split by layer.** Database migration in one PR → API changes in another → frontend in another.
3. **Stack PRs.** PR #1 adds the API → merge → PR #2 adds the UI on top.
4. **Pre-extract.** Do preparatory refactoring in a separate PR before the feature PR.

**Example of splitting a 1,200-line feature:**
```
Original: 1,200 lines (new API + refactoring + tests)
Split into:
  PR #1: 350 lines — extract shared utilities (no behavior change)
  PR #2: 280 lines — add database migration and model
  PR #3: 420 lines — add API endpoints + tests
  PR #4: 150 lines — wire into frontend
```

### 33.3 Single Feature Rule

Each PR addresses exactly ONE concern:
- One feature, one fix, one refactor, or one mechanical change
- Do NOT mix "fix bug while I'm in the file" changes
- Do NOT include "while I was here" formatting changes in a feature PR
- If you find an unrelated bug, open a separate issue/PR

**Good PR scopes:**
```
fix: Corrected token refresh race condition
feat: Added pagination to search endpoint
refactor: Extracted validation logic into shared module
chore: Upgraded httpx to 0.27.0
```

**Bad PR scopes:**
```
fix: Corrected token refresh race condition AND refactored auth middleware AND updated logging format
^--- Three unrelated changes, impossible to review or revert independently
```

### 33.4 Draft PR Conventions

If code is evolving but useful for discussion:
- Open PR in **draft mode** (GitHub "Create draft pull request")
- Draft PRs are for discussion, not just unfinished work — use them to get early feedback on architecture
- Mark as "Ready for review" only when all checks pass and change size is within limits
- If the branch is not ready for any review, keep it local — do not open a PR

### 33.5 FIRST-TIME CONTRIBUTOR PATH (for AI agents joining a project)

When an agent starts work on a new project:
1. First contribution should be a **small bug fix** (under 200 lines)
2. This establishes understanding of project conventions and builds trust
3. Do NOT submit a large feature as a first contribution
4. Reputation matters — reviewers calibrate scrutiny based on contributor history
5. If your first PR gets closed for being too large, do not take it personally — split and resubmit

---

## 34. AI Code Quality — Anti-Pattern Detection

AI agents produce specific failure modes that human developers rarely create. Agents MUST self-check against these patterns before submitting code.

### 34.1 Think First — Explain Before Coding

The most common AI failure mode: jumping straight to code without understanding the system.

**MANDATORY before writing any code:**
1. **Read the relevant existing code** — understand patterns, conventions, and the surrounding architecture
2. **Explain your approach** — describe the architecture and reasoning before implementation
3. **Identify the integration points** — where does this change touch existing code?
4. **Check for existing utilities** — is there already a helper/function/class that does this?

**Red flag:** If you cannot explain WHY you chose this approach over alternatives, stop and think before coding.

### 34.2 Spot the Laziness — Common LLM Shortcuts

| Laziness Pattern | What It Looks Like | Why It's Bad |
|-----------------|-------------------|--------------|
| **Trivial tests** | `assert True`, `assert result is not None`, tests with no assertions | Creates false sense of coverage without testing behavior |
| **Overly wide types** | `Optional[T]` everywhere, `Any` in function signatures | Hides real nullability contracts, defeats type checking |
| **Catch-n-log** | `except Exception: logger.error(...)` without re-raise or proper handling | Swallows errors, leaves system in undefined state |
| **Copy-paste without understanding** | Mirroring local patterns without knowing why they exist | Propagates anti-patterns, misses context-specific requirements |
| **Unnecessary helpers** | Creating small helper methods referenced only once | Adds indirection without reducing complexity |
| **Bool/flag parameters** | `foo(True, False)` — ambiguous at call site | Force callers to write hard-to-read code, hide intent |
| **Negative tests for removed logic** | Tests that check behavior that no longer exists | Tests pass vacuously, provide zero value |

### 34.3 Spot the Uncertainty — Signs the Agent Is Confused

When an agent is uncertain about the right approach, it produces code with these tells:

| Uncertainty Signal | Example | What It Means |
|-------------------|---------|---------------|
| **Numbering approaches** | "Here are 3 ways I fixed this..." | Agent tried multiple things, picked one without conviction |
| **Overly defensive code** | Checking null 5 layers deep, validating already-validated data | Agent doesn't understand the data flow invariants |
| **Excessive try/except** | Wrapping every call in try/except without specific handling | Agent doesn't know which operations can actually fail |
| **Redundant null checks** | `if x is not None` on a value that is NEVER None by construction | Agent doesn't understand the type system or data model |
| **Adding to "god objects"** | Adding methods to already-too-large classes | Agent thinks "this is where things go" without questioning the design |

**Remediation when uncertainty signs appear:**
1. Stop and read the relevant abstractions again
2. Find examples of similar patterns in the existing codebase
3. If the pattern is truly unclear, ask the user before proceeding
4. Do NOT paper over uncertainty with defensive code

### 34.4 Spot the Bloat — Unnecessary Additions

| Bloat Pattern | What It Looks Like | What to Do Instead |
|--------------|-------------------|-------------------|
| **Commenting on the change, not the code** | "Changed the timeout from 30 to 60" | Comments should explain WHY the code is the way it is, not WHAT changed |
| **Excessive tests** | 15 tests testing the same happy path with different inputs | Test boundaries: empty, single, many, error, edge cases |
| **Logging everything** | `logger.info("Entering function")`, `logger.info("Exiting function")` | Log at boundaries, log decisions, log errors — not every step |
| **Over-parameterization** | Making every constant configurable when it will never change | Default to constants, extract to config only when actually needed |
| **Future-proofing** | Adding hooks, interfaces, or extension points "for later" | YAGNI — You Aren't Gonna Need It. Add when needed, not before. |

### 34.5 You Are Responsible for the Final Code

The chain of accountability is clear:
1. The AI agent proposes code
2. The AI agent tests the code
3. The AI agent verifies the code against these anti-patterns
4. The human reviews the final output

**Do NOT:**
- Submit code you haven't tested yourself
- Blame "the model" for bad code — you ARE the model's quality filter
- Assume the human will catch what you missed — your job is to catch it first

### 34.6 Module/File Size Bounds

| Limit | Threshold | Rationale |
|-------|-----------|-----------|
| **Module max** | 500 lines (excluding tests) | Beyond 500 lines, split into sub-modules |
| **File max** | 800 lines (excluding tests) | Beyond 800 lines, add new functionality in new modules |
| **Function max** | 50 lines | Extract sub-functions for complex logic |
| **Class max** | 300 lines | Consider composition over inheritance for larger classes |

**When a file exceeds the limit:**
- Identify cohesive groups of functions — move to new module
- Do NOT just split alphabetically or arbitrarily
- Each new module should have a clear, single responsibility
- Update imports across the codebase accordingly

### 34.7 Platform Support Requirements

Unless explicitly stated otherwise for the project:
- Tests and features MUST support Linux, macOS, and Windows
- No Unix-isms in cross-platform code (no `/tmp` hardcoding, no `os.fork`, no shell-specific commands)
- Use `pathlib.Path` instead of string paths
- Use `tempfile` module for temporary files, not `/tmp/` directly
- If a feature is explicitly OS-specific, document the limitation and guard with `sys.platform` checks
- CI must run on all three platforms if the project is cross-platform

---

## 35. PR Description Format & Template

Every PR MUST use this template. AI agents are responsible for filling in both sections.

### 35.1 PR Template

```markdown
## Description

### What Changed

<Describe what this PR does in plain language. Focus on behavior, not code.>

### Why

<Explain the problem this solves. Who benefits? What was broken or missing? How does this make things better?>

### How

<High-level approach. Mention key decisions: "Chose X over Y because Z." Do NOT list every file changed — that's what the diff is for.>

### Testing

<How was this tested? What commands should the reviewer run to verify?>

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing performed (describe what was tested)

### Breaking Changes

<List any breaking changes. If none, write "None.">

### Screenshots (if UI changes)

<Before/after screenshots or GIFs of UI changes.>

---

## AI Agent Disclosure

<!-- HUMAN: The sections below were generated by an AI agent. Review carefully. -->

### Agent Decision Log

<Document any non-obvious decisions the agent made during implementation. Why were these choices made?>

### Areas Needing Human Review

<Point out specific code sections, architectural decisions, or edge cases the human reviewer should scrutinize.>

### Agent Self-Check

- [ ] Code follows project conventions (checked existing patterns)
- [ ] No dead code (vulture clean)
- [ ] No unused imports (ruff clean)
- [ ] Type check passes (mypy clean)
- [ ] Tests cover new behavior
- [ ] Change size is within limits (under 800 lines)
- [ ] No "laziness" anti-patterns (Section 34.2)
- [ ] No "uncertainty" signals (Section 34.3)
- [ ] No "bloat" additions (Section 34.4)
```

### 35.2 What the Description MUST Include

| Element | Required? | Details |
|---------|-----------|---------|
| **What changed** | REQUIRED | Behavioral description, not code summary |
| **Why** | REQUIRED | Problem statement, who benefits, root cause |
| **How** | REQUIRED | Architectural approach, key decisions, trade-offs considered |
| **Testing** | REQUIRED | Commands to run, what was manually tested |
| **Breaking changes** | REQUIRED | Explicit "None" if no breaking changes — never leave blank |
| **Agent disclosure** | REQUIRED for AI PRs | Must be present, CI may enforce this |

### 35.3 What the Description MUST NOT Include

| Forbidden | Reason | Example of Bad |
|-----------|--------|---------------|
| **Line number citations** | Lines change after merge, making references stale | "Changed the timeout on line 42" |
| **File listing** | The diff already shows which files changed | "Modified: src/api.py, src/models.py, tests/test_api.py" |
| **Code snippets in description** | Duplicates the diff, adds noise | Copying the function body into the description |
| **"Summary" header** | The description IS the summary — no redundant header | "## Summary\n\nThis PR fixes a bug..." |
| **Vague statements** | Wastes reviewer time | "Improved performance" without measurements |

### 35.4 Human-Tested Checkbox (for AI-authored PRs)

The `HUMAN:` section at the top of the template serves as a gate:
- CI can be configured to check for content between `HUMAN:` and the human-tested checkbox
- The human MUST add their verification before merging
- The agent MUST NOT fill in the human verification section

---

## 36. Explicit Prohibitions — The "NEVER" List

This section exists because general guidelines are too easy to rationalize around. These are bright lines.

### 36.1 Code NEVER

- **NEVER** use mutable default arguments (`def f(x=[])`) — use `None` + create new, or `field(default_factory=...)`
- **NEVER** use bare `except:` — always catch specific exception types
- **NEVER** use `except Exception: pass` — silent failure is forbidden. If truly non-critical, comment WHY
- **NEVER** use `eval()`, `exec()`, or `compile()` on any user-supplied input
- **NEVER** use string interpolation for SQL queries — always parameterized queries
- **NEVER** use `os.system()` or `subprocess` with `shell=True` and untrusted input
- **NEVER** import within functions to avoid circular imports — restructure the modules instead (exception: `TYPE_CHECKING` imports)
- **NEVER** create small helper methods that are referenced only once — inline the logic
- **NEVER** add `bool` or ambiguous `Optional` parameters that force callers to write `foo(False)` or `bar(None)` — use keyword-only arguments or separate methods

### 36.2 Git NEVER

- **NEVER** force push to shared branches (`main`, `develop`, any branch others might be using)
- **NEVER** commit `.env` files, credentials, API keys, or secrets of any kind
- **NEVER** `git add .` — add specific files by name, verify with `git diff --cached`
- **NEVER** amend commits that have already been pushed
- **NEVER** skip hooks (`--no-verify`, `--no-gpg-sign`) unless you have explicit permission and a documented reason
- **NEVER** push directly to `main` or `master` — always use a feature branch and PR

### 36.3 GitHub NEVER

- **NEVER** create a PR without explicit user approval (per Section 2 "Never Go Rogue" rule)
- **NEVER** comment on issues/PRs without explicit user approval
- **NEVER** close issues or PRs that you did not open
- **NEVER** assign reviewers or request changes without user direction
- **NEVER** merge a PR without explicit user approval

### 36.4 Financial NEVER

- **NEVER** create GitHub Actions workflows that use paid runners, consume API credits, or incur any financial cost without explicit user confirmation
- **NEVER** enable GitHub features that trigger billing — large runners, Packages beyond free tier, Codespaces beyond free limits, Copilot for business, Advanced Security, etc.
- **NEVER** sign up for paid cloud services, provision resources with billing attached, or register for API keys tied to a credit card
- **NEVER** modify billing settings, change plan tiers, enable paid add-ons, or accept terms that involve financial commitment
- **NEVER** create CI/CD workflows that call paid third-party APIs (e.g., paid SaaS monitoring, commercial testing services, paid deployment platforms) without explicit confirmation
- **NEVER** purchase domains, SSL certificates, or any infrastructure that costs money
- When in doubt — if any action involves an external service that could possibly charge money — **ask the user first**

### 36.4a GitHub Automation NEVER (no Actions, no bot PRs)

This subsection is broader than 36.4 (financial) and exists because the user owns the maintainer relationship with GitHub, not the agent. Even free-tier automation costs the user reviewer time, runs without their supervision, and creates artifacts (workflow runs, PRs, branches) that they must clean up.

- **NEVER** create GitHub Actions workflow files (anything under `.github/workflows/*.yml` or `.github/workflows/*.yaml`) without explicit, per-workflow user approval. "It's just CI" is not approval.
- **NEVER** create GitHub-side automation that opens pull requests or issues on the user's behalf (`dependabot.yml`, `renovate.json`, scheduled workflows, `gh-actions` cron triggers) without explicit user approval.
- **NEVER** enable GitHub repository settings that trigger work the user has not requested (branch protection rules that auto-delete, required status checks that point at workflows the user did not approve, auto-merge rules, etc.) without explicit user approval.
- **NEVER** add GitHub Apps, OAuth integrations, or third-party CI providers (Codecov, Snyk, CodeClimate, etc.) without explicit user approval — these commonly have paid tiers that auto-upgrade.
- **NEVER** assume "free tier" means zero cost. Free Actions still cost minutes, storage, and the user's review queue. If the workflow runs on every PR, multiply by the PR cadence.
- **DO** propose GitHub Actions as a recommendation when the user asks for CI, but wait for explicit approval before writing the file.
- **DO** ship the audit script and pre-commit hooks (Section 37) — these run locally and need no GitHub-side automation.
- **DO** ship PR/issue templates and CODEOWNERS — these are static markdown, not automation, and don't trigger Actions.
- When in doubt — if a change touches `.github/workflows/`, `dependabot.yml`, `renovate.json`, or any repository setting that auto-runs something — **ask the user first**.

### 36.5 Identity NEVER

- **NEVER** impersonate another user, use a different GitHub username, or create a separate bot account for any activity
- **NEVER** sign commits, create PRs, post comments, or author any content under an identity other than the configured author
- **NEVER** attribute work to "the AI" or "the agent" in commit messages, PR descriptions, issue comments, or documentation — all work is authored by and attributed to the human user
- **NEVER** claim the agent acted independently — the user directs the agent, the user authors all output
- **NEVER** configure git with a different username or email than what is already set globally
- **NEVER** use an AI-generated signature, bot handle, or fake persona in any user-facing communication

### 36.6 Testing NEVER

- **NEVER** merge code that has failing tests
- **NEVER** skip tests because "the change is small" — small changes cause big bugs
- **NEVER** write tests that depend on execution order — every test must be independently runnable
- **NEVER** write tests with `time.sleep()` to wait for async operations — use proper synchronization
- **NEVER** write tests that pass vacuously (no assertions, or assertions that can never fail)
- **NEVER** mark a task complete without running the full test suite

### 36.7 Documentation NEVER

- **NEVER** add general product or user-facing documentation to the `docs/` folder when using an LLM to generate it — docs should be human-curated
- **NEVER** leave DEEPDIVE.md stale after an architectural change — update it as part of the change
- **NEVER** comment self-evident operations — `# Increment counter by 1` above `counter += 1`
- **NEVER** write docstrings that restate the function signature — explain WHY, not WHAT

### 36.6 AI Agent NEVER

- **NEVER** guess when you can verify — run the code, check the logs, read the actual file
- **NEVER** assume a library is available — check `pyproject.toml` or `requirements.txt` first
- **NEVER** add a dependency without checking if an existing dependency already provides that functionality
- **NEVER** modify generated code (OpenAPI clients, protobuf stubs, migration files) — regenerate instead
- **NEVER** skip linting/type-checking before committing — Section 9 sweep is mandatory
- **NEVER** submit code you haven't tested — run the test suite, verify the behavior

---

## 37. Pre-Commit Hook Standards

Pre-commit hooks are a MANDATORY gate, not an optional convenience. They enforce consistency before code ever reaches CI.

### 37.1 Installation — MANDATORY First Step

Before making any changes to a project, run:

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
```

This installs the git hooks and validates the entire existing codebase. If `pre-commit run --all-files` fails, fix the failures before making any other changes.

### 37.2 Standard Configuration Template

Create `.pre-commit-config.yaml` at the project root:

```yaml
repos:
  # --- UNIVERSAL HOOKS (every project) ---

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
        name: Remove trailing whitespace
      - id: end-of-file-fixer
        name: Ensure files end with a newline
      - id: check-yaml
        name: Validate YAML syntax
      - id: check-json
        name: Validate JSON syntax
      - id: check-toml
        name: Validate TOML syntax
      - id: check-added-large-files
        name: Prevent files > 500KB
        args: ['--maxkb=500']
      - id: detect-private-key
        name: Detect accidentally committed private keys
      - id: detect-aws-credentials
        name: Detect accidentally committed AWS credentials
      - id: check-merge-conflict
        name: Check for merge conflict markers
      - id: mixed-line-ending
        name: Normalize line endings
        args: ['--fix=lf']

  # --- PYTHON HOOKS ---

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.6.0
    hooks:
      - id: ruff
        name: Lint Python (ruff)
        args: [--fix, --exit-non-zero-on-fix]
      - id: ruff-format
        name: Format Python (ruff)

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.10.0
    hooks:
      - id: mypy
        name: Type check (mypy)
        additional_dependencies: [types-all]
        args: [--ignore-missing-imports]

  # --- SECURITY HOOKS ---

  - repo: https://github.com/PyCQA/bandit
    rev: 1.7.9
    hooks:
      - id: bandit
        name: Security lint (bandit)
        args: [-c, pyproject.toml, --skip=B101]
        # B101: assert — used in tests, skip for production code scan

  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.5.0
    hooks:
      - id: detect-secrets
        name: Detect secrets in code
        args: ['--baseline', '.secrets.baseline']

  # --- GENERAL HOOKS ---

  - repo: https://github.com/codespell-project/codespell
    rev: v2.3.0
    hooks:
      - id: codespell
        name: Check spelling
        args: [--write-changes]
```

### 37.3 What Each Hook Catches

| Hook | Catches | Severity if Failed |
|------|---------|--------------------|
| **trailing-whitespace** | Whitespace at end of lines | Low — noisy diffs |
| **end-of-file-fixer** | Missing newline at EOF | Low — POSIX compliance |
| **check-yaml/json/toml** | Malformed config files | HIGH — breaks deployments |
| **check-added-large-files** | Accidental large binary commits | HIGH — bloats repo |
| **detect-private-key** | Committed SSH/PGP keys | CRITICAL — security incident |
| **detect-aws-credentials** | Committed AWS keys | CRITICAL — security incident |
| **check-merge-conflict** | Unresolved `<<<<<<<` markers | HIGH — breaks builds |
| **ruff** | Lint violations | HIGH — code quality |
| **ruff-format** | Format violations | Medium — consistency |
| **mypy** | Type errors | HIGH — runtime bugs |
| **bandit** | Security anti-patterns | HIGH — vulnerabilities |
| **detect-secrets** | Any hardcoded secret | CRITICAL — data breach |

### 37.4 Enforcement Policy

- **Pre-commit hooks run on EVERY commit.** If a hook fails, the commit is blocked.
- **CI runs the same hooks** on every push to verify hooks were not skipped.
- **Skipping hooks requires:**
  - Explicit user approval
  - A documented reason in the commit message body (`--no-verify: reason`)
  - The CI will still fail if hooks would have caught the issue
- **Never commit `.pre-commit-config.yaml` changes** that remove hooks without project maintainer approval

### 37.5 CI Verification

```yaml
# In ci.yml, add a pre-commit verification step:
- name: Run pre-commit
  run: pre-commit run --all-files --show-diff-on-failure
```

This catches cases where a developer skipped hooks locally.

### 37.6 Detect-Secrets Baseline

```bash
# Generate initial baseline (existing secrets are whitelisted)
detect-secrets scan > .secrets.baseline

# Audit the baseline to ensure no real secrets were whitelisted
detect-secrets audit .secrets.baseline

# Commit the baseline so future scans catch NEW secrets only
git add .secrets.baseline
```

---

## 38. CI/CD Pipeline Standards

**Section 36.4a is in effect:** do not create any of the GitHub Actions workflows in this section without explicit, per-workflow user approval. The templates below are reference material — present them as a recommendation when the user asks for CI, but wait for approval before writing the file.

The pre-commit hook (Section 37) and the audit script (`tests/test_agents_md_quality.py`) run locally and need no GitHub-side automation.

### 38.1 CI Pipeline — `.github/workflows/ci.yml`

Runs on every push to any branch and every PR to main.

```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main, master]

jobs:
  lint-and-typecheck:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ['3.11', '3.12']
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/setup-python@0b93645e9fea7318ecaed2b359559ac225c90a2b # v5.3.0
        with:
          python-version: ${{ matrix.python-version }}
      - name: Install dependencies
        run: pip install ruff mypy
      - name: Ruff lint
        run: ruff check .
      - name: Ruff format check
        run: ruff format --check .
      - name: Mypy type check
        run: mypy . --ignore-missing-imports

  test:
    name: Tests (Python ${{ matrix.python-version }})
    runs-on: ubuntu-latest
    needs: lint-and-typecheck
    strategy:
      matrix:
        python-version: ['3.11', '3.12']
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: test_db
          POSTGRES_USER: test_user
          POSTGRES_PASSWORD: test_pass
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/setup-python@0b93645e9fea7318ecaed2b359559ac225c90a2b # v5.3.0
        with:
          python-version: ${{ matrix.python-version }}
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest pytest-cov pytest-asyncio
      - name: Run tests
        run: pytest --cov=. --cov-fail-under=80 --cov-report=xml --cov-report=term-missing --junitxml=test-results.xml
        env:
          DATABASE_URL: postgresql://test_user:test_pass@localhost:5432/test_db
          REDIS_URL: redis://localhost:6379/0
      - name: Upload coverage to Codecov
        if: success() || failure()
        uses: codecov/codecov-action@b9fd7d16f6d7d1b1d2a1d8e5f6b3c4d9e0a1b2c3 # v4.6.0
        with:
          file: ./coverage.xml
          fail_ci_if_error: false

  build:
    name: Build (if applicable)
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - name: Build Docker image
        run: docker build -t app:${{ github.sha }} .
      - name: Verify image runs
        run: docker run --rm app:${{ github.sha }} python -c "print('OK')"

  pre-commit:
    name: Pre-commit hooks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/setup-python@0b93645e9fea7318ecaed2b359559ac225c90a2b # v5.3.0
        with:
          python-version: '3.12'
      - run: pip install pre-commit
      - run: pre-commit run --all-files --show-diff-on-failure
```

### 38.2 Release Pipeline — `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  release:
    name: Create Release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Extract changelog
        id: changelog
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          # Extract the section for this version from CHANGELOG.md
          CHANGES=$(awk "/## \[${VERSION}\]/{flag=1; next} /## \[/{flag=0} flag" CHANGELOG.md)
          echo "changes<<EOF" >> $GITHUB_OUTPUT
          echo "$CHANGES" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

      - name: Build artifacts
        run: |
          pip install build
          python -m build

      - name: Create GitHub Release
        uses: softprops/action-gh-release@c062e08bd53281541eafdbcacf16d7f6566b254f # v2.1.0
        with:
          body: ${{ steps.changelog.outputs.changes }}
          files: dist/*
          generate_release_notes: false
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 38.3 Deployment Pipeline — `.github/workflows/deploy.yml`

```yaml
name: Deploy

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

jobs:
  deploy-staging:
    name: Deploy to Staging
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Build and push Docker image
        run: |
          docker build -t registry.example.com/app:${GITHUB_SHA} .
          docker push registry.example.com/app:${GITHUB_SHA}

      - name: Deploy to staging
        run: |
          # Deploy command depends on infrastructure
          echo "Deploying ${GITHUB_SHA} to staging..."

      - name: Verify deployment
        run: |
          # Smoke test the deployed service
          sleep 10
          curl -f http://staging.example.com/health

      - name: Notify on failure
        if: failure()
        run: |
          echo "Deployment to staging failed for commit ${GITHUB_SHA}"

  deploy-production:
    name: Deploy to Production
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: echo "Production deployment requires manual approval"
      # Production deployments should be triggered manually or via release
```

### 38.4 GitHub Actions SHA-Pinning Convention

**CRITICAL:** All third-party GitHub Actions MUST be pinned to a full 40-character commit SHA:

```yaml
# CORRECT — pinned to SHA with version comment
uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

# WRONG — mutable tag, could be hijacked
uses: actions/checkout@v4
uses: actions/checkout@main
```

- **Exception:** GitHub-authored actions (`actions/*`, `github/*`) are exempt from SHA-pinning
- **Every third-party action** (community or vendor) MUST use full SHA
- **The version tag comment** (`# v4.2.2`) is REQUIRED for human readability and audit
- **Update SHAs** when upgrading action versions — never leave a stale SHA

### 38.5 PR and Issue Templates

Create these files in `.github/`:

**`.github/PULL_REQUEST_TEMPLATE.md`:**
```markdown
<!-- See AGENTS.md Section 35 for the full PR template -->

## Description
### What Changed
### Why
### How
### Testing
- [ ] Unit tests pass
- [ ] Integration tests pass

### Breaking Changes

## AI Agent Disclosure
### Agent Decision Log
### Areas Needing Human Review
### Agent Self-Check
- [ ] Code follows project conventions
- [ ] No dead code (vulture clean)
- [ ] No unused imports (ruff clean)
- [ ] Type check passes (mypy clean)
- [ ] Tests cover new behavior
- [ ] Change size is within limits (under 800 lines)
```

**`.github/ISSUE_TEMPLATE/bug_report.md`:**
```markdown
---
name: Bug Report
about: Report a bug or unexpected behavior
title: 'bug: '
labels: ['bug']
assignees: []
---

### Description
<Clear, concise description of the bug>

### Steps to Reproduce
1.
2.
3.

### Expected Behavior
<What should have happened>

### Actual Behavior
<What actually happened, including error messages>

### Environment
- OS:
- Python version:
- Project version:
```

### 38.6 Branch Protection Rules

Configure these in GitHub repository settings → Branches → Branch protection rules:

| Rule | Value | Rationale |
|------|-------|-----------|
| **Require PR before merging** | Enabled | No direct pushes to main |
| **Require approvals** | 1 minimum | At least one reviewer |
| **Dismiss stale reviews** | Enabled | Re-review after new commits |
| **Require status checks** | Enabled | CI must pass before merge |
| **Required checks** | lint, test, build, pre-commit | All CI jobs must pass |
| **Require branches to be up to date** | Enabled | Must merge main into branch first |
| **Require conversation resolution** | Enabled | All review threads resolved |
| **Require linear history** | Disabled (team preference) | Squash merges handle this |
| **Do not allow bypass** | Enabled for admins too | No one bypasses protection |

---

## 39. Semantic Versioning & Changelog

### 39.1 Semantic Versioning Rules

Follow [SemVer 2.0.0](https://semver.org/) strictly:

| Version Component | Increment When | Example |
|------------------|----------------|---------|
| **MAJOR** (`X.0.0`) | Incompatible API changes | Removing an endpoint, changing response format, changing behavior of existing API |
| **MINOR** (`0.X.0`) | Backward-compatible functionality | Adding a new endpoint, adding optional parameters, deprecating with warnings |
| **PATCH** (`0.0.X`) | Backward-compatible bug fixes | Fixing a calculation error, correcting a typo in output, performance improvements with no API change |

**What constitutes a "breaking change":**
- Removing an API endpoint
- Changing response field names or types
- Removing or renaming public functions/classes
- Changing the behavior of existing functionality (even if signature is the same)
- Changing default values that alter behavior
- Dropping support for a Python version
- Changing environment variable names

**What is NOT a breaking change:**
- Adding new API endpoints
- Adding optional parameters with defaults
- Adding new functions/classes
- Bug fixes that restore intended behavior
- Internal refactoring (no public API change)
- Documentation-only changes

### 39.2 Keep a Changelog Format

Use the [Keep a Changelog](https://keepachangelog.com/) format in `CHANGELOG.md`:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- New feature A
- New feature B

### Changed
- Modified behavior of X for better Y

### Deprecated
- Feature Z will be removed in v3.0.0

### Removed
- Removed deprecated feature W

### Fixed
- Bug where X would crash on Y input

### Security
- Fixed vulnerability in authentication flow

## [1.2.0] - 2026-06-15

### Added
- Pagination support for list endpoints
- Health check endpoint with per-subsystem status

## [1.1.0] - 2026-06-01

### Added
- User authentication system

### Fixed
- Race condition in token refresh (#42)

## [1.0.0] - 2026-05-15

### Added
- Initial release
```

**Rules:**
- **Every release MUST have a CHANGELOG entry** — no exceptions
- **Entries are grouped by type:** Added, Changed, Deprecated, Removed, Fixed, Security
- **Each entry describes the change** from the USER's perspective, not the developer's
- **The [Unreleased] section** is updated as changes are merged
- **On release**, [Unreleased] is moved to a versioned section with the release date
- **Do NOT** list every commit — summarize user-visible changes
- **Do NOT** include internal refactoring, dependency updates (unless they fix security issues), or tooling changes

### 39.3 Conventional Commits for Changelog Automation

Use [Conventional Commits](https://www.conventionalcommits.org/) format for all commit messages:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types and their CHANGELOG mapping:**

| Type | CHANGELOG Section | Example |
|------|------------------|---------|
| `feat:` | Added | `feat: add pagination to search endpoint` |
| `fix:` | Fixed | `fix: prevent race condition in token refresh` |
| `docs:` | (not in changelog) | `docs: update API documentation` |
| `style:` | (not in changelog) | `style: format with ruff` |
| `refactor:` | (not in changelog) | `refactor: extract validation logic` |
| `perf:` | Changed | `perf: improve query performance 3x` |
| `test:` | (not in changelog) | `test: add edge case tests for pagination` |
| `chore:` | (not in changelog) | `chore: update dependencies` |
| `ci:` | (not in changelog) | `ci: add coverage enforcement to CI` |

**Breaking changes:**
- Add `!` after the type: `feat!: remove deprecated v1 endpoint`
- Or add `BREAKING CHANGE:` in the footer:
  ```
  feat: migrate to v2 API

  BREAKING CHANGE: The /v1/ endpoints are no longer available.
  All clients must migrate to /v2/ before upgrading.
  ```

### 39.4 Git Tags

```bash
# Create an annotated tag (NOT lightweight)
git tag -a v1.2.3 -m "Release v1.2.3

### Added
- Pagination support for list endpoints
- Health check endpoint with per-subsystem status

### Fixed
- Race condition in token refresh (#42)
"

# Push tags to remote
git push origin v1.2.3

# Verify tag exists
git tag -l "v*"
```

### 39.5 Release Automation

Tools for automating releases:

| Tool | When to Use | Setup Complexity |
|------|-------------|-----------------|
| **release-please** (Google) | Monorepos, conventional commits, automated CHANGELOG | Medium |
| **semantic-release** | Node.js/JS projects with conventional commits | Low |
| **Manual + script** | Small projects, infrequent releases | Low |

**Minimum release process for any project:**
1. All changes merged to main via PR
2. CI passes on main
3. Update CHANGELOG.md (move [Unreleased] to versioned section)
4. Commit: `chore: release v1.2.3`
5. Tag: `git tag -a v1.2.3 -m "Release v1.2.3"`
6. Push: `git push origin main --tags`
7. Verify release appears in GitHub Releases

---

## 40. Code Coverage Enforcement

Coverage is a necessary but insufficient quality metric. It tells you what code is NOT tested, not whether the tests are good.

### 40.1 Coverage Thresholds — Hard Enforcement

| Scope | Threshold | Enforcement |
|-------|-----------|-------------|
| **Project overall** | 80% line coverage | CI fails if below (`--cov-fail-under=80`) |
| **Critical paths** | 95%+ | Auth, payment, data mutation — manual review required |
| **New code** | 90%+ | New functions should not reduce overall coverage |
| **Branch coverage** | 75%+ | Measures if both sides of every branch are tested |

### 40.2 CI Configuration

```yaml
# In ci.yml test job:
- name: Run tests with coverage
  run: |
    pytest \
      --cov=. \
      --cov-fail-under=80 \
      --cov-report=xml:coverage.xml \
      --cov-report=term-missing \
      --cov-report=html:coverage-html \
      --junitxml=test-results.xml \
      tests/
```

### 40.3 Coverage Configuration — `.coveragerc` or `pyproject.toml`

```toml
# pyproject.toml
[tool.coverage.run]
source = ["src"]
omit = [
    "*/tests/*",
    "*/migrations/*",
    "*/__init__.py",
    "src/main.py",               # Entrypoint, hard to unit test
    "src/core/config.py",        # Pure config, tested implicitly
]

[tool.coverage.report]
show_missing = true
skip_covered = false
fail_under = 80

[tool.coverage.html]
directory = "coverage-html"

# Lines to exclude from coverage
exclude_also = [
    "if TYPE_CHECKING:",
    "raise NotImplementedError",
    "class .*\\bProtocol\\):",
    "@(abc\\.)?abstractmethod",
    "pragma: no cover",
]
```

### 40.4 Excluding Code from Coverage

```python
# Use for code that genuinely cannot be tested:
def _debug_only_function():  # pragma: no cover
    """Used only during development debugging."""
    ...

# Use for platform-specific code:
if sys.platform == "win32":  # pragma: no cover
    def platform_specific():
        ...

# NEVER use 'no cover' to avoid writing tests
# NEVER use 'no cover' because "it's hard to test"
# ONLY use 'no cover' when testing is truly impossible (debug tools, platform guards)
```

### 40.5 Branch Coverage — Why It Matters

Line coverage is deceptive. This function has 100% line coverage but 50% branch coverage:

```python
def divide(a: int, b: int) -> float | None:
    if b == 0:                    # Branch: True or False
        return None               # Only tested with b=0
    return a / b                  # Only tested with b!=0
```

To get 100% branch coverage, you need tests for both `b == 0` and `b != 0`.

**Enable branch coverage:**
```bash
pytest --cov=. --cov-branch --cov-report=term-missing
```

### 40.6 What Coverage Cannot Tell You

Coverage does NOT measure:
- **Test quality** — A test with no assertions has 100% coverage but zero value
- **Edge case coverage** — Tests might call functions but not exercise boundary conditions
- **Integration correctness** — Unit tests with 100% coverage can still miss integration bugs
- **Behavioral correctness** — Covered code can still produce wrong results

**Therefore:** Coverage is a floor, not a ceiling. Meeting the threshold is the minimum. Good tests are the goal.

---

## 41. Observability Standards

Production systems require structured observability — you cannot debug what you cannot see.

### 41.1 Structured Logging

ALL logs in production MUST be structured JSON, not human-readable text.

```python
import json
import logging
from datetime import datetime, timezone
from typing import Any
import uuid

class JSONFormatter(logging.Formatter):
    """Format logs as structured JSON for machine processing."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }

        # Include trace context if available
        if hasattr(record, "trace_id"):
            log_entry["trace_id"] = record.trace_id
        if hasattr(record, "span_id"):
            log_entry["span_id"] = record.span_id
        if hasattr(record, "correlation_id"):
            log_entry["correlation_id"] = record.correlation_id

        # Include exception info if present
        if record.exc_info and record.exc_info[1]:
            log_entry["exception"] = {
                "type": type(record.exc_info[1]).__name__,
                "message": str(record.exc_info[1]),
            }

        # Include extra fields passed via log call
        if hasattr(record, "extra_fields"):
            log_entry.update(record.extra_fields)

        return json.dumps(log_entry)

# Setup
handler = logging.StreamHandler()
handler.setFormatter(JSONFormatter())
logging.getLogger().addHandler(handler)
```

**Log level usage:**
| Level | When to Use | Example |
|-------|-------------|---------|
| **DEBUG** | Per-request details, internal state transitions | "Cache hit for key abc123" |
| **INFO** | Business operations, lifecycle events | "Processed batch of 42 items in 1.2s" |
| **WARNING** | Recoverable issues, degraded state | "Retry 2/3 after timeout (123ms)" |
| **ERROR** | Failures that need investigation | "Failed to connect to database after 3 retries" |
| **CRITICAL** | System-level failures | "Out of disk space, cannot continue" |

### 41.2 Distributed Tracing with OpenTelemetry

Every service MUST propagate trace context across boundaries.

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

def setup_tracing(service_name: str, otlp_endpoint: str):
    """Initialize OpenTelemetry tracing for this service."""
    tracer_provider = TracerProvider()

    # Export to OTLP collector (Jaeger, Grafana Tempo, etc.)
    exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
    tracer_provider.add_span_processor(BatchSpanProcessor(exporter))

    # Set global tracer provider
    trace.set_tracer_provider(tracer_provider)

    # Auto-instrument libraries
    FastAPIInstrumentor().instrument()
    HTTPXClientInstrumentor().instrument()
    RedisInstrumentor().instrument()
    SQLAlchemyInstrumentor().instrument()

    return trace.get_tracer(service_name)

# Usage — create spans for custom operations
tracer = setup_tracing("my-service", "http://otel-collector:4317")

async def process_order(order_id: str):
    with tracer.start_as_current_span("process_order") as span:
        span.set_attribute("order.id", order_id)
        span.add_event("order.validated", {"items": 3})

        # Nested spans for sub-operations
        with tracer.start_as_current_span("charge_payment"):
            result = await charge(order_id)

        span.set_attribute("order.status", result.status)
        return result
```

### 41.3 Prometheus Metrics

Standard metrics every service MUST export:

```python
from prometheus_client import Counter, Histogram, Gauge, Info
from prometheus_client import generate_latest, REGISTRY

# REQUIRED metrics for any web service
REQUEST_COUNT = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"]
)

REQUEST_DURATION = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "endpoint"],
    buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)

REQUEST_IN_PROGRESS = Gauge(
    "http_requests_in_progress",
    "Currently in-flight HTTP requests"
)

ERROR_COUNT = Counter(
    "errors_total",
    "Total errors by type",
    ["error_type", "service"]
)

# Application-specific metrics
DB_QUERY_DURATION = Histogram(
    "db_query_duration_seconds",
    "Database query duration",
    ["operation", "table"]
)

CACHE_HIT_RATIO = Gauge(
    "cache_hit_ratio",
    "Cache hit ratio (0.0-1.0)"
)

TASK_QUEUE_SIZE = Gauge(
    "task_queue_size",
    "Number of tasks waiting in queue",
    ["queue_name"]
)

# Expose metrics endpoint
@app.get("/metrics")
async def metrics():
    return Response(
        content=generate_latest(REGISTRY),
        media_type="text/plain"
    )
```

### 41.4 Correlation IDs

Every request MUST carry a correlation ID through the entire system.

```python
from contextvars import ContextVar

correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="")

class CorrelationIDMiddleware(BaseHTTPMiddleware):
    """Extract or generate correlation ID for every request."""

    async def dispatch(self, request: Request, call_next):
        # Extract from header or generate new
        correlation_id = request.headers.get(
            "X-Correlation-ID",
            request.headers.get("X-Request-ID", str(uuid.uuid4()))
        )

        # Set in context var for this request
        correlation_id_var.set(correlation_id)

        # Propagate to downstream calls via context
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        return response
```

### 41.5 PII Redaction in Logs

NEVER log personally identifiable information. Implement automatic redaction:

```python
import re

PII_PATTERNS = [
    (r'\b[\w\.-]+@[\w\.-]+\.\w{2,}\b', '[EMAIL]'),              # Email
    (r'\b\d{3}-\d{2}-\d{4}\b', '[SSN]'),                        # SSN
    (r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b', '[CC]'),   # Credit card
    (r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', '[IP]'),       # IP (in user content)
    (r'Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*', 'Bearer [TOKEN]'),   # Auth tokens
    (r'api[_-]?key[=:]\s*[A-Za-z0-9]+', 'api_key=[REDACTED]'),  # API keys in params
]

def sanitize_for_logging(value: str) -> str:
    """Redact PII before logging."""
    for pattern, replacement in PII_PATTERNS:
        value = re.sub(pattern, replacement, value, flags=re.IGNORECASE)
    return value

# Usage
logger.info("User input: %s", sanitize_for_logging(user_input))
```

### 41.6 Service Level Objectives (SLOs)

Define and monitor these for every production service:

| SLO | Target | Measurement |
|-----|--------|-------------|
| **Availability** | 99.9% | Successful requests / total requests |
| **Latency (p50)** | < 50ms | Median response time |
| **Latency (p95)** | < 200ms | 95th percentile response time |
| **Latency (p99)** | < 500ms | 99th percentile response time |
| **Error rate** | < 0.1% | Error responses / total responses |
| **Error budget burn rate** | < 1x | Rate of consuming error budget |

**Error budget:** If SLO is 99.9% availability, the error budget is 0.1%. This is ~43 minutes of allowed downtime per month. Track consumption.

---

## 42. Infrastructure as Code

Infrastructure must be defined in code, not configured manually through a web console. Every project that deploys to cloud infrastructure requires IaC.

### 42.1 Tool Selection

| Tool | Language | When to Use |
|------|----------|-------------|
| **Terraform** | HCL | Enterprise, multi-cloud, large teams, existing HCL ecosystem |
| **OpenTofu** | HCL | Terraform-compatible, open-source fork (preferred for new projects) |
| **Pulumi** | TypeScript/Python/Go | Developer-friendly, type-safe, application teams |
| **Crossplane** | YAML (K8s CRDs) | Kubernetes-native, GitOps control loops |

### 42.2 Terraform/OpenTofu Project Structure

```
terraform/
├── main.tf              # Provider configuration, remote state backend
├── variables.tf         # Input variables with types and descriptions
├── outputs.tf            # Output values (connection strings, endpoints, ARNs)
├── versions.tf           # Provider version constraints
├── terraform.tfvars      # Variable values (non-sensitive)
├── network.tf            # VPC, subnets, security groups, NAT gateways
├── compute.tf            # Compute instances, Kubernetes cluster, load balancers
├── database.tf           # RDS/Cloud SQL, backups, parameter groups
├── cache.tf              # Redis/ElastiCache configuration
├── secrets.tf            # Secrets Manager / Vault references
├── monitoring.tf         # Alerts, dashboards, log groups
├── iam.tf                # Service accounts, roles, policies
└── environments/
    ├── dev.tfvars
    ├── staging.tfvars
    └── prod.tfvars
```

### 42.3 Core Configuration Template

**`versions.tf`:**
```hcl
terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {
    bucket         = "mycompany-terraform-state"
    key            = "myproject/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}
```

**`variables.tf`:**
```hcl
variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "instance_count" {
  description = "Number of compute instances"
  type        = number
  default     = 3
}

variable "database_password" {
  description = "Master database password"
  type        = string
  sensitive   = true
}

variable "enable_deletion_protection" {
  description = "Prevent accidental deletion of resources"
  type        = bool
  default     = true
}
```

**`outputs.tf`:**
```hcl
output "database_endpoint" {
  description = "Database connection endpoint"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "load_balancer_dns" {
  description = "Load balancer DNS name"
  value       = aws_lb.main.dns_name
}

output "service_url" {
  description = "Public URL of the deployed service"
  value       = "https://${var.environment}.example.com"
}
```

### 42.4 Multi-Environment Pattern

```bash
# Initialize (one-time per environment)
terraform init -backend-config="environments/dev.backend.tfvars"

# Plan changes
terraform plan -var-file="environments/dev.tfvars" -out=dev.plan

# Apply changes
terraform apply dev.plan

# Destroy (caution!) — only for ephemeral environments
terraform destroy -var-file="environments/dev.tfvars"
```

### 42.5 State Management Rules

| Rule | Detail |
|------|--------|
| **Remote state REQUIRED** | Never store state locally — use S3, GCS, Azure Blob, or Terraform Cloud |
| **State locking REQUIRED** | Use DynamoDB (AWS), Cloud Storage lock (GCP), or equivalent |
| **Never edit state manually** | Use `terraform state mv/rm/import` commands only |
| **State encryption at rest** | Enable server-side encryption on state bucket |
| **State backup** | Enable versioning on state bucket, retain at least 30 days |
| **Workspace per environment** | Separate state per environment (dev/staging/prod) — never share state |

### 42.6 Pre-Deploy Checklist

Before `terraform apply`:
- [ ] `terraform fmt --recursive` passes (standardized formatting)
- [ ] `terraform validate` passes (syntax and reference validation)
- [ ] `terraform plan` reviewed — no unexpected destroy/replace operations
- [ ] Sensitive outputs are marked `sensitive = true`
- [ ] Deletion protection is enabled on stateful resources (databases, storage)
- [ ] Terraform plan output is saved to version control for audit

---

## 43. Database Backup & Recovery

Data loss is a resume-generating event. Every project with persistent data MUST implement backup and recovery.

### 43.1 Backup Schedule

| Frequency | Retention | Purpose |
|-----------|-----------|---------|
| **Daily** | 7 days | Point-in-time recovery for recent mistakes |
| **Weekly** | 4 weeks | Extended recovery window for delayed-discovered issues |
| **Monthly** | 12 months | Long-term compliance and audit requirements |

This is the **Grandfather-Father-Son** retention pattern.

### 43.2 PostgreSQL Backup Implementation

```python
import subprocess
import gzip
import shutil
from datetime import datetime, timedelta
from pathlib import Path

class DatabaseBackup:
    def __init__(
        self,
        db_url: str,
        backup_dir: Path,
        retention_daily: int = 7,
        retention_weekly: int = 4,
        retention_monthly: int = 12
    ):
        self.db_url = db_url
        self.backup_dir = backup_dir
        self.retention_daily = retention_daily
        self.retention_weekly = retention_weekly
        self.retention_monthly = retention_monthly

    def create_backup(self) -> Path:
        """Create a compressed backup of the database."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        sql_path = self.backup_dir / f"backup_{timestamp}.sql"
        gz_path = self.backup_dir / f"backup_{timestamp}.sql.gz"

        try:
            # Dump database
            subprocess.run(
                ["pg_dump", self.db_url, "-f", str(sql_path)],
                check=True,
                capture_output=True,
                timeout=3600  # 1 hour timeout for large databases
            )

            # Compress
            with open(sql_path, "rb") as f_in:
                with gzip.open(gz_path, "wb") as f_out:
                    shutil.copyfileobj(f_in, f_out)

            # Remove uncompressed
            sql_path.unlink()

            return gz_path

        except subprocess.TimeoutExpired:
            sql_path.unlink(missing_ok=True)
            raise RuntimeError("Backup timed out after 1 hour")
        except Exception:
            sql_path.unlink(missing_ok=True)
            gz_path.unlink(missing_ok=True)
            raise

    def rotate_backups(self):
        """Apply retention policy — delete expired backups."""
        backups = sorted(self.backup_dir.glob("backup_*.sql.gz"))

        now = datetime.now()
        kept_daily = []
        kept_weekly = []
        kept_monthly = []

        for backup_path in backups:
            try:
                backup_date = datetime.strptime(
                    backup_path.name, "backup_%Y%m%d_%H%M%S.sql.gz"
                )
            except ValueError:
                continue

            age_days = (now - backup_date).days

            if age_days <= self.retention_daily:
                kept_daily.append(backup_path)
                continue

            if age_days <= self.retention_weekly * 7:
                # Keep one per week (Monday)
                if backup_date.weekday() == 0:
                    kept_weekly.append(backup_path)
                    continue

            if age_days <= self.retention_monthly * 30:
                # Keep one per month (1st of month)
                if backup_date.day == 1:
                    kept_monthly.append(backup_path)
                    continue

            # Expired — delete
            backup_path.unlink()

    def list_backups(self) -> list[dict]:
        """List available backups with metadata."""
        backups = sorted(self.backup_dir.glob("backup_*.sql.gz"), reverse=True)
        return [
            {
                "filename": p.name,
                "size_bytes": p.stat().st_size,
                "size_mb": round(p.stat().st_size / (1024 * 1024), 2),
                "timestamp": datetime.strptime(
                    p.name, "backup_%Y%m%d_%H%M%S.sql.gz"
                ).isoformat()
            }
            for p in backups
        ]
```

### 43.3 Restore Procedure

```bash
# 1. Stop application (prevent writes during restore)
docker compose stop app

# 2. Drop existing database (CAUTION — data loss)
docker compose exec postgres dropdb -U postgres mydb

# 3. Create fresh database
docker compose exec postgres createdb -U postgres mydb

# 4. Restore from backup
gunzip -c /backups/backup_20260615_120000.sql.gz | \
    docker compose exec -T postgres psql -U postgres mydb

# 5. Start application
docker compose start app

# 6. Verify restore
curl -f http://localhost:8000/health
```

### 43.4 Backup Verification

Automated restore test — validates backup integrity:

```python
def verify_backup(backup_path: Path, test_db_url: str) -> bool:
    """Restore backup to ephemeral test database and verify."""
    try:
        # Restore to test database
        subprocess.run(
            f"gunzip -c {backup_path} | psql {test_db_url}",
            shell=True, check=True, capture_output=True, timeout=600
        )

        # Verify critical tables exist and have data
        result = subprocess.run(
            f"psql {test_db_url} -c \"SELECT count(*) FROM information_schema.tables WHERE table_schema='public'\"",
            shell=True, check=True, capture_output=True, text=True
        )

        table_count = int(result.stdout.strip().split('\n')[-2].strip())
        return table_count > 0

    except Exception as e:
        logger.error("Backup verification failed for %s: %s", backup_path.name, e)
        return False
    finally:
        # Clean up test database
        subprocess.run(
            f"psql {test_db_url} -c \"DROP SCHEMA public CASCADE; CREATE SCHEMA public\"",
            shell=True, capture_output=True
        )
```

### 43.5 Backup Monitoring

Alert if:
- **Backup failed** — No successful backup in past 25 hours
- **Backup size anomaly** — Today's backup is <50% or >200% of average
- **Verification failed** — Latest backup failed verification test
- **Off-site sync failed** — S3/GCS replication error
- **Retention violation** — More backups than configured retention policy allows

### 43.6 Off-Site Backup Replication

```bash
# Sync backups to S3 (run after each backup)
aws s3 sync /var/backups/ s3://mycompany-backups/myproject/ \
    --storage-class STANDARD_IA \
    --sse AES256

# Verify sync
aws s3 ls s3://mycompany-backups/myproject/ --recursive | wc -l
```

---

## 44. Secrets Management

Secrets in code is the #2 cause of security incidents (after phishing). Every project MUST use a tiered secrets strategy.

### 44.1 Tiered Secrets Strategy

| Tier | Tool | When to Use | Security Level |
|------|------|-------------|----------------|
| **Local Development** | `.env` files (never committed) | Individual developers | Low — single developer |
| **Team Development** | Doppler / 1Password CLI | Small teams, shared secrets | Medium — access controlled |
| **CI/CD** | GitHub Secrets / GitLab CI Variables | Build pipeline secrets | Medium — scoped to repo |
| **GitOps** | SOPS + Age/PGP | Encrypted secrets in git, decrypted at deploy | High — encrypted at rest |
| **Cloud-Native** | AWS Secrets Manager / Azure Key Vault / GCP Secret Manager | Cloud provider managed, IAM-integrated | High — managed rotation |
| **Enterprise** | HashiCorp Vault | Dynamic secrets, leasing, audit logging, PKI | Highest — full audit trail |

### 44.2 SOPS + Age Encryption (GitOps Pattern)

```bash
# Install SOPS and age
brew install sops age

# Generate age key
age-keygen -o ~/.config/sops/age/keys.txt

# Create .sops.yaml configuration
cat > .sops.yaml << 'EOF'
creation_rules:
  - path_regex: secrets/dev\.yaml$
    age: >-
      age1abc123...
  - path_regex: secrets/prod\.yaml$
    age: >-
      age1xyz789...
EOF

# Encrypt secrets file
sops --encrypt secrets.yaml > secrets.enc.yaml

# Edit encrypted file
sops secrets.enc.yaml

# Decrypt at deploy time
sops --decrypt secrets.enc.yaml > secrets.yaml
```

### 44.3 Secrets That MUST Be Managed

| Secret Type | Storage | Rotation | Justification |
|------------|---------|----------|---------------|
| **Database passwords** | Vault / Secrets Manager | 90 days | Primary data access |
| **API keys (third-party)** | Vault / Secrets Manager | 90 days | External service access |
| **Encryption keys** | Vault / KMS | 365 days | Data encryption at rest |
| **JWT signing secrets** | Vault / Secrets Manager | 90 days | Auth token integrity |
| **TLS certificates** | Cert Manager / ACM | Auto-renew | HTTPS termination |
| **OAuth client secrets** | Vault / Secrets Manager | 180 days | Third-party auth |
| **Webhook secrets** | Vault / Secrets Manager | 90 days | Inbound verification |
| **CI/CD deploy tokens** | GitHub Secrets / Vault | 90 days | Deployment pipeline |

### 44.4 Secret Rotation Pattern

```python
from cryptography.fernet import Fernet
from datetime import datetime, timedelta
import base64

class SecretRotator:
    def __init__(self, vault_client, key_path: str, rotation_days: int = 90):
        self.vault = vault_client
        self.key_path = key_path
        self.rotation_days = rotation_days

    def needs_rotation(self) -> bool:
        """Check if secret is due for rotation."""
        metadata = self.vault.read_metadata(self.key_path)
        created = datetime.fromisoformat(metadata["created_time"])
        age_days = (datetime.now() - created).days
        return age_days >= self.rotation_days

    def rotate(self) -> None:
        """Rotate a secret with zero-downtime dual-key window."""
        # 1. Generate new secret
        new_key = base64.urlsafe_b64encode(Fernet.generate_key()).decode()
        old_key = self.vault.read_secret(self.key_path)["value"]

        # 2. Store new key alongside old (dual-key window)
        self.vault.write_secret(f"{self.key_path}_new", {"value": new_key})

        # 3. Deploy new key to all services
        self._deploy_key(new_key)

        # 4. Promote new key to primary
        self.vault.write_secret(self.key_path, {"value": new_key, "previous": old_key})

        # 5. Remove temporary key
        self.vault.delete_secret(f"{self.key_path}_new")

        # 6. Monitor for old-key failures (grace period)
        # After grace period, old key is no longer valid

    def _deploy_key(self, key: str) -> None:
        """Deploy new key to all services."""
        # Trigger config reload on all instances
        # Implementation depends on deployment architecture
        pass
```

### 44.5 Secret Scanning in CI

```yaml
# Add to ci.yml
- name: Scan for secrets
  uses: gitleaks/gitleaks-action@v2
  with:
    config-path: .gitleaks.toml
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# Or with truffleHog
- name: Scan for secrets
  run: |
    pip install trufflehog3
    trufflehog3 --format json --output trufflehog-report.json .
```

### 44.6 Secrets Management Rules

- **NEVER** commit secrets to git — enforced by pre-commit `detect-secrets` and CI scanning
- **NEVER** share secrets via email, Slack, or any unencrypted channel
- **NEVER** hardcode secrets in Docker images — use runtime injection
- **NEVER** log secrets — implement PII redaction (Section 41.5)
- **ALWAYS** use a secrets manager (not `.env` files) for production
- **ALWAYS** rotate secrets on a schedule — automate rotation
- **ALWAYS** use least privilege — each service gets only the secrets it needs
- **ALWAYS** use ephemeral credentials when possible (Vault dynamic secrets, OIDC tokens)
- **ALWAYS** audit secret access — who accessed, when, from where
- **NEVER** reuse secrets across environments — dev and prod must have different credentials

---

## 45. Flaky Test Management

Flaky tests (tests that pass and fail intermittently without code changes) erode trust in the test suite. They are a top cause of CI burnout and deployment delays.

### 45.1 Four Sources of Flakiness (Google Classification)

| Source | Example | Frequency |
|--------|---------|-----------|
| **The tests themselves** | Improper initialization, ordering dependencies, race conditions in test code | Most common |
| **The test framework** | Resource allocation errors, scheduling collisions, test runner bugs | Uncommon |
| **The application (SUT)** | Slow responses, memory leaks, genuine non-determinism | Common |
| **OS/hardware/network** | Network instability, disk errors, CI resource exhaustion | Common in CI |

### 45.2 Flaky Test Detection

```ini
# pytest.ini
[pytest]
# Re-run failed tests to detect flakiness
addopts =
    --reruns 2
    --reruns-delay 1
    --only-rerun "AssertionError"
    --only-rerun "TimeoutError"
```

```bash
# Install rerun plugin
pip install pytest-rerunfailures

# Run tests with retry (detects flaky tests)
pytest --reruns 3 --reruns-delay 1

# Create a report of flaky tests
pytest --reruns 3 --rerun-flaky-report=flaky_report.json
```

### 45.3 Quarantine Mechanism

When a flaky test is discovered, quarantine it immediately — do NOT delete it:

```python
import pytest

@pytest.mark.flaky(reason="Intermittent timeout in CI, ticket #1234")
def test_thing_that_flakes():
    """This test is quarantined — it does NOT block CI but IS tracked."""
    result = do_something()
    assert result is not None
```

```ini
# pytest.ini — exclude quarantined tests from CI
[pytest]
markers =
    flaky: Test is known to be flaky (see ticket for details)
```

**Quarantine process:**
1. **Detect** — Identify flaky test from CI failures
2. **Quarantine** — Add `@pytest.mark.flaky` marker with reason and ticket reference
3. **Track** — Create an issue to fix the flaky test within 7 days
4. **Fix** — Root-cause the flakiness (not just re-run)
5. **Unquarantine** — Remove the marker after the fix is verified stable for 10+ CI runs

### 45.4 Remediation Strategies

| Problem | Wrong Fix | Right Fix |
|---------|-----------|-----------|
| **Ordering dependency** | Renumber tests to run in order | Make each test create its own fixtures, use `@pytest.fixture(autouse=False)` |
| **Shared mutable state** | Add `time.sleep(1)` between tests | Reset state in fixture teardown, isolate test data by test |
| **Time-dependent tests** | Use wide time tolerances (e.g., ±5s) | Freeze time with `freezegun` or inject a clock |
| **External dependency flaky** | Skip test if external service is down | Mock external services, add contract tests for actual integration |
| **Race condition in app** | Increase test timeout | Fix the race condition (add proper synchronization) |
| **CI resource contention** | Run tests sequentially | Profile test resource usage, add resource requests/limits |

### 45.5 NEVER Do These for Flaky Tests

- **NEVER** delete a failing or flaky test without understanding why it failed — quarantine it first (Section 45.3), then root-cause within 7 days
- **NEVER** add `time.sleep()` to a test — fix the synchronization, don't paper over it
- **NEVER** increase a timeout arbitrarily — understand why it's slow
- **NEVER** mark a test as "known flaky" without creating a fix ticket — quarantine expires
- **NEVER** skip a flaky test without a documented reason
- **NEVER** allow flaky tests to accumulate — fix them within SLA (7 days)

### 45.6 Test Isolation Principles

Every test must be:
- **Independent** — Can run in any order, in parallel, or alone
- **Self-contained** — Creates its own fixtures, doesn't depend on prior test state
- **Deterministic** — Same inputs produce same outputs every run
- **Hermetic** — No external dependencies (network, database, filesystem) unless explicitly an integration test
- **Fast** — Unit tests < 1s each, integration tests < 10s each

```python
# CORRECT — isolated test
@pytest.fixture
def fresh_user():
    """Each test gets its own user — no shared state."""
    return User(name="Test User", email="test@example.com")

def test_user_creation(fresh_user):
    assert fresh_user.name == "Test User"

def test_user_email_update(fresh_user):
    fresh_user.email = "updated@example.com"
    assert fresh_user.email == "updated@example.com"
    # Does NOT affect test_user_creation — they get different fixtures

# WRONG — interdependent tests
created_user_id = None

def test_create_user():
    global created_user_id
    user = create_user("Alice")
    created_user_id = user.id
    assert user.id is not None

def test_update_user():
    # DEPENDS on test_create_user running first — will fail if run alone
    update_user(created_user_id, name="Bob")
```

---

## 46. Mutation Testing

Line/branch coverage tells you what code EXECUTES — mutation testing tells you what code is actually TESTED (tested meaning: tests fail when code behavior changes).

### 46.1 What Mutation Testing Does

Mutation testing introduces small bugs ("mutants") into your code and checks if your tests catch them:

```python
# Original code
def is_adult(age: int) -> bool:
    return age >= 18

# Mutant 1: Relational operator replacement
def is_adult(age: int) -> bool:
    return age > 18  # Changed >= to > — test should catch this

# Mutant 2: Constant replacement
def is_adult(age: int) -> bool:
    return age >= 0  # Changed 18 to 0 — test should catch this

# Mutant 3: Statement deletion
def is_adult(age: int) -> bool:
    pass  # Entire body removed — test should catch this
```

If your tests PASS for any mutant, that mutant "survived" — meaning the code is not properly tested. The goal is to kill >95% of mutants.

### 46.2 Setup with mutmut

```bash
# Install mutmut
pip install mutmut

# Run mutation testing
mutmut run --paths-to-mutate=src/

# Show results
mutmut results

# Show surviving mutants
mutmut show

# Apply surviving mutants to source (for inspection)
mutmut apply <mutant_id>
```

### 46.3 CI Integration

```yaml
# In CI — run on main branch or weekly
mutation-test:
  name: Mutation Testing
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/main'
  strategy:
    matrix:
      python-version: ['3.12']
  steps:
    - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
    - uses: actions/setup-python@0b93645e9fea7318ecaed2b359559ac225c90a2b # v5.3.0
      with:
        python-version: ${{ matrix.python-version }}
    - run: pip install -r requirements.txt mutmut
    - name: Run mutation tests
      run: |
        mutmut run --paths-to-mutate=src/ || true
        mutmut results
    - name: Check mutation score
      run: |
        # Parse mutmut results and fail if below threshold
        SCORE=$(mutmut results | grep "Killed" | awk '{print $2}')
        if [ "$SCORE" -lt 850 ]; then  # 85% kill rate
          echo "Mutation score too low: ${SCORE}/1000"
          exit 1
        fi
```

### 46.4 Arid Node Configuration

Not all code benefits from mutation testing. Configure mutmut to skip "arid nodes" — AST nodes where mutants are unproductive:

**.mutmut-cache or pyproject.toml:**
```toml
[tool.mutmut]
paths_to_mutate = ["src"]
backup = false
runner = "python -m pytest"

[tool.mutmut.exclude]
# Skip these — mutants here don't produce useful signals
functions = [
    "__repr__",
    "__str__",
    "__init__",
    "log_*",
    "_log_*",
]

paths = [
    "*/tests/*",
    "*/migrations/*",
    "src/core/logging.py",
    "src/core/config.py",
]
```

### 46.5 Arid Node Types to Skip

| Node Type | Why Skip | Example |
|-----------|----------|---------|
| **Logging statements** | Changing log messages doesn't affect behavior | `logger.info("Processing %s", id)` |
| **Error messages** | Changing error text doesn't change logic | `raise ValueError("Invalid input")` |
| **Tuning parameters** | Changing a constant without domain knowledge is noise | `TIMEOUT = 30` |
| **Mocked dependencies** | Mutating mock setup tests the mock, not the code | `mock_db.save.return_value = True` |
| **Idiomatic patterns** | Language idioms where any change is always a bug | `if items is None: items = []` |
| **Debug-only code** | Code that only runs in development | `if DEBUG: show_debug_panel()` |

### 46.6 Mutation Score Interpretation

| Score | Meaning | Action |
|-------|---------|--------|
| **90%+** | Excellent — tests are catching behavior changes | Maintain |
| **80-90%** | Good — some gaps, investigate survivors | Add tests for survivors |
| **70-80%** | Fair — significant untested behavior | Prioritize gap closure |
| **<70%** | Poor — tests are mostly worthless | Major test overhaul needed |

### 46.7 Targeting Mutation Testing

Don't mutation test the entire codebase every time. Target:

1. **Changed code** — Only mutation test files modified in the current PR
2. **Critical paths** — Auth, payment, data mutation — always mutation test
3. **New code** — 100% mutation score required for new functions
4. **Legacy code** — Mutation test incrementally as you refactor

```bash
# Mutation test only changed files
git diff --name-only HEAD~1 | grep '\.py$' | grep -v tests/ | xargs mutmut run
```

---

## 47. Performance Benchmark Testing

Performance regressions are bugs. They should be caught in CI, not in production by users complaining about slowness.

### 47.1 Setup with pytest-benchmark

```bash
pip install pytest-benchmark
```

```python
# tests/benchmarks/test_performance.py
import pytest

def test_model_scoring_benchmark(benchmark):
    """Scoring 1000 items must complete under 50ms."""
    items = generate_test_items(1000)

    result = benchmark(scoring_function, items)

    assert result is not None

def test_db_query_benchmark(benchmark, db_session):
    """List query with 10k rows must complete under 100ms."""
    # Populate test data
    for i in range(10_000):
        db_session.add(Item(name=f"item_{i}"))
    db_session.commit()

    result = benchmark(
        lambda: db_session.query(Item).filter(Item.name.like("item_99%")).all()
    )

    assert len(result) > 0

def test_api_endpoint_benchmark(benchmark, client):
    """GET /api/items must complete under 30ms p95."""
    response = benchmark(client.get, "/api/items?limit=50")
    assert response.status_code == 200
```

### 47.2 Time Budget Assertions

```python
def test_critical_path_with_time_budget(benchmark):
    """Critical path operations have hard time budgets."""
    budget_ms = {
        "validate_token": 5,
        "check_permission": 10,
        "fetch_user": 20,
        "serialize_response": 5,
    }

    for operation, max_ms in budget_ms.items():
        fn = get_operation(operation)
        benchmark.name = f"time_budget_{operation}"

        result = benchmark(fn, test_input())

        # Assert median time is within budget
        stats = benchmark.stats
        assert stats.stats.median < max_ms / 1000.0, \
            f"{operation}: median {stats.stats.median*1000:.1f}ms exceeds budget {max_ms}ms"
```

### 47.3 CI Integration

```yaml
# Performance regression detection in CI
benchmark:
  name: Performance Benchmarks
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

    - name: Run benchmarks
      run: |
        pytest tests/benchmarks/ \
          --benchmark-only \
          --benchmark-json=benchmark_results.json \
          --benchmark-autosave

    - name: Compare against baseline
      run: |
        pytest-benchmark compare HEAD~1 HEAD --group-by=name

    - name: Fail on regression
      run: |
        # Parse results and fail if any benchmark regressed >10%
        python scripts/check_benchmark_regression.py benchmark_results.json

    - name: Store benchmark results
      uses: benchmark-action/github-action-benchmark@v1
      with:
        tool: pytest
        output-file-path: benchmark_results.json
        alert-threshold: 120%  # Alert if >20% regression
        comment-on-alert: true
        fail-on-alert: true
        auto-push: false
```

### 47.4 What to Benchmark

| Category | What to Measure | Target |
|----------|----------------|--------|
| **API endpoints** | Response time p50, p95, p99 | <50ms p95 for reads, <200ms p95 for writes |
| **Database queries** | Query execution time | <20ms for simple queries, <100ms for joins |
| **Serialization** | JSON parse + serialize | <5ms for typical payload |
| **Authentication** | Token validation | <10ms |
| **Cache operations** | Get/Set operations | <2ms |
| **Startup time** | Application boot to first request | <5s |
| **Memory usage** | RSS after warmup | <500MB baseline |

### 47.5 NEVER Do These for Benchmarks

- **NEVER** run benchmarks on oversubscribed CI runners — use dedicated runners or control for noise
- **NEVER** compare benchmarks across different machines — always use same hardware
- **NEVER** accept a 20%+ regression without investigation
- **NEVER** benchmark with unrealistic data volumes — test with production-scale data
- **NEVER** benchmark only happy paths — measure worst-case performance too
- **NEVER** skip benchmarking "because the change is small" — small changes cause big regressions

---

## 48. Contract Testing (Pact)

Contract tests verify that service boundaries are respected — that providers meet consumer expectations and consumers don't depend on undocumented behavior.

### 48.1 Consumer-Driven Contract Testing

A **consumer** defines what it expects from a **provider**. The provider verifies it meets all consumers' expectations.

```
Consumer A (Web App) ──> expects GET /users/{id} returns {id, name, email}
Consumer B (Mobile)  ──> expects GET /users/{id} returns {id, name, email, avatar_url}
                          ↓
Provider (User API) ───── Must satisfy ALL consumer expectations
```

### 48.2 Setup with Pact (Python)

```bash
pip install pact-python
```

### 48.3 Consumer Test (Defines Expectations)

```python
# tests/contract/consumer/test_user_api_contract.py
import atexit
import pytest
from pact import Consumer, Provider

pact = Consumer("WebApp").has_pact_with(
    Provider("UserAPI"),
    host_name="localhost",
    port=1234,
    pact_dir="./pacts"
)

pact.start_service()
atexit.register(pact.stop_service)

def test_get_user(pact: Pact):
    """WebApp expects GET /users/{id} to return specific fields."""
    expected_response = {
        "id": 42,
        "name": "Alice Smith",
        "email": "alice@example.com"
    }

    (pact
     .given("a user with id 42 exists")
     .upon_receiving("a request for user 42")
     .with_request("GET", "/users/42")
     .will_respond_with(200, body=expected_response))

    with pact:
        result = UserAPIClient("http://localhost:1234").get_user(42)

    assert result.id == 42
    assert result.name == "Alice Smith"
    assert result.email == "alice@example.com"
    # Note: does NOT assert avatar_url — WebApp doesn't need it
```

### 48.4 Provider Verification (Satisfies Consumer Expectations)

```bash
# Run provider verification against running User API
pact-verifier \
  --provider-base-url=http://localhost:8000 \
  --pact-url=./pacts/WebApp-UserAPI.json \
  --provider-states-setup-url=http://localhost:8000/_pact/provider_states
```

```python
# Provider state setup endpoint
@app.post("/_pact/provider_states")
async def provider_states(request: ProviderStateRequest):
    """Set up test state for Pact verification."""
    if request.state == "a user with id 42 exists":
        db.add(User(id=42, name="Alice Smith", email="alice@example.com"))
        db.commit()
        return {"status": "ok"}
    raise ValueError(f"Unknown state: {request.state}")
```

### 48.5 Contract Testing in CI

```yaml
contract-test:
  name: Contract Tests
  runs-on: ubuntu-latest
  services:
    user-api:
      image: user-api:test
      ports:
        - 8000:8000
  steps:
    - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

    - name: Generate consumer contracts
      run: pytest tests/contract/consumer/ -k "consumer"

    - name: Verify provider against contracts
      run: |
        pact-verifier \
          --provider-base-url=http://localhost:8000 \
          --pact-dir=./pacts/ \
          --provider-states-setup-url=http://localhost:8000/_pact/provider_states

    - name: Publish contracts to Pact Broker
      run: |
        pact-broker publish ./pacts/ \
          --consumer-app-version=${{ github.sha }} \
          --broker-base-url=https://pact-broker.example.com \
          --broker-token=${{ secrets.PACT_BROKER_TOKEN }}

    - name: Check if safe to deploy (can-i-deploy)
      run: |
        pact-broker can-i-deploy \
          --pacticipant WebApp \
          --version=${{ github.sha }} \
          --to-environment production \
          --broker-base-url=https://pact-broker.example.com \
          --broker-token=${{ secrets.PACT_BROKER_TOKEN }}
```

### 48.6 What to Contract Test

| Contract Type | When to Use | Example |
|---------------|-------------|---------|
| **API responses** | Always | Verify response schema, fields, types |
| **Error responses** | Always | Verify error format, status codes |
| **HTTP headers** | Often | Content-Type, auth headers |
| **Query parameters** | When used | Filtering, pagination, sorting |
| **Event schemas** | For event-driven | Message format, required fields |
| **Async callbacks** | For webhooks | Callback URL, payload format |

### 48.7 Contract Versioning

```python
# In consumer test, include version
pact = Consumer("WebApp", version="1.2.3").has_pact_with(
    Provider("UserAPI"),
    pact_dir="./pacts"
)

# Pact Broker stores all versions, enables:
# - Backward compatibility checking
# - Can-I-Deploy checks
# - Dependency graph visualization
```

---

## 49. Chaos Engineering

Chaos engineering validates that systems behave correctly under failure conditions. It is NOT random destruction — it is controlled experimentation.

### 49.1 Principles (from Netflix Chaos Engineering)

1. **Define "steady state"** — Metrics that represent normal behavior
2. **Hypothesize** — Steady state will continue in both control and experimental groups
3. **Introduce variables** — Simulate real-world failures (server crashes, network latency, resource exhaustion)
4. **Disprove hypothesis** — Look for deviations from steady state
5. **Minimize blast radius** — Start small, expand gradually

### 49.2 Experiment Design Template

Every chaos experiment MUST follow this template:

```yaml
experiment:
  name: Database Connection Failure
  hypothesis: >
    When the primary database becomes unreachable for 30 seconds,
    the application will serve stale data from cache and reconnect
    automatically within 5 seconds of database recovery.
  steady_state_metrics:
    - p95_latency_ms < 200
    - error_rate < 0.01
    - cache_hit_ratio > 0.50
  method:
    - type: network_partition
      target: database
      duration_seconds: 30
  blast_radius:
    - environment: staging
    - affected_services: [api]
    - unaffected_services: [background_worker]
  rollback:
    trigger: error_rate > 0.10 OR p95_latency_ms > 1000 OR duration > 120
    action: restore_network
  success_criteria:
    - error_rate stayed below 0.05
    - p95_latency_ms stayed below 500
    - No data corruption detected
    - Application reconnected within 5s of database recovery
```

### 49.3 Failure Injection Patterns

```python
import asyncio
import random
from contextlib import asynccontextmanager
from typing import Callable, Awaitable

class FailureInjector:
    """Inject controlled failures for chaos testing."""

    def __init__(self, enabled: bool = False):
        self.enabled = enabled

    @asynccontextmanager
    async def latency(self, min_ms: int = 50, max_ms: int = 500):
        """Inject random latency into an operation."""
        if self.enabled:
            delay = random.uniform(min_ms, max_ms) / 1000
            await asyncio.sleep(delay)
        yield

    async def maybe_fail(self, failure_rate: float = 0.1, error_type: type = Exception):
        """Fail with given probability."""
        if self.enabled and random.random() < failure_rate:
            raise error_type("Chaos monkey says no")

    async def maybe_timeout(self, timeout_rate: float = 0.1, duration_s: float = 30):
        """Timeout with given probability."""
        if self.enabled and random.random() < timeout_rate:
            await asyncio.sleep(duration_s)
            raise TimeoutError("Chaos timeout")

# Usage in production code (gated by config)
chaos = FailureInjector(enabled=config.CHAOS_ENGINEERING_ENABLED)

async def fetch_data_from_db(query: str):
    await chaos.maybe_fail(failure_rate=0.05, error_type=ConnectionError)
    async with chaos.latency(min_ms=10, max_ms=200):
        return await db.execute(query)
```

### 49.4 Chaos Experiment Library

| Experiment | What It Tests | How to Run |
|-----------|---------------|------------|
| **Kill a service** | Failover, health checks, graceful degradation | `docker compose stop <service>` |
| **Network latency** | Timeout handling, retry logic | `tc qdisc add dev eth0 root netem delay 500ms` |
| **Network partition** | Service isolation, split-brain prevention | `iptables -A INPUT -s <service_ip> -j DROP` |
| **CPU exhaustion** | Throttling, resource limits, priority scheduling | `stress --cpu 4 --timeout 60s` |
| **Memory exhaustion** | OOM handling, graceful degradation | `stress --vm 2 --vm-bytes 1G --timeout 60s` |
| **Disk full** | Error handling, cleanup, alerting | `dd if=/dev/zero of=/tmp/fill bs=1M count=1000` |
| **DNS failure** | Caching, fallback IPs | `iptables -A OUTPUT -p udp --dport 53 -j DROP` |
| **Dependency slow** | Circuit breaker, timeout configuration | Inject latency at proxy level |
| **Clock skew** | Time-based logic, token expiry | Change system clock by ±5 minutes |
| **Certificate expiry** | TLS handling, renewal automation | Use short-lived certs in staging |

### 49.5 Game Day Checklist

**Before game day:**
- [ ] All observability tooling is in place (logs, metrics, traces, alerts)
- [ ] Steady state metrics are defined and measurable
- [ ] Blast radius is minimized (start with staging, one service)
- [ ] Rollback plan is documented and tested
- [ ] Communication channel is established (Slack channel, incident bridge)
- [ ] All team members know the experiment is running

**During game day:**
- [ ] Announce experiment start
- [ ] Inject failure
- [ ] Observe system response (monitor dashboards)
- [ ] Document observations in real time
- [ ] If steady state is violated beyond hypothesis, abort immediately
- [ ] Announce experiment end

**After game day:**
- [ ] Write post-mortem: what happened, what was learned, what needs to change
- [ ] Create action items for any weaknesses discovered
- [ ] Schedule fix implementation
- [ ] Re-run experiment after fixes to verify improvement
- [ ] Share learnings with the team

### 49.6 Chaos Engineering Readiness

Don't start chaos engineering unless:
- [ ] You have comprehensive monitoring (metrics, logs, traces)
- [ ] You have defined SLOs and steady state metrics
- [ ] You have automated rollback/deployment
- [ ] Your on-call rotation is established
- [ ] You have run failure mode analysis (FMEA) on your architecture
- [ ] Your blast radius can be contained to non-production environments first

**Start simple:**
1. First experiment: Kill a non-critical service in staging. Observe.
2. Second: Add network latency to staging database. Observe.
3. Third: Fill staging disk to 90%. Observe.
4. Fourth: Move to production with minimal blast radius.
5. Continue expanding scope as confidence grows.

---

## 50. Intentional Minimalism — The Simplicity-First Architecture

This section is not about "writing less code." It's about a structured decision protocol that treats complexity as cost and maps simplicity onto concrete actions. Before reaching for a library, a pattern, or even a function, run the ladder.

### 50.1 The Decision Ladder — Stop at the First Rung That Holds

Every implementation decision must run through this ordered protocol. Start at rung 1 and descend only if the current rung does not solve the problem:

```
Rung 1: YAGNI
  Does this need to exist at all? Can the requirement be satisfied by
  removing something instead of adding something? Challenge every "should"
  — only "must" survives this gate.

Rung 2: Standard Library
  Does the language/runtime already ship with this? Before importing
  anything new, check the stdlib index for your language version.

Rung 3: Native Platform Feature
  Does the browser, OS, or runtime platform already provide this?
  Browsers ship HTML5 validation, CSS grid, Web APIs. The OS ships
  cron, log rotation, file watching. The platform is free — use it.

Rung 4: Already-Installed Dependency
  Does a dependency already in pyproject.toml / package.json provide this?
  Do not add a new dependency when an existing one covers the need.

Rung 5: One Line
  Can this be solved with a single, clear line of code?
  If one line does it, do not write a function. Do not create a class.
  Do not build an abstraction. One line is self-documenting.
  **Guard:** If the one line is also UNREADABLE — deeply nested ternary,
  chained regex, or a comprehension with 3+ conditions — it fails
  the "clear" test. Drop to Rung 6 and write it legibly.

Rung 6: Minimum Code That Works
  Write the shortest possible implementation that passes all tests.
  No extension points. No configurability. No "what if" hooks.
  Future-you can add those when future-you has the requirement.
```

**The ladder is a reflex, not a research project.** Each rung takes seconds to evaluate. If you're spending minutes debating whether stdlib covers the need, drop to the next rung and move on.

**Ladder in practice:**
```python
# Requirement: validate an email address

# Rung 1 (YAGNI): Do we actually need to validate?
# Yes — this is a trust boundary accepting user input.

# Rung 2 (stdlib): Does Python ship email validation?
# No — re.match with a simple pattern is close but not stdlib.

# Rung 3 (native): N/A for backend.

# Rung 4 (existing dep): Is pydantic already installed?
# Yes — it's in requirements.txt.

# Rung 5 (one line): Can Pydantic do it in one line?
from pydantic import EmailStr  # <- Rung 5 achieved. Stop here.

# WRONG — skips the ladder entirely:
# pip install email-validator validators py3-validate-email
# class EmailValidator(ABC):
#     @abstractmethod
#     def validate(self, email: str) -> ValidationResult: ...
```

### 50.2 Structured Tradeoff Comments — Name the Ceiling

When you intentionally accept a shortcut, document it with a structured comment that names the KNOWN LIMIT and the UPGRADE TRIGGER:

```python
# ponytail: global lock on cache writes
# Upgrade to per-key locks if write contention exceeds 10%
_cache_lock = threading.Lock()

def set_cache(key: str, value: Any) -> None:
    with _cache_lock:  # Intentional — see above
        _cache[key] = value
```

**Format:**
```
# ponytail: <what was skipped or simplified>
# Upgrade to <what to build instead> if <measurable trigger condition>
```

**Why this format:**
- Names the ceiling so it's not a hidden landmine
- Ties the upgrade to a measurable condition (not a vague "if this gets slow")
- Makes debt scannable — `grep -r "ponytail:" src/` produces an instant ledger of all intentional shortcuts
- Distinguishes intentional simplifications from bugs-in-waiting

**Examples of good tradeoff comments:**
```python
# ponytail: O(n²) dedup scan
# Upgrade to hash-set dedup if n exceeds 10,000 items

# ponytail: fixed 30s polling loop
# Upgrade to websocket push if latency matters or server load increases

# ponytail: naive heuristic for spam detection (<80% accuracy)
# Upgrade to ML classifier if false positives exceed 2% of total traffic

# ponytail: single-region deployment
# Upgrade to multi-region if p99 latency exceeds 500ms for >1% of users
```

**What this is NOT:**
- NOT a substitute for fixing real bugs
- NOT a permission slip for sloppy code
- NOT a TODO — it has a named ceiling and a specific trigger
- NOT an excuse to skip error handling where data loss is possible

### 50.3 Safety Carve-Outs — What to NEVER Be Lazy About

The pursuit of simplicity has hard boundaries. These domains are exempt from the ladder — always invest full rigor:

| Domain | Why It's Exempt | Minimum Standard |
|--------|-----------------|------------------|
| **Input validation at trust boundaries** | The outside world is hostile. Unvalidated input is the #1 attack vector. | Validate type, range, and format for every external input. Use Pydantic or equivalent. |
| **Error handling that prevents data loss** | Silent data loss is unrecoverable. Users will not forgive you. | Every write operation must handle failure. Transactions or idempotency keys. |
| **Security** | Security shortcuts compound. One "temporary" bypass becomes permanent. | Parameterized queries, no eval/exec, encrypted secrets, auth on every endpoint. |
| **Accessibility** | Excluding users is not an optimization. It's a defect. | Semantic HTML, keyboard navigation, screen reader labels, color contrast. |
| **Hardware calibration** | The platform is never the spec ideal. A clock drifts. A sensor reads off. A regulator sags under load. Real hardware needs real calibration. | Measure, don't assume. Validate against physical ground truth. Document calibration drift over time. |
| **Anything explicitly requested** | If the user explicitly asks for something, build it as specified. The ladder optimizes everything ELSE. | Build what was asked for. Name simplifications in a tradeoff comment. Let the user decide. |

### 50.4 Output Discipline — Code First, Explanation Minimal

When presenting completed work:

**Rule:** Code first. Then at most three short lines: what was skipped, when to add it. No essays, no feature tours, no design notes.

```
[code block]

Skipped: <what was intentionally omitted>
Add when: <measurable trigger condition>
```

**If the explanation is longer than the code, delete the explanation.** The code IS the explanation. Comments inside the code handle the "why." The external summary handles only what was NOT built.

**Exceptions — when longer explanation IS warranted:**
- The user explicitly asked for an explanation
- An architectural decision with non-obvious tradeoffs (the code alone doesn't convey it)
- A breaking change that downstream consumers need to understand
- A security-relevant decision where the reasoning IS the safety mechanism

**What this replaces:**
- Do NOT write a paragraph describing what the code does (the code says that)
- Do NOT list every function added (the diff shows that)
- Do NOT include benchmark numbers unless requested or the improvement was the stated goal
- Do NOT explain why you used a for-loop instead of a list comprehension (the ladder already decided that)

**What this does NOT apply to (explicit carve-outs):**
- **Commit messages** — These follow Section 15's detailed WHY format (problem → solution → context). Commit messages are not "output" — they're permanent project history.
- **User-requested explanations** — If the user asks "why did you do X?", answer fully.
- **Security decisions** — Safety override. If omitting the explanation could cause someone to reverse the security measure later, explain it.
- **Architectural decisions in DEEPDIVE.md** — These need full context for future agents.
- **When the next developer would need to understand constraints NOT visible in the code** — e.g., "we use O(n²) here because N is always < 100."

### 50.5 Over-Engineering Review Vocabulary

When reviewing code (your own or others), use this standardized vocabulary to flag complexity that should be removed. Each finding is one line:

```
L<line>: <tag> <what was found>. <what to replace it with>.
```

**Tags:**
| Tag | Meaning | Example |
|-----|---------|---------|
| `delete:` | Dead code, unused flexibility. Remove entirely. | `L42: delete: unused fallback path for Python 3.8. Remove the entire try/except block.` |
| `stdlib:` | Hand-rolled version of something in the standard library. | `L15: stdlib: custom slugify function. Use pathlib.Path.stem or re.sub with str.lower.` |
| `native:` | Code doing what the platform already does. | `L28: native: custom form validation logic. Use HTML5 constraint validation API (checkValidity, setCustomValidity).` |
| `yagni:` | Abstraction with one implementation, config nobody sets, layer with one caller. | `L55: yagni: IEmailSender interface with single SmtpSender implementation. Inline the class.` |
| `shrink:` | Same logic, fewer lines. | `L67: shrink: 12-line dict merge. Use {**a, **b}.` |

**Review ends with a net line:**
```
Net: -23 lines possible (4 findings).
```

**When to use this vocabulary:**
- During self-review before marking a task complete
- When reviewing AI-generated code for bloat
- During code review of any PR

### 50.6 Honesty Boundaries — What Agents MUST NOT Claim

Prevent agents from making invalid or misleading claims. These are NOT optional.

**NEVER print per-repo savings numbers** (e.g., "you saved 47 lines here"):
- The unbuilt version was never written, so there is no real baseline
- Claiming savings against imaginary code is hallucination, not measurement
- The decision ladder prevents code from being written — there's nothing to measure against

**NEVER claim something "improves performance" without measurements:**
- "Should be faster" is speculation, not engineering
- Show before/after measurements OR don't make the claim
- If the performance change is irrelevant (1μs difference), don't mention it

**NEVER claim "100% test coverage" based on line coverage alone:**
- Line coverage ≠ behavioral coverage (see Section 40.5)
- Branch coverage + mutation score are the minimum for strong claims

**NEVER say "bug fix" when you changed behavior without confirming the old behavior was wrong:**
- State what changed and why
- Let the changelog categorize it
- "Bug fix" implies a confirmed defect; "behavior change" is the honest description when uncertain

### 50.7 Tests Are Not Bloat

The minimalism ladder exempts tests. A test is not bloat — it's the discipline that makes minimalism safe to practice.

**Rules:**
- **One runnable check per non-trivial function.** An `assert` statement, a one-function test, a small script. No test frameworks required. No fixtures. Just prove the code works.
- **Trivial one-liners need no test.** `def get_timestamp(): return time.time()` — skip it.
- **Measure test burden separately.** Track `wrote_tests_rate` but do not count tests against "lines of code" metrics. Tests are infrastructure, not bloat.
- **Every security-critical path MUST have a test.** Even if it's small. Especially if it's small.

```python
# A one-runnable-check — no framework, no class, no fixture
def test_divide_by_zero_returns_none():
    assert safe_divide(10, 0) is None
    assert safe_divide(10, 2) == 5

# Run with: python -c "from tests.test_math import test_divide_by_zero_returns_none; test_divide_by_zero_returns_none()"
```

### 50.8 Self-Referential Governance

The AGENTS.md file itself is subject to its own rules. This is not a meta observation — it's a design constraint.

**Agents working on AGENTS.md MUST:**
- Apply the decision ladder to every addition (does this section need to exist?)
- Use tradeoff comments for any intentional gaps
- Follow the same commit conventions, PR templates, and quality gates
- Never add sections that future agents would need to explain away ("we don't follow Section X because...")

**Before adding a new section, ask:**
- Is this pattern already covered by an existing section? (merge, don't duplicate)
- Will this age well? (avoid sections tied to specific tool versions or transient trends)
- Does this section reduce ambiguity or add it? (every rule should eliminate a real failure mode)

---

## 51. Instruction Architecture — Context Economy & Self-Improvement

The AGENTS.md file itself is a system. These patterns govern how instructions are loaded, maintained, and adapted — ensuring the instruction system stays lean and improving over time.

### 51.1 Trigger-Based Instruction Loading

Large AGENTS.md files must not flood every context window. Structure specialized knowledge so it only enters context when relevant.

```yaml
# sections/kubernetes.md
---
triggers:
  - kubernetes
  - k8s
  - helm
  - deployment
---
# Kubernetes Deployment Knowledge

When deploying to Kubernetes:
- Use the following resource patterns...
- Never hardcode container ports...
- Always include liveness and readiness probes...
```

**Rules:**
- **Core sections respond to all requests** (Section 1-2, 9, 15, 33, 36) — always loaded
- **Domain-specific sections load on trigger match** — keyword in user message activates them
- **Without a trigger list, the section is always loaded**
- **Trigger matching is case-insensitive, word-boundary-aware** — "kubernetes" matches "deploy to kubernetes" but not "kubernetes-health-check" (single word match)
- **Project-specific sections** (tech stack defaults, deployment patterns) belong in a project's own AGENTS.md, not the universal template — move them there

**Implementation approaches:**
| Approach | When | Trade-off |
|----------|------|-----------|
| **Frontmatter triggers** | Agent supports extensions/plugins | Requires agent support for trigger parsing |
| **Separate files** | Simple, works with any agent | AGENTS.md references them, human decides which to copy in |
| **Collapsible sections** | Markdown-native, always available | Still burns tokens scanning headers |

**The simplest approach (works everywhere):**
Keep the core AGENTS.md lean (≤ 500 lines). Move domain knowledge to `docs/AGENT_DOMAIN_*.md` files. The core file references them:

```markdown
## Domain-Specific Guidance

For specialized domains, consult the relevant guide:
- `docs/AGENT_DOMAIN_KUBERNETES.md` — When the task involves K8s, deployments, or containers
- `docs/AGENT_DOMAIN_ML.md` — When the task involves model training, inference, or data pipelines
- `docs/AGENT_DOMAIN_REALTIME.md` — When the task involves WebSockets, streaming, or pub/sub
```

### 51.2 Self-Maintaining Instructions — Meta-Learning

The AGENTS.md file must evolve. The agent should recognize when its instructions are insufficient and propose improvements.

**When the agent should suggest adding a rule:**
| Signal | Example | Rule to Add |
|--------|---------|-------------|
| **User had to intervene** | User corrected the approach after code was written | Document the correct approach as a required pattern |
| **Multiple back-and-forth rounds** | 3+ iterations to get a behavior right | Codify the final correct behavior as a convention |
| **Edge case discovered the hard way** | A bug caused by a pattern nobody documented | Add the edge case as a gotcha or anti-pattern |
| **Pattern required reading many files to understand** | Agent had to explore 5+ files to figure out architecture | Document the architecture in DEEPDIVE.md |
| **User explicitly said "always do X"** | "Always use `pathlib` not `os.path`" | Add to the Code Style section |

**What NOT to add:**
- Patterns the agent can figure out from reading 2-3 files (these are discoverable)
- Obvious conventions already in PEP 8 or standard style guides
- One-off decisions tied to a specific context that won't recur
- Tool version trivia ("use ruff 0.4.1") — pin in config files, not AGENTS.md

**The meta-instruction itself:**
```
If a user had to correct you, intervene, hand-hold, or repeat themselves
to get the right behavior, PROPOSE adding a rule to AGENTS.md that would
have prevented the issue. Do not wait for the user to ask. The proposal
should be:
  "I should add to AGENTS.md: [specific rule]. OK to add?"
```

**Why this matters:** AGENTS.md files go stale because no process updates them after edge cases are discovered. This pattern makes instruction maintenance a natural part of every interaction.

### 51.3 Context Budget Awareness

Every instruction loaded into context costs tokens. Large AGENTS.md files can consume significant portions of the context window before the task even begins.

**Rules for PROJECT-SPECIFIC AGENTS.md files:**
- **Total AGENTS.md ≤ 2,000 lines** — if longer, split into core + domain guides
- **Per-request instruction budget ≤ 5,000 tokens** — measure this, don't guess
- **Context headroom minimum: 70%** — at least 70% of context window must be available for the task itself
- **Periodic context snapshot** — if context exceeds 50%, summarize key decisions to external storage before continuing

**Exception — this template (standardized-markdown):**
This repository is a universal template library, not a project-specific instruction file. It intentionally exceeds these limits. Individual projects should copy only relevant sections and keep the adapted AGENTS.md within the size budget. The full template serves as a reference — project AGENTS.md files should be lean subsets.

**Size monitoring pattern:**
```bash
# Estimate token count of AGENTS.md (rough: 1 token ≈ 0.75 words)
python -c "
words = open('AGENTS.md').read().split()
print(f'~{int(len(words) / 0.75):,} tokens ({len(words):,} words)')
"
```

**When AGENTS.md is too long:**
1. Move domain-specific patterns to `docs/AGENT_DOMAIN_*.md` (trigger-loaded)
2. Remove redundant examples — one good example per pattern
3. Remove patterns covered by standard style guides (PEP 8, Google style)
4. Remove project-specific defaults and put them in the project's own AGENTS.md

### 51.4 Model Capability Awareness

Different models handle instructions differently. Structure AGENTS.md so it degrades gracefully when read by less capable models.

**Pattern: Tiered Detail Levels**

```markdown
<!-- TIER:ALL -->
This pattern applies to all models.

<!-- TIER:FULL -->
Additional nuance for models with ≥128K context.
Include verbose rationale and edge case discussion.

<!-- TIER:COMPACT -->
Condensed version for models with ≤8K context.
Focus on rules, omit rationale.
```

**What changes at each tier:**
| Aspect | FULL (≥128K) | STANDARD | COMPACT (≤8K) |
|--------|-------------|----------|---------------|
| **Rationale** | Include WHY for every rule | Include for non-obvious rules | Omit — rules only |
| **Examples** | Multiple per pattern | One canonical example | Code snippet only |
| **Edge cases** | Explicit discussion | Notable ones only | Omit — assume standard |
| **Cross-references** | Link between related sections | Key cross-refs | Omit |
| **Anti-patterns** | Multiple with explanation | One per anti-pattern | Short list, no explanation |

**For model families with known quirks:**
- **Claude models:** Can handle verbose, nuanced instruction. Prefer thoroughness.
- **GPT models:** Benefit from explicit output format schemas and structured constraints.
- **Gemini models:** Perform better with role-based framing and clear task boundaries.
- **Small/local models:** Strip everything non-essential. Commands, not prose.

**The fallback rule:** If unsure which model will read this, write for STANDARD. Provide a condensed appendix that summarizes the 20 most critical rules in bullet form for compact contexts.

### 51.5 Instruction Provenance — Where Did This Rule Come From

Every non-obvious rule should be traceable to its source. This prevents cargo-culting and enables future readers to decide if a rule still applies.

**Provenance annotation pattern:**
```markdown
- **No eval()/exec() on user input.** [Source: OWASP, Section 27.3]
- **800-line PR size limit.** [Source: Code review research, Section 33.1]
- **Structured tradeoff comments with named ceilings.** [Source: ponytail, Section 50.2]
```

**Rules for provenance:**
- **Cite the standard** (OWASP, SemVer, Google testing blog, PEP)
- **Link to source material** when available (arXiv paper, blog post, research article)
- **Include the date** when a rule was added (in Change Log)
- **Mark rules derived from project-specific experience** — these may not apply universally
- **Periodically audit** — if a rule's source has been superseded or disproven, update or remove it

---

## 52. Rule Enforcement Architecture — From Advisory to Deterministic

AGENTS.md alone is the **soft layer** — the model reads prose and hopefully follows it. But hope is not a strategy. The industry is converging on a **two-layer enforcement model**: advisory rules (what we have) PLUS deterministic enforcement (what we need to add to every project).

### 52.1 The Two-Layer Model

```
LAYER 1 (Soft) — Advisory / Prompt Injection
  AGENTS.md, CLAUDE.md, copilot-instructions, .cursorrules
  ──→ Model reads rules as context, attempts to follow them.
      PRO: Flexible, covers any rule.
      CON: No guarantee. Model can ignore, forget, or override.

LAYER 2 (Hard) — Deterministic / Hooks & Validation
  PreToolUse hooks, permission deny rules, pre-commit hooks, CI gates
  ──→ Code enforces rules. Model cannot override.
      PRO: 100% compliance for covered rules.
      CON: Only covers rules expressible as code.
```

**Rules that MUST have hard-layer enforcement:**
- Preventing destructive operations (`rm -rf`, `git push --force`)
- Protecting sensitive files (.env, secrets, credentials)
- Blocking force push to protected branches
- Preventing commits without tests passing
- Blocking changes that exceed PR size limits
- Preventing code that doesn't compile/parse

**Rules that can remain soft-layer:**
- Code style preferences
- Documentation quality expectations
- Commit message format conventions
- Architecture pattern preferences

### 52.2 Compiling Prose Rules Into Hooks

The most powerful new pattern: parse your AGENTS.md prose rules and generate actual hook code that enforces them at runtime.

**Pattern: Rule → Hook Compilation**

```json
// hooks/enforce-pr-size.json — compiled from AGENTS.md Section 33.1
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash(git push*)",
      "hooks": [{
        "type": "command",
        "command": "hooks/check-pr-size.sh",
        "description": "Block push if PR exceeds 800 lines"
      }]
    }]
  }
}
```

```bash
# hooks/check-pr-size.sh — prevents pushing oversized PRs
CHANGES=$(git diff --stat origin/main | tail -1 | awk '{print $1}')
if [ "$CHANGES" -gt 800 ]; then
  echo "BLOCKED: PR size $CHANGES lines exceeds 800-line limit (AGENTS.md Section 33.1)"
  exit 2  # Exit code 2 blocks the action
fi
```

**Hook compilation checklist — every project should compile THESE rules from AGENTS.md to hooks:**

| AGENTS.md Rule | Hook Type | Triggers On | Blocks When |
|---------------|-----------|-------------|-------------|
| Section 2: Never go rogue | Permission deny | `gh pr create`, `gh issue create` | No explicit approval |
| Section 33.1: PR size limit | PreToolUse(Bash) | `git push` | Diff exceeds 800 lines |
| Section 36.2: No force push | PreToolUse(Bash) | `git push --force` | Always (exit code 2) |
| Section 9: Lint before commit | PreToolUse(Bash) | `git commit` | `ruff check .` fails |
| Section 40: Coverage floor | CI job | `pull_request` | Coverage drops below 80% |
| Section 13: No secrets in code | Git hook | `git commit` | `detect-secrets` finds a secret |
| Section 36.4: No paid services | PreToolUse(WebFetch) | Any API domain | Domain matches known paid service |
| Section 44: Encrypted secrets | Git hook + CI | `git commit` + PR | Unencrypted secret detected |

### 52.3 Pre-commit Hooks as Deterministic Gate

Pre-commit hooks (Section 37) are the most universal hard-layer enforcement — they work with ANY agent, not just ones that support hook systems.

**Minimum hard-layer hooks every project must have:**

```yaml
# .pre-commit-config.yaml — compiled from AGENTS.md rules
repos:
  # Section 13: No secrets in code
  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.5.0
    hooks:
      - id: detect-secrets
        name: "BLOCK: secrets in code (AGENTS.md S13)"

  # Section 9: No dead code before commit
  - repo: local
    hooks:
      - id: vulture-check
        name: "BLOCK: dead code detected (AGENTS.md S9)"
        entry: vulture .
        language: system
        types: [python]

  # Section 33.1: PR size limit
      - id: pr-size-check
        name: "BLOCK: changes exceed 800 lines (AGENTS.md S33.1)"
        entry: bash -c 'git diff --cached --stat | tail -1 | awk "{if (\$1+0 > 800) exit 1}"'
        language: system
        pass_filenames: false

  # Section 36.2: No force push
      - id: no-force-push
        name: "BLOCK: force push prohibited (AGENTS.md S36.2)"
        entry: bash -c 'if echo "$PRE_COMMIT_REMOTE_BRANCH" | grep -q "+"; then echo "Force push blocked"; exit 1; fi'
        language: system
        pass_filenames: false
        stages: [pre-push]

  # Section 36.4: No paid GitHub Actions
      - id: no-large-runners
        name: "BLOCK: paid runner detected (AGENTS.md S36.4)"
        entry: bash -c 'grep -r "runs-on:.*large\|runs-on:.*gpu" .github/workflows/ && exit 1 || exit 0'
        language: system
        pass_filenames: false
```

### 52.4 Runtime Hook Architecture (Claude Code / Codex)

For agents that support hooks, compile AGENTS.md rules into JSON hook definitions:

```json
// .claude/settings.json — hard-layer enforcement
{
  "permissions": {
    "deny": [
      "Bash(git push --force *)",           // Section 36.2
      "Bash(rm -rf /*)",                     // Section 36.1
      "Bash(git config user.*)",             // Section 2 (identity)
      "WebFetch(domain:openai.com/api*)",    // Free-tier only unless approved
      "WebFetch(domain:anthropic.com/api*)"  // Free-tier only unless approved
    ],
    "allow": [
      "Read(*.md)",
      "Read(*.py)",
      "Bash(git status)",
      "Bash(git diff*)",
      "Bash(pytest*)",
      "Bash(ruff*)",
      "Bash(mypy*)",
      "Bash(vulture*)"
    ],
    "ask": [
      "Bash(pip install *)",
      "Bash(npm install *)",
      "WebFetch(*)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "hooks/pr-size-guard.sh",
            "description": "AGENTS.md S33.1: Block push if PR > 800 lines"
          }
        ]
      },
      {
        "matcher": "Bash(git commit *)",
        "hooks": [
          {
            "type": "command",
            "command": "hooks/lint-guard.sh",
            "description": "AGENTS.md S9: Block commit if lint fails"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "agent",
            "description": "AGENTS.md S23: Run test suite before agent can stop. Only exit if tests pass.",
            "prompt": "Run 'pytest --cov=. --cov-fail-under=80' and report results. If tests fail, the agent must NOT stop."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "hooks/vulture-sweep.sh",
            "description": "AGENTS.md S9: Check for dead code after every edit"
          }
        ]
      }
    ]
  }
}
```

### 52.5 Evidence-First Methodology

The soft layer's biggest weakness is that rules can be read, understood, and then **silently ignored**. The countermeasure: require evidence for every claim.

**Core principle:** Every assertion about code, behavior, or the project must cite a `file:line` reference. No unsupported claims.

```
# Standard format for evidence citations:
file_path:start_line-end_line — brief description

# Examples:
src/api/routes.py:42-58 — the POST /users endpoint validates input with Pydantic
tests/test_api.py:103 — test_post_user_invalid_email_returns_422 covers this case
AGENTS.md:33.1 — PR size limit is 800 lines
```

**When to use evidence citations:**
- Claiming something is implemented → cite the file and line
- Claiming something is tested → cite the test file and line
- Claiming a convention exists → cite the AGENTS.md section
- Claiming a function has no callers → show the vulture output as evidence
- Claiming tests pass → show the actual test output, not "they should pass"

**When evidence IS required:**
- All bug reports ("X is broken")
- All feature claims ("X is implemented")
- All refactoring justifications ("X is dead code because...")
- All security claims ("X is safe because...")

**When evidence is NOT required:**
- Future plans ("we should add X")
- Opinions ("X would be cleaner")
- Standard knowledge ("Python is interpreted")

### 52.6 Rule Verification — Testing That Rules Are Followed

You can test whether agents actually follow the rules in AGENTS.md. This is the meta-test: test the tests.

**Pattern: Behavioral rule compliance test**

```python
# tests/compliance/test_rule_enforcement.py
"""Verify that AGENTS.md rules are actually followed."""

import subprocess
from pathlib import Path

def test_no_dead_code_in_commits():
    """Section 1, 9: No commit should introduce dead code."""
    result = subprocess.run(
        ["vulture", "."],
        capture_output=True,
        text=True
    )
    assert result.returncode == 0, f"Dead code found:\n{result.stdout}"

def test_pr_size_under_800_lines():
    """Section 33.1: Current diff must not exceed 800 lines."""
    result = subprocess.run(
        ["git", "diff", "--stat", "origin/main"],
        capture_output=True,
        text=True
    )
    line = result.stdout.strip().split("\n")[-1]
    if "changed" in line:
        changes = int(line.split()[0])
        assert changes <= 800, f"PR size {changes} lines exceeds 800-line limit"

def test_no_secrets_in_repo():
    """Section 13, 44: No secrets committed to repository."""
    result = subprocess.run(
        ["detect-secrets", "scan", "--all-files"],
        capture_output=True,
        text=True
    )
    assert "RESULTS:" not in result.stdout, f"Secrets found:\n{result.stdout}"

def test_ci_workflow_exists():
    """Section 38: CI pipeline must be configured."""
    workflows = list(Path(".github/workflows").glob("*.yml"))
    assert len(workflows) > 0, "No CI workflows found in .github/workflows/"

def test_pre_commit_config_exists():
    """Section 37: Pre-commit hooks must be configured."""
    assert Path(".pre-commit-config.yaml").exists(), \
        "No .pre-commit-config.yaml found — pre-commit hooks not configured"

def test_coverage_above_threshold():
    """Section 40: Coverage must be at or above 80%."""
    result = subprocess.run(
        ["pytest", "--cov=.", "--cov-report=term-missing", "--cov-fail-under=80"],
        capture_output=True,
        text=True
    )
    assert result.returncode == 0, f"Coverage below 80%:\n{result.stdout[-500:]}"
```

**When to run compliance tests:**
- In CI — every PR triggers compliance checks
- Weekly — full compliance audit via cron
- Pre-commit — fast checks (secrets, dead code) run before every commit

### 52.7 Structured Rule Formats — Beyond Free-Text Markdown

Free-text prose rules have two fatal problems for enforcement:
1. An automated system cannot reliably parse "don't do X" from prose
2. The same rule phrased differently means different things to different models

**Pattern: Rule with structured detection metadata**

```yaml
# .ai-rules/no-force-push.md — structured format for deterministic compilation
---
rule_id: NO_FORCE_PUSH
severity: critical
source: AGENTS.md Section 36.2
description: Never force push to shared branches
enforcement:
  type: pre_push_hook
  detection:
    pattern: "git push.*--force|git push.*\\+[a-z]+/main"
    on_match: block
  human_readable: |
    Force pushing rewrites remote history and can destroy
    collaborators' work. Always use `git push` without --force
    on shared branches.
evidence_id: NO_FORCE_PUSH_001
---
```

**Benefits of structured rules:**
- Automated tools can COMPILE the rule into a hook
- The `detection` pattern is machine-readable — works across agents
- `severity` enables graduated response (warn vs block vs CI-fail)
- `source` provides traceability back to AGENTS.md
- `evidence_id` enables automated compliance reporting

### 52.8 CI-Based Rule Enforcement Gates

The final layer: CI jobs that verify AGENTS.md compliance and block merges.

```yaml
# .github/workflows/rule-compliance.yml
# Compiles AGENTS.md rules into CI checks
name: Rule Compliance Audit

on:
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1'  # Weekly full audit

jobs:
  rule-checks:
    name: AGENTS.md Rule Compliance
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: S9 - No dead code
        run: |
          pip install vulture
          vulture . --min-confidence 80

      - name: S13 - No secrets in code
        run: |
          pip install detect-secrets
          detect-secrets scan --all-files

      - name: S23 - Verification gate checklist
        run: |
          # Check all checklist items in Section 23.4
          grep -q "All functions have production call paths" AGENTS.md
          echo "Verification checklist present"

      - name: S33.1 - PR size gate
        run: |
          CHANGES=$(git diff --stat origin/main | tail -1 | awk '{print $1}')
          if [ "$CHANGES" -gt 800 ]; then
            echo "FAIL: PR has $CHANGES lines, exceeds 800-line max (AGENTS.md S33.1)"
            exit 1
          fi
          echo "PR size: $CHANGES lines (within 800-line limit)"

      - name: S37 - Pre-commit config present
        run: |
          test -f .pre-commit-config.yaml || (echo "FAIL: No pre-commit config (AGENTS.md S37)" && exit 1)

      - name: S38 - CI workflow present
        run: |
          test -n "$(ls .github/workflows/ci*.yml 2>/dev/null)" || (echo "FAIL: No CI workflow (AGENTS.md S38)" && exit 1)

      - name: S40 - Coverage gate
        run: |
          pip install pytest-cov
          pytest --cov=. --cov-fail-under=80 --cov-report=term || (echo "FAIL: Coverage below 80% (AGENTS.md S40)" && exit 1)

      - name: S44 - Check .env is in gitignore
        run: |
          grep -q "^\.env$" .gitignore || (echo "FAIL: .env not in gitignore (AGENTS.md S44)" && exit 1)

      - name: Generate compliance report
        if: always()
        run: |
          echo "## AGENTS.md Compliance Report" >> $GITHUB_STEP_SUMMARY
          echo "| Rule | Status |" >> $GITHUB_STEP_SUMMARY
          echo "|------|--------|" >> $GITHUB_STEP_SUMMARY
          # Parse job results to populate
```

### 52.9 Hook Compilation Quick Reference

| AGENTS.md Section | Hook Type | Implementation | Priority |
|------------------|-----------|---------------|----------|
| 2 (Never rogue) | Permission deny | Block `gh pr create`, `gh issue create` | CRITICAL |
| 2 (Never spend) | Permission deny + pre-commit | Block paid runner YAML + API domain access | CRITICAL |
| 2 (Use user identity) | Permission deny | Block `git config user.*` changes | CRITICAL |
| 9 (Lint before commit) | PreToolUse(Bash) | `ruff check .` exit code gates commit | HIGH |
| 13 (No secrets) | Git hook + CI | `detect-secrets` on pre-commit + CI | CRITICAL |
| 33.1 (PR size) | PreToolUse(Bash) + CI | `git diff --stat` gate at 800 lines | HIGH |
| 36.2 (No force push) | Permission deny | Block `git push --force` to main | CRITICAL |
| 36.3 (No rogue GitHub) | Permission deny | Block `gh pr/issue` unless approved | HIGH |
| 36.4 (No paid services) | Permission deny + pre-commit | Block `runs-on.*large\|gpu` + API domains | CRITICAL |
| 37 (Pre-commit installed) | CI check | Assert `.pre-commit-config.yaml` exists | HIGH |
| 38 (CI workflow) | CI check | Assert `.github/workflows/ci*.yml` exists | HIGH |
| 40 (Coverage floor) | CI check | `--cov-fail-under=80` in CI | HIGH |
| 44 (No committed secrets) | Git hook + CI | `detect-secrets` + `gitleaks` | CRITICAL |
| 23 (Verification gates) | Stop hook (agent) | Run tests + lint, block exit on failure | MEDIUM |

---

---

## 53. Project Type Patterns

AGENTS.md was originally web-service and Python-focused. This section extends coverage to five common non-web project types with language-agnostic patterns that apply regardless of stack.

### 53.1 Mobile Apps (iOS / Android / React Native)

Mobile projects have unique constraints: app store review cycles, platform-specific permissions, offline behavior, and strict size budgets.

**Platform-specific testing:**
```
iOS:         XCTest (unit), XCUITest (UI), Detox (E2E)
Android:     JUnit (unit), Espresso (UI), Maestro (E2E)
React Native: Jest (unit), Detox (E2E), Maestro (E2E)
```

**Push notifications:**
- Register for push permissions at first meaningful interaction, not on app launch
- Handle token refresh — store tokens server-side, not just in memory
- Test silent pushes (background) vs user-visible pushes separately
- Never rely on push delivery timing — treat as best-effort

**Offline behavior:**
- Every network call must have an offline fallback (cached data, empty state, or error)
- Use local storage (SQLite, Core Data, Room) as source of truth, sync to server
- Test with airplane mode, throttled networks, and intermittent connectivity
- Never show a spinner that never resolves — always have a timeout with user-visible state

**Mobile permissions:**
- Request permissions at the moment of use, not at app launch (iOS requirement)
- Handle "denied" state gracefully — show in-app explanation, link to settings
- Test the "previously denied" flow, not just the "first time" flow

**Crash reporting:**
```
Sentry       — Cross-platform, source maps, breadcrumbs
Crashlytics  — Firebase integration, free tier
Bugsnag      — Real-time alerts, release tracking
```
- Every release must have crash reporting enabled before app store submission
- Include user context (user ID, session ID) in crash reports
- Never log PII in crash breadcrumbs

**App size budget:**
- iOS: App Store limit is 200MB over cellular; aim for <100MB
- Android: Google Play limit is 150MB; aim for <50MB
- Track size per release in CI — fail the build if size regresses >5%
- Use App Thinning (iOS) / App Bundle (Android) to reduce per-device size

**E2E mobile testing:**
```
Device farms: BrowserStack, Sauce Labs, AWS Device Farm
Local:       Maestro (fast, YAML-based), Detox (JS-native)
```
- Run E2E on at least 2 iOS devices (small + large) and 2 Android devices
- Never rely solely on simulators — test on real devices at least weekly

### 53.2 Embedded Firmware (C / C++ / Rust)

Embedded projects have no internet, no Docker, no cloud. Code must be deterministic and resource-constrained.

**Cross-compilation toolchain:**
```
ARM Cortex-M:  arm-none-eabi-gcc (GNU ARM Embedded Toolchain)
RISC-V:        riscv32-unknown-elf-gcc / riscv64-unknown-elf-gcc
ESP32:         xtensa-esp32-elf-gcc (ESP-IDF)
STM32:         arm-none-eabi-gcc + STM32CubeIDE
```
- Pin toolchain version in CI (e.g., `gcc-arm-none-eabi-10.3-2021.10`)
- Document toolchain installation in README — never assume developer has it
- Use `CMake` or `Make` for build system; avoid IDE-specific project files

**Static analysis for C/C++:**
```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/pocc/pre-commit-hooks
    rev: v1.3.5
    hooks:
      - id: cppcheck
        args: [--enable=all, --suppress=missingIncludeSystem]
      - id: clang-tidy
        args: [-p, build/]
      - id: clang-format
        args: [-i, --style=file]
```
- Run `cppcheck --enable=all` on every commit
- Use `clang-tidy` with MISRA-C or CERT-C rules for safety-critical code
- Use `clang-format` with a `.clang-format` file for consistent style

**Code formatting:**
```yaml
# .clang-format
BasedOnStyle: Google
IndentWidth: 4
ColumnLimit: 100
AllowShortFunctionsOnASingleLine: Inline
```
- Commit `.clang-format` to the repo root
- Run `clang-format -i *.c *.h` in pre-commit hooks

**Interrupt handler discipline:**
- ISRs must be short — set a flag, copy data, return immediately
- Never call `malloc`, `printf`, or blocking functions from an ISR
- Use atomic operations or disable interrupts for shared state access
- Document every ISR with: trigger source, max execution time, shared state

**Flash/ROM size tracking:**
```bash
# Track binary size in CI
arm-none-eabi-size build/firmware.elf
# text    data     bss     dec     hex filename
# 45232   1024    2048   48304    bcb0 build/firmware.elf
```
- Fail CI if text+data exceeds 90% of available flash
- Track size delta per PR — alert if a PR adds >1KB without justification

**OTA / firmware update:**
- Implement dual-bank flash layout (active + staging)
- Verify firmware signature before applying update
- Implement rollback on boot failure (watchdog timer)
- Never OTA-update without a verified rollback path

### 53.3 Data Pipelines / ETL

Data pipelines must be idempotent, resumable, and observable. Failures are inevitable — the system must recover gracefully.

**Idempotency:**
- Every task must produce the same output when run twice with the same input
- Use `UPSERT` (INSERT ON CONFLICT UPDATE) instead of INSERT for writes
- Include `run_id` or `execution_date` in output to enable deduplication
- Never append to a table without a deduplication step

**Backfill procedure:**
```python
# Airflow backfill example
from airflow.utils.dates import days_ago

# Backfill last 30 days
for dt in days_ago(30).to_datetime_range(end_date=days_ago(0)):
    dag_run = dag.create_dagrun(
        execution_date=dt,
        state=State.QUEUED,
        run_type=DagRunType.MANUAL,
    )
```
- Always backfill in chronological order (oldest first)
- Verify data quality after backfill before marking complete
- Document backfill ranges in DEEPDIVE.md for audit trail

**Schema evolution:**
- Use a schema registry (Confluent Schema Registry, AWS Glue) for Avro/Protobuf
- For SQL: use migration tools (Alembic, Flyway) with backward-compatible changes
- Never drop a column that downstream consumers might still read
- Add new columns as NULLABLE, backfill, then add NOT NULL constraint

**DAG/task testing:**
```python
# Airflow task test
def test_extract_task():
    """Test that extract task produces expected output."""
    dag = create_dag()
    task = dag.get_task('extract_users')
    
    # Mock external API
    with mock.patch('requests.get') as mock_get:
        mock_get.return_value.json.return_value = sample_data
        result = task.execute(context={})
    
    assert len(result) == 100
    assert all('email' in row for row in result)
```
- Test every task in isolation with mocked dependencies
- Test DAG structure (no cycles, correct dependencies) with `dag.test()`
- Test end-to-end with a small sample dataset in CI

**Data quality checks:**
```python
# Great Expectations example
import great_expectations as ge

df = ge.read_csv('users.csv')
df.expect_column_values_to_be_unique('user_id')
df.expect_column_values_to_be_between('age', 0, 150)
df.expect_column_values_to_match_regex('email', r'^[\w\.-]+@[\w\.-]+\.\w+$')
```
- Run data quality checks after every load, before downstream tasks
- Quarantine bad records to a `dead_letter` table, don't fail the pipeline
- Alert on data quality regression (e.g., null rate increases >5%)

### 53.4 CLI Tools

CLI tools must be installable, discoverable, and predictable. Exit codes and output formats are part of the API.

**CLI argument design:**
```python
# Typer (Python) — recommended for new projects
import typer

app = typer.Typer()

@app.command()
def process(
    input_file: Path = typer.Argument(..., help="Input file path"),
    output: Path = typer.Option(None, "--output", "-o", help="Output file"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose output"),
):
    """Process input file and write results."""
    ...
```
- Use `--long-name` for all options, `-s` short aliases for common ones
- Every option must have a `help` string
- Use `typer.Argument` for required positional args, `typer.Option` for flags

**Exit codes:**
| Code | Meaning | When to Use |
|------|---------|-------------|
| 0 | Success | Command completed successfully |
| 1 | General error | Unspecified failure |
| 2 | Misuse of command | Invalid arguments, missing required options |
| 126 | Permission denied | File not executable, access denied |
| 127 | Command not found | Subcommand doesn't exist |
| 130 | Interrupted | User pressed Ctrl+C |

**stdout vs stderr discipline:**
- Write machine-readable output to `stdout` (JSON, CSV, plain text)
- Write human-readable messages (progress, warnings, errors) to `stderr`
- Never mix machine output and human messages on the same stream
- Use `--quiet` flag to suppress human messages, `--json` for machine output

**Shell completion:**
```bash
# Generate completion scripts
typer mycli utils completion --install
# Or manually:
mycli --show-completion bash > /etc/bash_completion.d/mycli
```
- Generate completion scripts for bash, zsh, fish, PowerShell
- Include completion installation in README
- Test completion in CI with `complete -p mycli`

**Distribution:**
```toml
# pyproject.toml
[project.scripts]
mycli = "mycli.main:app"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```
- Publish to PyPI (Python) or npm (Node.js) with semantic versioning
- Include `CHANGELOG.md` with every release
- Sign releases with GPG for security-sensitive tools

**Man pages / docs generation:**
```bash
# Generate man pages from Typer CLI
typer mycli utils docs --name mycli --output docs/man/
# Or use cobra (Go)
cobra-cli gen-docs --dir docs/
```
- Generate man pages and HTML docs from CLI definitions
- Include `--help` output in README
- Keep docs in sync with code — regenerate on every release

### 53.5 Static Sites / Documentation

Static sites have no backend, no database. Content is the product. SEO, accessibility, and link integrity are critical.

**Static site generator choice:**
```
Jekyll      — Ruby, GitHub Pages native, simple blogs
Hugo        — Go, fastest build times, large sites
MkDocs      — Python, technical documentation, Material theme
Docusaurus  — React, versioned docs, i18n, Facebook
Astro       — JavaScript, content-focused, islands architecture
```

**Content versioning:**
```yaml
# MkDocs mike (versioned docs)
mike deploy --push --update-aliases 1.0 latest
mike set-default --push latest
```
- Use `mike` (MkDocs) or Docusaurus versioning for multi-version docs
- Keep `latest` alias pointing to most recent stable release
- Never delete old versions — archive them

**Documentation search:**
```
Algolia DocSearch  — Free for open source, hosted
Lunr.js            — Client-side, no server needed
Meilisearch        — Self-hosted, typo-tolerant
```
- Enable search on every documentation site
- Index all pages including API reference
- Test search with common queries (installation, quickstart, troubleshooting)

**SEO meta tags:**
```html
<!-- Every page must have these -->
<title>Page Title — Site Name</title>
<meta name="description" content="150-160 character description">
<meta property="og:title" content="Page Title">
<meta property="og:description" content="Description">
<meta property="og:image" content="https://example.com/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://example.com/page-url">
```
- Every page must have unique title, description, og:image
- Use canonical URLs to prevent duplicate content
- Validate with Google Search Console after deployment

**Link checking:**
```yaml
# CI link check
- name: Check links
  run: |
    pip install htmlproofer
    htmlproofer ./_site --check-html --check-external-hash
```
- Run link checker in CI on every PR
- Check internal links, external links, and image references
- Fail the build on broken links

**Multi-language support (i18n):**
```yaml
# MkDocs i18n config
plugins:
  - i18n:
      default_language: en
      languages:
        en: English
        es: Español
        fr: Français
```
- Use `i18n` plugin (MkDocs) or Docusaurus i18n for multi-language docs
- Translate navigation, not just content
- Use professional translation services for user-facing docs, not machine translation

**Preview deployments:**
```yaml
# Netlify preview (netlify.toml)
[build]
  publish = "_site"
  command = "jekyll build"

# Vercel preview (vercel.json)
{
  "github": {
    "silent": true
  }
}
```
- Enable PR previews on Netlify, Vercel, or Cloudflare Pages
- Post preview URL as PR comment automatically
- Never merge without reviewing the preview deployment

### 53.6 Language-Agnostic Patterns

These patterns apply regardless of programming language.

**Java / Kotlin:**
```
Build:       Maven or Gradle (Gradle preferred for new projects)
Testing:     JUnit 5 + Mockito (unit), Testcontainers (integration)
Formatting:  Google Java Format or ktlint (Kotlin)
Static:      SpotBugs, Error Prone, detekt (Kotlin)
```
- Use `mvn verify` or `./gradlew check` in CI
- Enforce code style with `spotless` plugin
- Use `@Nullable` / `@NonNull` annotations for null safety

**Swift:**
```
Build:       Xcode or Swift Package Manager
Testing:     XCTest (unit), XCUITest (UI)
Formatting:  SwiftFormat
Static:      SwiftLint
```
- Use `swift test` in CI for SPM projects
- Enforce SwiftLint rules in pre-commit hooks
- Use `async/await` for concurrency (Swift 5.5+)

**Rust:**
```
Build:       cargo
Testing:     cargo test (unit + integration), proptest (property-based)
Formatting:  rustfmt
Static:      clippy (mandatory)
```
- Run `cargo clippy -- -D warnings` in CI — treat warnings as errors
- Use `cargo fmt --check` in pre-commit hooks
- Use `#[must_use]` on functions returning `Result` or `Option`

**C / C++:**
```
Build:       CMake or Make
Testing:     Google Test (C++), Unity (C)
Formatting:  clang-format
Static:      cppcheck, clang-tidy, Coverity
```
- Use `cmake --build . --target test` in CI
- Enforce MISRA-C or CERT-C for safety-critical code
- Use AddressSanitizer and UndefinedBehaviorSanitizer in CI

### 53.7 Template Coverage and Out-of-Scope

This template is **best suited for:**
- Web services (REST APIs, full-stack apps)
- Python projects (FastAPI, Django, Flask)
- JavaScript/TypeScript projects (Node.js, React, Next.js)
- Go projects (Gin, Echo)
- Microservices architectures
- Cloud-native deployments (Docker, Kubernetes)

**Partial coverage** (use this template as a foundation, add domain-specific sections):
- CLI tools (Section 53.4 covers basics)
- Embedded firmware (Section 53.2 covers basics)
- Data pipelines (Section 53.3 covers basics)
- Static sites (Section 53.5 covers basics)
- Mobile apps (Section 53.1 covers basics)

**Out of scope** (not covered by this template):
- Game development (Unity, Unreal, Godot)
- Browser extensions (Chrome, Firefox, Safari)
- Desktop applications (Electron, Tauri, native)
- Blockchain / smart contracts (Solidity, Rust on Solana)
- Hardware design (PCB layout, FPGA)
- Scientific computing (MATLAB, R, Julia)

**When to extend this template:**
If your project type is "partial coverage" or "out of scope," create a `docs/PROJECT_TYPE_EXTENSION.md` file that adds domain-specific patterns. Reference this AGENTS.md as the foundation and extend with project-type-specific rules.

---

## Change Log

| Date | Change |
|------|--------|
| 2026-06-03 | Initial standardized AGENTS.md from 21 project AGENTS.md files |
| 2026-06-03 | Added Section 21: AI Agent Instruction Guidance from AgentBench/CAMEL research |
| 2026-06-03 | Added tests/docs/research folder requirements, tests/ always gitignored, auto-commit after validation, rogue prevention rule |
| 2026-06-03 | Added comprehensive pre-commit lint/vulture sweep requirement |
| 2026-06-03 | Added human-sounding commit message guidelines with WHY-focused pattern |
| 2026-06-03 | Added DEEPDIVE.md requirement for living system narrative documentation |
| 2026-06-03 | Added Sections 22-26: Multi-agent patterns, verification gates, failure modes, common gotchas, getting help |
| 2026-06-03 | Added Section 27: Comprehensive code quality standards (Python idioms, anti-patterns, security, performance, testing, error handling) |
| 2026-06-03 | Added Section 28: Default tech stack playbook (FastAPI, Next.js, Gin, databases, decision tree, anti-recommendations) |
| 2026-06-03 | Added Sections 29-32: Operational patterns (circuit breaker, DLQ, middleware, semantic cache), health endpoint spec, production security (prompt injection, audit logging, key encryption, IP whitelist, CI workflow), Docker support (Dockerfile, compose, Kubernetes) |
| 2026-06-19 | Added Sections 33-36: PR & change size standards (800-line max, single feature, draft conventions, first-time contributor path), AI code quality anti-pattern detection (think first, spot laziness/uncertainty/bloat, accountability chain, module/file size bounds, platform support), PR description format & template (HUMAN/AGENT sections, mandatory elements, forbidden elements), explicit "NEVER" list (code, git, GitHub, testing, documentation, AI agent prohibitions) |
| 2026-06-19 | Added Sections 37-41: Pre-commit hook standards (MANDATORY gate, standard config template, hook catalog, enforcement policy, detect-secrets baseline), CI/CD pipeline standards (ci.yml, release.yml, deploy.yml, SHA-pinning convention, PR/issue templates, branch protection rules), semantic versioning & changelog (semver rules, Keep a Changelog format, conventional commits mapping, git tags, release automation), code coverage enforcement (80% floor, branch coverage, CI fail-under gate, exclusions policy, coverage limitations), observability standards (structured JSON logging, OpenTelemetry distributed tracing, Prometheus metrics, correlation IDs, PII redaction, SLOs with error budgets) |
| 2026-06-19 | Added Sections 42-45: Infrastructure as Code (Terraform/OpenTofu structure, provider config, multi-env pattern, state management rules, pre-deploy checklist), database backup & recovery (Grandfather-Father-Son retention, pg_dump implementation, restore procedure, backup verification, off-site replication, monitoring), secrets management (tiered strategy from .env to Vault, SOPS+Age encryption, rotation pattern, CI scanning, security rules), flaky test management (Google's four sources of flakiness, detection with pytest-rerunfailures, quarantine mechanism, remediation strategies, test isolation principles) |
| 2026-06-19 | Added Sections 46-49: Mutation testing (mutmut setup, CI integration, arid node configuration, mutation score interpretation, targeted mutation testing), performance benchmark testing (pytest-benchmark, time budget assertions, CI regression detection, what to benchmark), contract testing with Pact (consumer-driven contracts, provider verification, CI integration with Pact Broker, versioning, what to contract test), chaos engineering (Netflix principles, experiment design template, failure injection patterns, experiment library, game day checklist, readiness assessment) |
| 2026-06-19 | Added Section 50: Intentional Minimalism — the simplicity-first architecture. Decision ladder (YAGNI→stdlib→native→existing dep→one line→minimum code), structured tradeoff comments with named ceilings and upgrade triggers, safety carve-outs defining domains never subject to minimalism (input validation, data loss prevention, security, accessibility, hardware calibration, explicit requests), code-first output discipline with ≤3-line explanations, over-engineering review vocabulary (delete/stdlib/native/yagni/shrink tags with net-line summaries), honesty boundaries preventing agents from making invalid claims (per-repo savings, unmeasured performance, unconfirmed bug fixes), tests-are-not-bloat exemption policy, and self-referential governance for AGENTS.md itself |
| 2026-06-19 | Added self-referential governance header: AGENTS.md covers its own maintenance — agents editing it must follow all rules herein |
| 2026-06-19 | Added Section 51: Instruction Architecture — trigger-based lazy loading (frontmatter triggers, domain-specific guides, simplest approach with docs/AGENT_DOMAIN_*.md), self-maintaining meta-instructions (agent proposes rule additions when user intervenes, signals for when to add vs what NOT to add), context budget awareness (2,000 line max, 5,000 token budget, 70% headroom minimum, size monitoring, trimming strategy), model capability awareness (tiered detail levels FULL/STANDARD/COMPACT, per-model-family quirks, fallback condensed appendix), instruction provenance tracking (annotated source citations, link-to-standard, date marking, periodic audit) |
| 2026-07-01 | Self-audit: created DEEPDIVE.md, TODO.md, CHANGELOG.md, Dockerfile, docker-compose.yml, .env.example, .pre-commit-config.yaml, requirements-dev.txt, pytest.ini. Added GitHub infra: ci.yml, release.yml, PULL_REQUEST_TEMPLATE.md, ISSUE_TEMPLATE/, CODEOWNERS, dependabot.yml. Fixed duplicate 3.9 in STARTUP.md. Synced 7 platform configs to reference Sections 33/37/50.1/50.2. Removed duplicate .claude/projects/anchor.json. Rewrote audit script: cached reads, --strict mode, structural skip rule, scenario assertions, platform config presence check. Updated .gitignore to ship the audit script. |
| 2026-07-01 | Added Section 52: Rule Enforcement Architecture — the two-layer model (soft advisory vs hard deterministic), compiling prose rules into hooks (PreToolUse, pre-commit, CI gates), pre-commit hooks as universal hard-layer enforcement with compiled rule table, runtime hook architecture for Claude Code/Codex with deny/allow/ask permission tiers, evidence-first methodology requiring file:line citations for all claims, behavioral rule compliance testing (tests/compliance/test_rule_enforcement.py), structured rule formats with YAML frontmatter and detection patterns, CI-based rule enforcement gates with compliance report generation, hook compilation quick reference mapping all AGENTS.md sections to enforcement mechanisms by priority |
| 2026-07-01 | Added Section 53: Project Type Patterns — language-agnostic and project-type-specific patterns for mobile apps (iOS/Android/React Native: platform testing, push notifications, offline behavior, permissions, crash reporting, app size budgets, E2E testing), embedded firmware (C/C++/Rust: cross-compilation toolchains, static analysis with cppcheck/clang-tidy, code formatting with clang-format, interrupt handler discipline, flash/ROM size tracking, OTA updates), data pipelines/ETL (idempotency, backfill procedures, schema evolution, DAG/task testing, data quality checks with Great Expectations), CLI tools (argument design with Typer, exit codes, stdout/stderr discipline, shell completion, distribution to PyPI/npm, man page generation), static sites/documentation (SSG choice: Jekyll/Hugo/MkDocs/Docusaurus/Astro, content versioning with mike, documentation search, SEO meta tags, link checking, multi-language i18n, preview deployments). Added language-agnostic patterns for Java/Kotlin (Maven/Gradle, JUnit 5, SpotBugs), Swift (Xcode/SPM, XCTest, SwiftLint), Rust (cargo, clippy, rustfmt), C/C++ (CMake, Google Test, clang-format, cppcheck). Added template coverage scope (Section 53.7) explicitly listing well-covered, partial, and out-of-scope project types. Updated Section Index and Quick-Navigation Cheatsheet with Project Types entry. |
| 2026-07-01 | Added Ruler integration: .ruler/ directory with ruler.json config, README with sync/install instructions, and initial rule files (01-core-principles, 02-commit-protocol, 03-pr-standards) for distribution to 30+ AI coding agents via the Ruler framework |
| 2026-07-01 | Added instruction provenance tags to Section 21 (AgentBench, CAMEL — links to `research/papers/full/`) per Section 51.5 |
| 2026-07-01 | Added Section 36.4a — explicit "GitHub Automation NEVER" (no Actions workflows, no dependabot, no bot PRs) without per-file user approval. Removed `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml` that were created without explicit approval. Updated Section 2 and Section 38 to defer to 36.4a. |