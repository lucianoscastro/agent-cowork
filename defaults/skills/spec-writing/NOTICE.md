# Notice

This skill (`SKILL.md` and `references/`) adapts material from two third-party works, credited below with their licenses.

## Tech Leads Club: tlc-plan and tlc-spec-driven

Adapted from the skills `tlc-plan` (its `SKILL.md` and `references/plan.md`) and `tlc-spec-driven` (its `SKILL.md` and `references/specify.md`, `references/design.md` and `references/tasks.md`) by Tech Leads Club, <https://github.com/tech-leads-club/agent-skills>.

Those skills are licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0), <https://creativecommons.org/licenses/by/4.0/>. The original material is provided as is, without warranties of any kind.

What came from them: the problem written without its solution; gray areas asked, never assumed; EARS criteria with concrete values and examples; walking the surfaces; the shape and path drawn in mermaid; changes underneath; the surface table; landing and one-way doors; out of scope and the assumptions table; reading every sentence of the request so each one lands somewhere; the auto-sizing table; atomic tasks with dependencies and a test each; one check per criterion.

## NauckGroup LTDA: cy-create-spec (Compozy)

Adapted from the question format in `references/grill-protocol.md` and from `references/adr-template.md` of the `cy-create-spec` skill in Compozy, <https://github.com/compozy/compozy>, under the MIT License:

```text
MIT License

Copyright (c) 2026 NauckGroup LTDA

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Changes made

- **Headless.** Rewritten for an agent that runs with no human in the loop: no live interview. Gray areas are returned as one batch of numbered questions that the platform posts on the card; people answer in a card comment and the next run continues from the answers.
- **No approval step in the documents.** No approval stops and no `**Approved**` lines: the documents are attached to the Jira card and the card goes to the developer agent, straight away or, when the project asks for it, once a person approves it with a comment on the card; the review of the code's pull request is the other human gate. ADRs are written as `Accepted`.
- **No scripts or machine state.** Removed the Python validators and the lessons store (`scripts/`, `LESSONS.md`, `lessons.json`), `.specs/STATE.md` and its handoff, binding captures and screenshot verification, sub-agent delegation, interactive UAT and the Verifier.
- **Layout adapted.** A flat work folder `spec/` with `spec.md`, `design.md`, `ADR-NN-<slug>.md` and `tasks.md`, created by size, each attached to the card. No `.specs/STATE.md` or decision log file: the project's decisions are read from the project brain, where the platform records each ADR. The agent writes nowhere else.
- **One spec.md.** The plan (`tlc-plan`) and the specification (`tlc-spec-driven`) merged into one `spec.md`; criteria numbered `AC1..ACn` across the spec; user stories, requirement traceability and success criteria dropped; `design.md` condensed into a section of the spec reference.
- **Tasks without commit or proof lines.** No commit, gate, build line, proof command, test coverage matrix, phases or batches in the documents: the Developer's platform builds one task per call, commits it and runs the repository's must-pass commands and the task's `## Checks` rows before the next. Each task keeps its test and the criteria it covers, `## Checks` maps every criterion to its test, and each task becomes a Jira sub-task of the card.
- **Questions for a card.** The grill protocol's format kept (numbered `Q<n>`, why it matters, 2 to 4 options with one recommended, `Q1 a` answers), rewritten as plain text for a Jira comment, numbered across the card's life, with rules for answers that arrive in a later run.
- **ADR template.** Status is `Accepted`; ADRs are numbered within the card, and a later card departs from one with its own ADR instead of editing it; implementation notes folded into the decision's literal shape.
- **Added** a review checklist with a blocker, major and minor severity guide, for the writer and for a second model reviewing the documents read only.
- Condensed and reworded throughout; examples replaced with neutral ones.
- **Additions from superpowers' brainstorming** ([obra/superpowers](https://github.com/obra/superpowers), MIT License, Copyright (c) 2025 Jesse Vincent): the questions start with what the writer understood; the why is asked as the one open question when the card does not give it; a choice between ways to build it that changes what users get is asked; the Problem says what must not get worse; and, when people approve the documents on the card, a clickable HTML prototype of each changed flow (`references/mockups.md`), adapted from its visual companion. Rewritten for one asynchronous batch on the card instead of a live conversation.
