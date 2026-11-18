# tasks.md

The order the Developer builds in, one task per call, with `spec.md` open beside it. After each task the platform commits it, runs each repository's must-pass commands (build, lint, tests) and checks that the tests its `## Checks` rows name are in the change, before the next task starts. So a task carries no commit, gate, proof command or approval line: it carries the change, what it waits on, and the test that proves it.

Each task also becomes a Jira sub-task of the card, named by its heading (`T1: <the deliverable>`): keep that line under 80 characters.

Skip this file for Small (<=3 obvious steps): `spec.md` then ends with a `## Tasks` list and `## Checks` (below).

## Find the repository's tests first

- Read the testing standards the repository documents (`AGENTS.md`, `CONTRIBUTING.md`, test config, CI workflows) and 3-5 existing tests in the area the card touches: where they live, the runner, how cases are named, which level (unit, integration, end-to-end) covers which layer.
- Existing tests are the floor for style and placement, not a ceiling: every criterion still gets its test.
- Never invent a runner, a helper or a command. Where the area has no tests, name the nearest convention in the repository and say so in the task.

## Break it down

**One task = one deliverable**: one function, one endpoint, one component, one migration, one file change. "Implement the export" is not a task.

| Too vague | Atomic |
|---|---|
| Add CSV export | T1 range validation; T2 CSV writer; T3 export endpoint; T4 Export button and download |
| Handle permissions | T5 deny the export to users without the `finance` role |

Two or three related changes in one file are fine when cohesive; several components or files mean split it.

**Fields per task:**

- **What**: one sentence, the exact deliverable.
- **Where**: the repository and path, marked `(new)` or `(modify)`. In a multi-repository project every task names its repository.
- **Reuses**: existing code or a pattern to follow, with its path. Optional, but it saves the builder a search.
- **Depends on**: the task ids that must land first, or `none`.
- **Test**: the level, the file, and the case named by the outcome it asserts, e.g. `unit, src/orders/export-range.test.ts: "rejects a 32-day range with range_too_long"`. The test asserts the criterion's value, never the implementation.
- **Covers**: the criteria it delivers (`AC1, AC2`).

**Tests live in the task that creates the code.** Never a later "write the tests" task. When code cannot be tested until a later task lands (an endpoint that needs its route registered), merge the two, forward or backward: no task leaves unproven code. `Test: none - <why>` only for a task with no behaviour of its own (a type, a config entry, a dependency bump), and the reason says which test exercises it.

**Each task leaves the build green on its own**: the must-pass commands run after every task, so a task never depends on a later one to compile, lint or pass its tests.

**Order by dependency**: stored data and contracts first, then the rules, then the surfaces that show them. In a multi-repository change, the repository that produces a contract comes before the one that consumes it. A task never depends on a later one, and no task depends on an open question.

**Ids are stable**: `T1`..`Tn`, never renumbered on a revision; a new task takes the next number and a dropped one leaves a gap. The list order is the build order.

## Checks

One row per criterion, every criterion: `| Criterion | Proven by | Task |`. The test named is the one the task wrote, by file and case.

- The `Task` column names the task that writes the test: the platform checks the row when that task is built (and every row after the last one).
- A suite going green settles no single criterion: name the case.
- One test may prove several criteria; one criterion may need two tests (the rule, and the screen that shows it). Every criterion has at least one.
- A criterion no automated test can settle is not ready: go back to `spec.md` and rewrite it until one can.

## Before finishing

- Every `AC` in `spec.md` appears in some task's `Covers` and in `## Checks`; every `Covers` id exists in the spec.
- Every `Depends on` points to an earlier task.
- Every task has a `Test` that follows the repository's convention, or `none` with its reason.

## Template: `spec/tasks.md`

```markdown
# <CARD>: <Feature> - Tasks

**Spec**: [spec.md](spec.md)
**Design**: [design.md](design.md) <only Large and Complex>

## Tasks

### T1: <the deliverable>

- **What**: <one sentence, the exact deliverable>
- **Where**: `<repository>`: `<path>` (new)
- **Reuses**: `<path>` - <what to follow>
- **Depends on**: none
- **Test**: <unit|integration|e2e>, `<test file>`: "<case named by the outcome>"
- **Covers**: AC1, AC2

### T2: <the deliverable>

- **What**: <one sentence>
- **Where**: `<repository>`: `<path>` (modify)
- **Depends on**: T1
- **Test**: <level>, `<test file>`: "<case>"
- **Covers**: AC3

## Checks

| Criterion | Proven by | Task |
|---|---|---|
| AC1 | `<test file>`: "<case>" | T1 |
| AC2 | `<test file>`: "<case>" | T1 |
| AC3 | `<test file>`: "<case>" | T2 |
```

## Small: inside spec.md

```markdown
## Tasks

1. **T1** <the deliverable> - `<repository>`: `<path>` (modify) - test: `<test file>`: "<case>" - covers AC1
2. **T2** <the deliverable> - `<path>` (new) - depends on T1 - test: `<test file>`: "<case>" - covers AC2

## Checks

| Criterion | Proven by | Task |
|---|---|---|
| AC1 | `<test file>`: "<case>" | T1 |
| AC2 | `<test file>`: "<case>" | T2 |
```
