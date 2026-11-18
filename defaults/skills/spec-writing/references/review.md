# Review

The documents are checked before they are attached to the card and handed to the Developer: by the writer over its own work, then by a second model. The reviewer is read only: it reports findings and never edits. One question drives it: can a builder with none of this context build the right thing from these files alone, and can the people reviewing the code see every decision that was made?

The platform also checks the layout it reads before any review (the tasks, the criteria and the `## Checks` table, and ids stable across versions), so a reviewer judges substance; a layout slip it missed is still a blocker.

## Read

- The card whole: description, comments, every answer (`Q<n> <letter>` or free text).
- Every file in the work folder (`spec/`), and the project's recorded decisions (brain notes, the repositories' ADRs or decision logs).
- The code the documents name. A module marked `(exists)` must exist and already do what the path says; a test convention a task follows must be the repository's.

## Checklist

### Coverage

- Each sentence of the card lands on a criterion, an `Out of scope` row or an open question. Quote the sentence that lands nowhere.
- Each answer on the card and each review comment is reflected in a criterion, an `Assumptions` row or an ADR.
- The size fits the evidence: a Small spec with a fourth step or a dependency between steps needed `tasks.md`; a new stored entity or contract needed What is being built.

### Criteria

- When the change could make something worse for someone, the Problem says what must not, and each such line is a criterion with its value.
- Each is one EARS sentence with SHALL and one requirement, numbered `AC<n>` across the spec.
- Each is observable with a concrete value: a status code, a field, a bound, a label. Flag "gracefully", "quickly", "properly", "user-friendly", "as expected".
- Each is testable in one run: no percentile, average or uptime.
- A backend rule has examples under it, one of them the strong case.
- A guarantee that something will not happen names its mechanism, a `Landing` door, or is a question.
- Every control the feature adds has a criterion naming who acts, which control and what shows afterwards.
- Slices are outcomes someone can watch, not layers.

### Gray areas

- No gray area is settled by an assumption: an `Assumptions` row that decides scope, product behaviour or a trade-off, with more than one defensible answer and nothing in the code settling it, should have been a question.
- `Confirmed? y` only with a source that exists: a card answer (`card: Q2 b`) or a review comment. A `y` with no source, or citing a question nobody answered, is a blocker.
- Open questions follow [questions.md](questions.md): plain text, after a few lines of what the writer understood, numbered across the card's life, 2 to 4 options with exactly one recommended (the why alone is asked open), no internal identifiers, nothing the code answers.
- The why: when the card does not say who needs it and why, and the answer changes what gets built, it was asked, not assumed.
- A choice between ways to build it that changes what users get, the cost or the time was asked; `design.md` or an ADR decides only a choice inside the code.
- No criterion or task depends on an open question.

### Surfaces

Each surface the card exposes was walked ([spec.md](spec.md)):

- a screen: empty, loading, error and unauthorised states; what each control does
- an API or webhook: response shape, error shape with its codes, who may call it and the status the rest get
- a command or job: output, exit codes, what happens when it fails halfway
- a file or export: format, encoding, columns, empty result, size limit
- stored data: what happens to existing rows, and each reader of the changed data has a criterion or an `Out of scope` row

### What is being built

- The path names only modules that exist (verified) or are marked `(new)` or `(door <n>)`; the mermaid drawing matches the numbered list.
- The rules that change what a user sees (filtering, searching, sorting, counting) run in a layer the repository's tests reach.
- `Surface` statuses include what a caller who may not call gets.
- No component catalogue, columns or types in `spec.md`: those belong in `design.md` or the diff.

### Decisions

- Each one-way door (persisted schema, consumed contract, new dependency, backfill, new pattern) has a `Landing` row with its literal shape and the alternative rejected, and an ADR.
- No ADR for a reversible choice.
- Every decision the project already recorded is respected, or departed from by a new ADR that says why.
- ADR numbers are unique within the card and match their file names and links.

### Tasks

- Every `AC` is in some task's `Covers` and has a `## Checks` row naming a test file and case; every id cited exists.
- Tasks are atomic, ordered by dependency (no task waits on a later one), and each carries its own test. A "write the tests" task, or `Test: none` on a task with behaviour, is a finding.
- Each test follows the repository's convention and its runner exists.
- No per-task commits, gates, proof commands or approval lines.

### Layout and hygiene

- Files only in the work folder, flat; only the files the size calls for; no empty files.
- Headings and EARS keywords in English; identifiers untranslated; prose in the run's language.
- Nothing the code contradicts: a field, route, module or behaviour written as existing that does not.
- No secrets, tokens, hosts, credentials or personal data, including in examples and questions.

### Prototype (when people approve the documents)

- When the prompt says people approve the documents on the card, a card that changes what a person sees has a prototype of each changed flow; a missing one is a major finding.
- Each screen and state it shows comes from a criterion, with the criterion's values; a control, field or state no criterion has is a gap in the criteria (major).
- Fictional data only, a banner saying it is illustrative, named under `## Sources` of `spec.md` with the criteria it shows, and no web address ([mockups.md](mockups.md)).

## Severity

| Severity | Meaning | Examples |
|---|---|---|
| **blocker** | The builder would build the wrong thing or cannot start, or people would approve a decision they cannot see | a file the size calls for is missing, or the documents are too thin to build from (said once, with what is missing); a card sentence that lands nowhere; a gray area settled by an assumption; `Confirmed? y` with no source; a criterion contradicted by the code; a one-way door with no ADR; an active decision departed from silently; a file outside the work folder; a secret or personal data |
| **major** | Buildable, but a criterion can pass while the behaviour is wrong, or a decision is missing | a criterion with no concrete value or no example; an unwalked state (empty, error, unauthorised, denied caller); a criterion with no task or no check; tasks out of dependency order; a test far from the repository's convention |
| **minor** | Clarity and consistency; nothing a builder would get wrong | a drawing that drifts from the list; an unclear slug; wording in a question; a heading off the template |

Blockers and majors send the documents back to their writer; minors are fixed when cheap. Judge the documents, not the request: a product choice people made on the card is not a finding.

## Output

Unless the run's prompt gives a format, report one finding per line, most severe first:

```text
<blocker|major|minor> - <file>: <heading or id> - <what is wrong> - <what to write instead>
```

End with the verdict: `changes` when any blocker or major remains, otherwise `approve`. Report what is wrong, not what is fine.
