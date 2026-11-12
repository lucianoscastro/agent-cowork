# Test gaps check catalog

| ID | Check | Base severity | Evidence to review |
|---|---|---:|---|
| TST01 | Critical business rules | Critical | Pricing, fees, discounts, payments, balances, quotas, eligibility and status transitions: each has tests asserting its outcomes, including boundaries. |
| TST02 | Endpoints that change data | High | Create, update, delete and action endpoints: at least one test per endpoint for success and for invalid input. |
| TST03 | Authorization paths | Critical | Tests proving that a user without the role, or from another tenant, is refused on protected endpoints. |
| TST04 | Error and edge paths | Medium | Tests for empty inputs, nulls, limits, duplicates, timeouts and failures of dependencies on tested features. |
| TST05 | Tests that cannot fail | High | Tests with no assertions, assertions only on mocks being called, `expect(true)`, snapshot-only tests of logic, catch blocks that hide failures. |
| TST06 | Over-mocking | Medium | Tests that mock the unit under test, or so much of it that the real logic never runs; repositories mocked where an in-memory or container database is the real risk. |
| TST07 | Flaky patterns | Medium | Fixed sleeps, real clocks and time zones, random data without seeds, order dependence between tests, shared mutable fixtures, real network calls. |
| TST08 | Skipped and disabled tests | Medium | `skip`, `only`, `[Fact(Skip=…)]`, `[Ignore]`, commented-out tests, test projects excluded from CI. |
| TST09 | Regression tests for past bugs | Medium | Fix commits (`fix:`, `bug`) touching code without a test added in the same change. Sample the recent history; `ATTENTION` when history is unavailable. |
| TST10 | Integration and contract coverage | Medium | Database access, queues and external APIs covered by at least integration tests or contract tests; migrations exercised. |
| TST11 | Frontend behavior tests | Medium | Key screens and forms tested through user behavior (Testing Library, Playwright), not only snapshots or implementation details. |
| TST12 | Tests in CI | High | CI runs every test project on pull requests and fails the build on test failure; no `continue-on-error` or ignored exit codes. |

## Stack notes

- **.NET**: xUnit/NUnit projects referenced by the solution, `WebApplicationFactory` integration tests, Testcontainers, `[Theory]` data for boundaries.
- **Node.js**: Jest/Vitest projects and configs (several configs can split unit, component and integration runs), supertest for endpoints.
- **React**: Testing Library queries by role and label, MSW for network, Playwright or Cypress for flows.
