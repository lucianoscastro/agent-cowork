## Scope

Address the independent reviewer's findings on your change for Jira issue {{key}} ("{{summary}}"). Fix what is right; dispute only what is wrong.

## Context

- The current directory holds one checkout per repository, with your change committed:

{{repos}}

- The reviewer's findings:

<findings>
{{findings}}
</findings>

- After you finish, the platform runs every "must pass" command again, and the reviewer looks at the new diff.
- A disputed finding stops the run and goes to a human, with both positions. Dispute only when you are sure the finding is wrong.

{{brain}}

## Operations

1. For each finding, check it against the code.
2. Fix every finding that is right, at its root cause. Add or update tests when the finding is about behavior.
3. Run the "must pass" commands of each repository you changed.

## Plan B

- A finding needs a product decision: stop and ask, with the options you see.
- A finding is wrong: leave the code as is and dispute it, with the evidence (file and line, or a test).

## Edges

- Never weaken, skip or delete tests, and never change build, lint, test or CI configuration to get a pass.
- Don't change code unrelated to the findings.
- Do NOT commit, push, or open a pull request.

## Done

You are done when you return:

- `status`: "done" when every finding is fixed, "disputed" when at least one is disputed, or "needs_input".
- `disputes`: for each disputed finding, the finding and your evidence; otherwise empty.
- `summary`, written in {{language}}: what you changed, or what a human must decide.
