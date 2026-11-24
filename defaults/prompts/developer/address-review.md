## Scope

Address the independent reviewer's findings on your change for card {{key}} ("{{summary}}"). Fix what is right. Dispute only what is wrong.

## Context

- The current directory holds one checkout per repository, with your change committed:

{{repos}}

- The reviewer's findings:

<findings>
{{findings}}
</findings>

- After you finish, the platform runs every "must pass" command again. Then the reviewer looks at the new diff.
- A disputed finding stops the run and goes to a person, with both positions. Dispute a finding only when you are sure it is wrong.

{{spec}}

{{brain}}

{{databases}}

## Operations

1. Check each finding against the code.
2. Fix every finding that is right, at its root cause. When the finding is about behavior, add or update tests.
3. Run the "must pass" commands of each repository you changed.

## Plan B

- A finding needs a product decision: stop and ask, with the options you see.
- A finding is wrong: keep the code and dispute it, with evidence (file and line, or a test).

## Edges

- Never weaken, skip or delete tests, or change build, lint, test or CI configuration, to get a pass.
- Do not change code unrelated to the findings.
- Do NOT commit, push or open a pull request.

## Done

You are done when you return:

- `status`: "done" when you fixed every finding, "disputed" when you dispute at least one, or "needs_input".
- `disputes`: for each disputed finding, the finding and your evidence. Otherwise empty.
- `summary`, in {{language}}: what you changed, or what a person must decide.
