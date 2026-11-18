---
name: spec-writing
description: "Turns one card or request into the documents an agent builds from, with no human in the loop: spec.md (problem, EARS criteria with concrete values, out of scope, assumptions, open questions, and the path, data and one-way doors when they apply), design.md, ADRs and tasks.md (ordered atomic tasks, a test each, a check per criterion), sized to the work. Gray areas are returned as numbered questions for people to answer, never guessed. Use when writing spec documents for a card, when answers to earlier questions arrive or people ask for a new version, and when reviewing such documents before they are attached to the card."
metadata:
  origin: "adapted"
---

# Spec Writing

One card in; the documents a builder needs out. The builder is another agent with none of this context: what is not written is not built, and what is guessed is built wrong.

The common failure starts here: a requirement that never became an obligation. A gray area settled by guessing, a sentence of the card that landed nowhere, a criterion no single test can settle. This skill produces the whole brief the Developer builds from, and what the people reviewing its pull request check the code against.

## When to Activate

- Turning a card, ticket or request into spec documents for an agent to build
- Continuing a card after its questions were answered on the card
- Writing a new version when people put the card back for one
- Reviewing such documents before they are attached: read [references/review.md](references/review.md)

## Where you work

- **Read only**: every checkout of the project's repositories. Read the code; never change it, and run no builds, installs or tests.
- **Only the documents.** Write them in the work folder the run's prompt names (`spec/`), or return them in your answer when the prompt says the platform saves them. No code, config or other docs.
- **No commits, pushes, pull requests or card changes.** The platform attaches the folder's files to the card and hands the card to the Developer. When a project wants a person to approve the documents first, that happens on the card, outside them, so write no approval lines: the people reviewing the code check it against these documents.
- **Nobody answers during the run.** Never wait for an answer and never write on a guess. Gray areas go back as questions ([references/questions.md](references/questions.md)): the platform posts them in one batch, people answer, and the next run continues from the answers.

## Layout

```text
spec/                     # the run's work folder; each file becomes an attachment of the card
├── spec.md               # always
├── design.md             # only Large/Complex: architecture, components, data
├── ADR-NN-<slug>.md      # only one-way doors, numbered within the card (ADR-01, ADR-02)
└── tasks.md              # omitted for Small (≤3 obvious steps): then spec.md ends with a ## Tasks list and ## Checks
```

- Flat: no subfolders, since every file is attached under its own name. Links between them are plain names (`spec.md`, `ADR-01-orders-export-format.md`).
- A card that already has documents: the platform downloads the latest ones into the folder before the run. Update them in place; never start over.
- Create files lazily: a file exists only when the size below calls for it. Never scaffold an empty file.

## Size it

The work decides the depth, not a fixed pipeline. Size from evidence in the code, not from the card's length.

| Size | Signals | spec.md | design.md | tasks.md |
|---|---|---|---|---|
| **Small** | one module, <=3 obvious steps, no new pattern, no stored data change | Problem, Criteria, Out of scope, Assumptions, Open questions, then `## Tasks` and `## Checks` | no | no |
| **Medium** | a clear feature, under ~10 tasks, no new pattern | full; Shape when the path crosses modules | no: the shape lives in spec.md | yes |
| **Large** | several components or repositories, new stored data, a new route or contract | full, with What is being built | yes | yes |
| **Complex** | a new domain, a new pattern, a migration, or an architecture choice with live alternatives | full | yes, with the alternatives weighed | yes |

- ADRs exist at any size, one per one-way door, and only for those ([references/decisions.md](references/decisions.md)).
- Safety valve: when a Small task list grows past 3 steps or one step depends on another, it is Medium. Write `tasks.md`.
- One card, one spec. When the card holds several unrelated changes, specify the first coherent part and list the rest under `Out of scope` with the reason.

## The method

1. **Read first.** The card whole (description, every comment, earlier answers), the documents already in the work folder, the project's recorded decisions (the brain notes in the prompt), each repository's `CLAUDE.md`, `AGENTS.md`, README and the docs it keeps about itself, and the code the card touches. ADRs or decision logs kept inside the repositories constrain the spec too.
2. **Facts you look up; decisions you ask.** What the code does, which endpoint exists, a current limit: look it up. Scope, product behaviour, a trade-off: a person's.
3. **Find the gray areas**: a decision that is a person's, has more than one defensible answer, and is not settled by the code, the card or its discussion. Before the documents exist, any one left means ask them all and write nothing yet. Anything else is an assumption you state with your default.
4. **Recover the problem**: present tense, no solution inside it, and what is different for a user when this ships.
5. **Walk the surfaces** the card exposes and write the criteria in EARS, by slice, each with a concrete value ([references/spec.md](references/spec.md)).
6. **What is being built**, when it applies: the path and its drawing, the data, what changes underneath, the surface, the one-way doors ([references/spec.md](references/spec.md)). `design.md` for Large and Complex.
7. **One-way doors** get an ADR ([references/decisions.md](references/decisions.md)).
8. **Tasks**: ordered, atomic, a test each, every criterion checked ([references/tasks.md](references/tasks.md)).
9. **Before finishing**: read the card again, one sentence at a time. Each lands on a criterion, an `Out of scope` row or an open question; a sentence that lands nowhere is the requirement that goes missing, because nobody downstream reads the card again. Then run [references/review.md](references/review.md) over your own documents and fix what it finds.

## Rules

1. **A criterion is one observable outcome with a concrete value** (a status code, a field, a bound, a label) that one test run settles. "Gracefully", "fast" or a percentile is not a criterion.
2. **Gray areas are asked, never assumed.** An assumption never stands in for a question to save a round trip. `Confirmed? y` only when a person said so on the card or in the review, citing where (`card: Q2 b`), never who.
3. **Asking clarifies how, not whether** to add a capability. A capability the card does not ask for goes to `Out of scope` with its reason.
4. **Rules that change what a user sees run where the tests reach.** Filtering, searching, sorting and counting are rules, not presentation.
5. **Decide only what is hard to reverse**, with its literal shape. Names, placement and types inside the repository's conventions are the builder's, settled in the diff.
6. **Every decision the project already recorded binds** (brain notes, the repositories' ADRs or decision logs): conform, or depart from it with a new ADR that says why.
7. **Never invent.** A module, API or behaviour the code does not have is never written as existing. When the card contradicts the code, say so and ask.
8. **Nothing is written on a guess.** No criterion or task depends on an unanswered question: before the documents exist, ask first; once they exist, the part a question decides stays unchanged until it is answered.
9. **IDs are stable across runs** (`AC`, `T`, `Q`, `ADR`): a new one takes the next number, a removed one leaves a gap, nothing is renumbered.

## Writing

- Headings and EARS keywords (WHEN, WHILE, WHERE, IF, THEN, SHALL) stay in English: other tools parse them. Prose follows the language the run's prompt asks for. Identifiers (paths, routes, fields, labels, card keys) are never translated.
- A plain, decided voice: lead with the verdict, state decisions definitively, cut filler and hedging.
- Diagrams in mermaid, small: Jira shows an attachment as text, so the prose must stand without the drawing.
- No secrets, tokens, connection strings or personal data. No names, emails or account ids of real people, not even the person who answered; examples use fictional data.

## Answers and revisions

- Answers arrive as a comment (`Q1 a, Q2 b`, or free text). Each lands in the documents in the run it arrives: a criterion, an `Assumptions` row with `Confirmed? y`, or an ADR. An answered question leaves `## Open questions`, and is never asked again.
- A vague answer, or one that contradicts the code, gets a follow-up question with the next number, never a guess ([references/questions.md](references/questions.md)).
- **A new version**: people put the card back for one, usually with what to change in a comment. Change what they ask, keep everything else and its IDs. A request that needs a decision you cannot make, or contradicts the code, an earlier answer or a recorded decision, gets a question with your recommendation instead.

## References

| File | Read when |
|---|---|
| [references/spec.md](references/spec.md) | writing `spec.md` and `design.md`: problem, surfaces, EARS, the path, the template |
| [references/tasks.md](references/tasks.md) | writing `tasks.md`, or the `## Tasks` and `## Checks` of a Small spec |
| [references/decisions.md](references/decisions.md) | a one-way door needs an ADR |
| [references/questions.md](references/questions.md) | a gray area needs a person, or answers arrived |
| [references/review.md](references/review.md) | reviewing the documents, your own or as the second model |

Attribution and changes from the sources: [NOTICE.md](NOTICE.md).
