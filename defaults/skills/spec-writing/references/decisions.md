# Decisions

An ADR records one hard-to-reverse decision of one card, with the alternatives it beat. It is attached to the card with the other documents, and the platform records it in the project brain, so every later card and agent reads it.

## Read the recorded decisions first

- Before specifying, read the project's recorded decisions: the brain notes in the run's prompt, and any ADRs or decision log the repositories keep themselves (read only).
- Each one constrains the spec. Conform, or depart from it with a new ADR whose `Context` names the old decision and why it no longer holds: never depart silently.
- A reason to depart that is a product trade-off is a person's: ask it ([questions.md](questions.md)) before writing the ADR.

## When an ADR

Only for a one-way door: a decision whose reversal costs more than a refactor.

- a persisted schema: a new table or collection, identifier width, uniqueness, nullability over a populated table
- a contract someone consumes: a route, an event, a webhook payload, a file format, a field a consumer binds to
- a new dependency or external service
- a backfill or a data migration
- a pattern the codebase does not have yet (a queue, a cache layer, a new way to authorise)

Not doors, so no ADR: scope, rules with no persisted mechanism, names, placement and types inside the repository's conventions. Those are settled in the spec or the diff. Each `Landing` row in `spec.md` links its ADR.

## Numbering and status

- **ADR-NN**: two digits, numbered within the card (`ADR-01`, `ADR-02`). Elsewhere it is named with its card: `ABC-123 ADR-01`.
- **File**: `spec/ADR-NN-<slug>.md`, slug lowercase with dashes, next to `spec.md`.
- **Status**: `Accepted`. A new version of the card's documents edits its own ADRs in place; a later card departs from one with an ADR of its own, never by editing it.

## Writing an ADR

- `Context` holds facts from the code with their paths, the constraint, and the card it came from. No solution inside it.
- `Decision` is the literal shape the next person copies: the column and its type, the route and its payload, the file's encoding and columns. Specific enough to build without asking.
- `Alternatives Considered` holds the real options, each with the property that disqualified it. One alternative is fine; none means it was not a decision.
- `Consequences` are honest: the negative and the risks, each risk with its mitigation.
- No secrets, hosts, credentials or personal data.

## Template: `spec/ADR-NN-<slug>.md`

```markdown
# ADR-NN: <the decision as a short statement>

## Status

Accepted

## Date

YYYY-MM-DD

## Context

<What forces the decision: the problem, the constraints, the facts from the code with their paths. From card <CARD>, see [spec.md](spec.md).>

## Decision

<What is decided, as its literal shape: the schema, the contract, the format, the dependency and version.>

## Alternatives Considered

### <Alternative>

- **Description**: <brief>
- **Pros**: <advantages>
- **Cons**: <disadvantages>
- **Why rejected**: <the property that disqualified it>

## Consequences

### Positive

- <outcome>

### Negative

- <trade-off accepted>

### Risks

- <risk> - <mitigation>

## References

- Card <CARD>; [spec.md](spec.md) Landing
- Departs from <a recorded decision, named with its card>, or builds on one, or none
```
