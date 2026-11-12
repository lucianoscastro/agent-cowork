---
name: code-rules
description: "Canonical coding rulebook for TypeScript, JavaScript, React, and Node.js — the engineering principles (Readability, KISS, DRY, YAGNI) plus the atomic checkable rules they produce: types, naming, React components, testing, code smells, and anti-patterns. Use when writing or reviewing TS/JS/React code, settling a DRY-vs-clarity or abstraction tradeoff, or detecting code smells."
origin: custom
---

# Code Rules

The canonical rulebook for TypeScript/JavaScript/React/Node.js: the principles that guide judgment calls, then the atomic rules they produce. Each rule is a single do/don't, verifiable on one line or one file.

For architecture decisions see `frontend-patterns` / `backend-patterns`; for the TDD flow see `tdd-workflow`.

## When to Activate

- Writing or reviewing TypeScript/JavaScript/React code
- Enforcing consistency across a codebase
- Detecting code smells
- Deciding whether an abstraction is worth introducing, or settling a DRY-vs-clarity tradeoff

## Principles

The *why* behind the rules below. Use these when a decision has no mechanical answer and you have to weigh tradeoffs.

1. **Readability > Cleverness** — code is read 10x more than written. Optimize for the next reader, not for keystrokes. A clever one-liner that needs a comment to explain it is a bug in waiting.
2. **KISS** — the simplest solution that works. When two designs solve the problem, ship the one with fewer moving parts.
3. **DRY** — abstract only after 3+ repetitions, not preemptively. Two similar blocks are cheaper than the wrong abstraction; a bad coupling is far more expensive to undo than a duplication.
4. **YAGNI** — don't build for hypothetical requirements. Speculative generality is dead weight until the second real use case appears.

Applying them:

- When DRY and Readability conflict, Readability wins — a small duplication beats an abstraction that hides intent.
- When KISS and YAGNI point the same way, that is the strongest signal to cut scope.
- "We might need it later" is not a requirement. Build it when "later" arrives.
- An abstraction must pay for the indirection it adds. If it doesn't, inline it.

## TypeScript Rules

### Types
- Explicit return types on exported functions
- No `any` — use `unknown` + type guards when type is truly unknown
- Union types for known variants: `'active' | 'closed'` over `string`
- Interfaces for object shapes, type aliases for unions/primitives
- Prefer `readonly` for properties that shouldn't change after construction

### Naming
- camelCase: variables, functions, methods
- PascalCase: types, interfaces, classes, components, enums
- UPPER_SNAKE: constants and environment variables
- Verb-noun for functions: `fetchUser`, `calculateTotal`, `isValid`
- Boolean prefixes: `is`, `has`, `should`, `can`

### Patterns to enforce
- `const` by default, `let` only when reassignment is needed, never `var`
- Spread operator for immutable updates (`{ ...obj, key: value }`)
- Early returns to avoid deep nesting
- `Promise.all` for independent async operations (not sequential await)
- Nullish coalescing (`??`) over logical OR (`||`) for defaults
- Optional chaining (`?.`) over manual null checks

## Code Smell Detection

Flag these on sight:

| Smell | Signal | Fix |
|---|---|---|
| **Long function** | >50 lines or >3 levels of nesting | Extract sub-functions |
| **God object** | Class/module doing 5+ unrelated things | Split by responsibility |
| **Magic numbers** | Bare `500`, `3`, `86400` in logic | Named constants |
| **Boolean params** | `doThing(true, false, true)` | Options object or separate functions |
| **Catch-all error** | `catch(e) {}` or `catch(e) { console.log(e) }` | Handle specific errors, rethrow unknown |
| **Premature abstraction** | Utility/helper used exactly once | Inline it |
| **Deep prop drilling** | Props passed through 3+ components | Context, composition, or state library |
| **Comment explaining what** | `// increment counter` above `count++` | Delete the comment |
| **Comment explaining why** | Business context not obvious from code | Keep the comment |
| **Dead code** | Commented-out code, unused exports | Delete it (git has history) |

## React Rules

- Functional components only (no class components for new code)
- Props explicitly typed via interface (no `any`, no implicit children)
- No business logic in components — extract to hooks or services
- No `useEffect` for derived state — compute inline or `useMemo`
- No `useEffect` to sync state with props — usually a design problem
- No fetching in `useEffect` without cleanup/cancellation
- No `index` as key in dynamic lists
- No ternary chains in JSX — extract to named components
- No direct DOM manipulation (`document.querySelector`) — use refs
- No prop drilling through 3+ levels — use Context or composition
- Error boundaries around major UI sections
- Loading, error, and empty states always handled

## Testing Rules

- Test behavior, not implementation details
- AAA pattern: **Arrange** (setup) -> **Act** (execute) -> **Assert** (verify)
- One assertion focus per test (multiple `expect` for the same behavior is fine)
- Descriptive test names: `"returns empty array when no results match"` — not `"works"`
- Mock at system boundaries (external APIs, DB, file system); never mock internal functions
- Use dependency injection to make mocking easy
- No shared mutable state between tests
- Cover error paths, not just the happy path
- One test file per unit — do not bundle unrelated units
- Prioritize user-facing behavior over exhaustive internal-utility tests
- No brittle assertions: `toBe` on timestamps, floating point, or order-dependent arrays
- No over-mocking (testing mock behavior instead of real behavior)
- No `console.log` left in committed tests
- Never disable or skip a test without a linked issue

## Anti-Patterns

- `any` in TypeScript
- Mutating function arguments
- Side effects in pure functions
- Synchronous heavy computation on the main thread
- String concatenation for SQL/HTML (injection risk)
- Hardcoded secrets, URLs, or environment-specific values
- Importing from `node_modules` internals (`lib/`, `dist/`, `src/`)
- `console.log` as error handling
