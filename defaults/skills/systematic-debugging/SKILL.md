---
name: systematic-debugging
description: "Finds the root cause of a bug, a failing test or build, or a flaky test before any code changes: reads the whole error, reproduces it, checks what changed, traces the bad value back to where it starts, compares with code that works, tests one hypothesis at a time, then fixes the cause with a test that failed first, and stops to report after three failed fixes. Use for a bug card, a must-pass command that fails, a test that fails only sometimes or only in CI, or a fix that did not work. Not for building a new feature: that is tdd-workflow."
license: "MIT (adapted from the systematic-debugging skill of Jesse Vincent's superpowers)"
metadata:
  origin: "adapted"
---

# Systematic Debugging

A fix made before the cause is known treats a symptom: the bug comes back somewhere else, or the fix breaks something next to it. Find the cause first. It is faster than guessing, also for a bug that looks simple.

## 1. Find the cause

1. **Read the whole error.** The stack trace down to the first frame in the repository's code, the file and line, the error code, and the warnings printed before it. They often name the cause.
2. **Reproduce it.** The exact command and input that trigger it, every time. When it does not happen every time, gather data (step 4) instead of guessing.
3. **Check what changed.** `git log` and `git diff` against the base branch, dependency and lockfile changes, configuration, environment. On a must-pass failure after your change, check first whether the same command also fails on the base branch.
4. **Find the layer that breaks.** When the path crosses components (a route, a service, the database; a CI step, a script, a tool), log what enters and what leaves each boundary, run once, and read where the value goes wrong. Then look only at that component.
5. **Trace the bad value back.** Where the error shows is rarely where it starts. Ask what called this with that value, then what called that, until you reach the origin, and fix it there. To see the chain, log `new Error().stack` with the inputs just before the failing operation (in tests use `console.error`: loggers are often silenced).

## 2. Compare with what works

- Find similar code in the same repository that works. List every difference, however small; do not assume one "can't matter".
- When the code follows a pattern or a library's documented use, read the reference completely before changing anything.
- Write down what the broken code assumes: settings, environment variables, order of calls, shape of the data.

## 3. One hypothesis at a time

- State it: "X is the cause, because Y".
- Test it with the smallest change that can prove it wrong, one variable at a time.
- Wrong: undo that change, then form a new hypothesis with what it showed. Never stack one fix on another.
- When you do not understand something, say so in your summary instead of guessing.

## 4. Fix the cause

1. Write a test that reproduces the bug and watch it fail before the fix (`tdd-workflow`). With no test framework, a small script that fails.
2. Make one fix, at the origin of the bad value. When the code is shared, search every caller: one guard in the shared function beats one per caller. No "while I'm here" changes.
3. Run that test, then every must-pass command of the repository.
4. When invalid data caused the bug, a check where that data enters the system can make it impossible, not only fixed. Add one only at a boundary the data really crosses.
5. Remove the diagnostic logging you added.

## When fixes keep failing

- After each failed fix, go back to step 1 with what it showed.
- After three failed fixes, stop. When each fix reveals a new problem somewhere else, or needs a large refactor to land, the design is the problem, not a fourth hypothesis. Report what you tried, what each attempt showed and the design question, so a person decides before more code is written.

## Flaky tests

- **Timing guesses.** A `sleep` or `setTimeout` that waits for something to be ready passes on a fast machine and fails under load or in CI. Wait for the condition itself (`await waitFor(() => job.status === 'done')`, Playwright's auto-waiting locators), with a timeout and an error that says what it waited for. A fixed delay is right only when the behavior is timing itself (a debounce, a tick interval): first wait for the trigger, then the delay, with a comment saying why that value.
- **Pollution.** Something appears during the suite (a file, a folder, a record) and a later test fails because of it: run the test files one at a time and check after each, to find the one that leaves it. Replace the test command and the path with the repository's own:

  ```bash
  for f in $(find src -name '*.test.ts' | sort); do
    npm test -- "$f" > /dev/null 2>&1
    [ -e path/it/leaves ] && { echo "left by $f"; break; }
  done
  ```

- **Shared state.** A test that passes alone and fails in the suite reads state another test left behind. Find the other test the same way, and give each test its own setup and cleanup.

## When the cause is outside the code

Some causes really are outside the repository: an external service, the environment, timing you do not control. Say what you checked, handle it where it enters the code (a timeout, a retry, a clear error message), and leave the logging that would catch it next time. Most "no root cause" conclusions are an investigation that stopped early, so be sure before settling on one.

## Edges

- Never weaken, skip or delete a test, and never change build, lint, test or CI configuration, to make a failure go away.
- Reproduce with test data and local services. Never point the code at a real environment or database to reproduce a bug.
- Diagnostic logging never prints secrets or personal data, and never stays in the change.

Adapted from the `systematic-debugging` skill of Jesse Vincent's [superpowers](https://github.com/obra/superpowers) (MIT License), with its root-cause tracing, defense-in-depth and condition-based waiting notes, condensed for agents that run without a person to ask during the run.
