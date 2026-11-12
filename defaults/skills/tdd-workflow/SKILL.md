---
name: tdd-workflow
description: Test-guided development workflow with RED-GREEN-REFACTOR cycle, regression-test selection, and versioned E2E testing patterns (Playwright). Use for non-trivial features, bug fixes, refactors, API/UI behavior changes, or E2E test infrastructure; skip the full TDD ceremony for tiny documentation, formatting, or obvious one-line mechanical changes.
origin: ECC
---

# Test-Guided Development Workflow

Use TDD where it buys confidence without turning small edits into ceremony. The goal is one useful regression signal for non-trivial behavior, not tests for tests' sake.

> Atomic test-quality rules (AAA, mock boundaries, brittle assertions, testing anti-patterns) live in the `code-rules` skill. This skill is the TDD *flow* and E2E setup.
>
> **Scope**: development stage (RED-GREEN-REFACTOR) and versioned E2E tests running on CI/CD. For ad-hoc visual verification of a live environment, use the `browser-qa` skill.

## When to Activate

- Writing non-trivial features or functionality
- Fixing bugs where a reproducer can be captured
- Refactoring existing behavior
- Adding API endpoints or UI components with user-visible behavior
- Setting up E2E test infrastructure

## Core Principles

1. **Prefer tests before code** for new behavior and reproducible bugs.
2. **Minimum useful check** — non-trivial logic needs one runnable check that fails if the logic breaks; trivial text/format/one-line mechanical edits may use self-review only.
3. **Coverage target** — follow the project's configured threshold. If none exists, do not invent a numeric target; add focused coverage for the changed behavior.
4. **Choose the cheapest test level that proves the behavior**: unit for pure logic, integration for boundaries, E2E for critical user flows.
5. **Git checkpoints are optional** — commit only when the user asked for commits or the workflow explicitly requires them.

## TDD Cycle: RED-GREEN-REFACTOR

### Step 1: Write failing test (RED)

- Write the test that describes the desired behavior
- Run it. It MUST fail for the right reason
- A test that was only written but not executed does NOT count as RED
- The failure must be caused by missing/broken business logic, not syntax errors or broken setup

Optional commit, only when commits were requested: `test: add reproducer for <feature or bug>`

### Step 2: Minimal implementation (GREEN)

- Write the MINIMUM code to make the test pass
- No refactoring, no "while I'm here" improvements
- Run the test. It MUST pass now

Optional commit, only when commits were requested: `fix: <feature or bug>` or `feat: <feature>`

### Step 3: Refactor

- Improve code quality while keeping tests green
- Remove duplication, improve naming, optimize
- Run tests after every change

Optional commit, only when commits were requested: `refactor: clean up <feature>`

### Step 4: Verify coverage

- Run the project's coverage command
- Ensure the configured threshold is met
- If not, add tests for uncovered paths

## Test Type Guidelines

### Unit tests
- Individual functions, utilities, hooks, pure logic
- Mock all external dependencies (DB, APIs, file system)
- Fast (<50ms per test)
- Test behavior, not implementation

### Integration tests
- API endpoints, DB operations, service interactions
- Use real (or in-memory) DB when practical
- Test request -> response cycle end-to-end
- Test auth, validation, and error scenarios

### E2E tests (Playwright)

#### Architecture
- **Page Object Model (POM)**: one class per page/component, encapsulates selectors and actions
- **Fixtures**: reusable setup (auth state, test data) via Playwright fixtures
- **File organization**: `tests/e2e/<feature>/<flow>.spec.ts`

#### Configuration principles
- `fullyParallel: true` for speed
- `retries: 2` in CI, `0` locally
- `trace: 'on-first-retry'` for debugging
- `screenshot: 'only-on-failure'`
- `video: 'retain-on-failure'`

#### Selector priority
1. `data-testid` attributes (most stable)
2. Semantic selectors: `role`, `text`, `label`
3. CSS selectors (last resort)

Never use: fragile CSS class names, XPath, positional selectors

#### Flaky test prevention
- Never use `waitForTimeout` — wait for specific conditions (network response, element state)
- Use auto-waiting locators: `page.locator().click()` instead of `page.click()`
- Wait for `networkidle` after navigation
- Use `toBeVisible()` assertions instead of `toHaveCount()`

#### Flaky test quarantine
- Tag with `test.fixme()` referencing the issue
- Use `test.skip()` for environment-specific flakiness
- Run `--repeat-each=10` to verify stability before un-quarantining

## CI Integration

- Tests run on every PR (block merge on failure)
- Coverage report uploaded as artifact
- E2E tests run against preview/staging deployment
- Playwright report + traces archived for debugging
