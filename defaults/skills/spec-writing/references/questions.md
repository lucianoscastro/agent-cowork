# Questions

The run cannot ask anyone. Every gray area goes back as a question: return the batch in your result the way the run's prompt says. Before the documents exist, the platform posts it on the card as one comment, people answer in a card comment, and the next run reads the answers and continues. Each round trip can cost a day, so ask everything that is needed, once, and nothing the code answers.

## What to ask

- **Only what is a person's**: scope, product behaviour, a trade-off (cost against speed, now against later), a departure from a linked design or from an active decision.
- **The why, when the card does not give it.** Who needs this and what they will do with it settles the small decisions nobody wrote down (which columns, which default, which edge case matters). When the card and its discussion do not say, and the answer would change what gets built, ask it first, as an open question. Skip it when the card says it, or when every answer would build the same thing.
- **A choice between ways to build it**, when they differ in what users get, the cost or the time (a file built while the person waits, or one emailed later): one question, each way an option with its effect and its cost, the one you would build recommended. A choice that differs only inside the code is yours: `design.md`, or an ADR when it is one-way.
- **Never a fact.** What the code does, which endpoint exists, the current limit, how a field is stored: look it up. A question the code answers wastes the round trip and the reader's trust.
- **How, never whether.** A capability nobody asked for is not offered as an option: it goes to `Out of scope`.
- **Skip a question because the evidence settles it**, not because the card looks small. A simple-looking card still gets the questions its unexamined assumptions need.
- **Never twice.** A question the discussion already answers is used, not asked again.
- **One batch.** Every open gray area in the same answer, the ones that block the most first. Past about eight, the card is too big or too vague: ask the scope questions now and the rest after.
- **One decision per question.** "Should it do X and Y?" is two questions.
- **Number across the card's whole life.** A later batch continues from the last number (Q4, Q5), so `Q2 a` always means one thing.

## Format

Plain text. Jira shows Markdown from this text literally, so no `#` headings, no `**bold**`, no tables, no backticks, no `[text](url)` links: numbered lines, dashes and bare URLs. Write in the language the run's prompt asks for, labels included; `Q<n>` and the option letters stay as they are, because the answers refer to them. Return only what you understood and the questions: the platform adds the line that introduces them and says how to answer.

Start with what you understood, in two to four plain lines: what will change, for whom and why, as far as the card says, and what it does not say. People correct the reading itself there, not only the options: a misread card is the costliest mistake, and the cheapest to catch here.

```text
What I understood: <what will change, for whom and why, in 2 to 4 plain lines; what the card does not say, said as such>

Q1. <Short plain question?>
Why this matters: <what this decides, what happens today, and what changes with the answer. Explain any term a product person may not know.>
- a) <Option> (Recommended). <Its practical effect and its main cost.>
- b) <Option>. <Its practical effect and its main cost.>
- c) <Option>. <Its practical effect and its main cost.>

Q2. <...>
```

- **2 to 4 real options**, exactly one marked (Recommended): the one you would build, placed first. Each option says its practical effect and its cost. People may still answer in their own words.
- **The why is the one open question**: no options, because options would steer the answer. It ends with `(Answer in your own words.)` instead of the option lines.
- **Written for someone who has not read the code**: no file, class, table or route names, no criterion ids, no jargon. Say what a thing does. Keep an identifier only when it is the subject of the decision, such as the label of a button the card names.
- **Stress-test a load-bearing decision** with one concrete scenario at its boundary: "two people export the same month at once: does the second wait, or get its own file?"
- **No personal data** and nothing secret: no customer names, emails, hosts or credentials, even when the card has them.

## Example

```text
What I understood: Finance wants to download the month's orders from the Orders page as a spreadsheet file, to reconcile them with the bank statement instead of re-typing them. The card does not say which orders count or how long a period one file may cover.

Q1. Should the export include cancelled orders?
Why this matters: The Orders page hides cancelled orders today. Finance reconciles against the bank statement, where a cancelled order can still show as a refund.
- a) Include them, with a status column (Recommended). Refunds can be matched; the file has a few more rows.
- b) Leave them out, like the page. The file matches what people see; refunds will not match anything.

Q2. What is the longest date range one export may cover?
Why this matters: The file is built while the person waits. A month of orders takes a few seconds; a year can take minutes and may time out.
- a) 31 days (Recommended). Covers a monthly close; a longer period needs several files.
- b) 92 days. Covers a quarter in one file; the person may wait close to a minute.
- c) No limit. One file for any period; long ranges can fail and need a different, slower design.
```

When the card does not say why, the open question comes first:

```text
What I understood: The card asks for an export of orders from the Orders page. It does not say who will use the file or for what.

Q1. Who will use the exported file, and what will they do with it?
Why this matters: Finance reconciling payments needs refunds and fees; a warehouse team needs items and delivery addresses. The answer decides the columns and which orders count.
(Answer in your own words.)
```

## In spec.md

A question that blocks the documents is asked before they are written, so `## Open questions` is usually `None`. A question raised later (on a revision, or one that only blocks go-live) gets one line there with the same number and what it blocks: `- Q5 - Who receives the export by email - blocks AC7`. When it is answered, the line leaves the section.

## When answers arrive

- Accept short forms: `Q1 a`, `q1 a`, `1a`, several on one line (`Q1 a, Q2 b`), or the option in the person's own words.
- Each answer lands in the documents in the run it arrives: a criterion, an `Assumptions` row with `Confirmed? y` and `card: Q1 a` as its rationale, or an ADR. Never record who answered.
- A question in the reply is a request to explain: ask it again under the same number, with the explanation the reader needed.
- A vague answer gets the specific follow-up under the next number: "it depends" gets "on what?", "probably" gets pinned to one option.
- An answer that states how the system works is checked against the code. When the code disagrees, ask the follow-up and say what the code shows.
- A question still unanswered stays open: build nothing it decides.
