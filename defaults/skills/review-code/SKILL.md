---
name: review-code
description: Canonical full code-review skill for explicit "review my code", "revise o codigo", "revise o PR", "corrija", "aplique as correcoes", PR review, pre-merge checks, large/risky local diffs, or review-and-fix requests. Runs a 5-phase review (lint, design, logic, security, integrity) for pending local changes or GitHub PRs in Node.js, React, and .NET Core (C#); use a lighter self-review for tiny documentation, formatting, or obvious one-line mechanical changes. The security phase already covers what a standalone security review would, so do not run a separate security pass. Disambiguation - prefer this skill for any general "review my code / PR" request; the built-in /code-review (and its /code-review ultra cloud tier) is a separate automated diff pass, /simplify is quality-only cleanup, /security-review is security-only, /review is GitHub-PR-only - route to those only when the user names them explicitly.
origin: custom
---

# Professional Code Review (5 Phases)

Rigorous code review focused on production. It works in two modes with the **same 5 analysis phases** — the mode only changes the diff origin and the output format:

- **Local Mode** — reviews pending changes in the worktree (`git diff`). Generates a structured report.
- **PR Mode** — reviews a GitHub Pull Request. Posts inline comments and a consolidated summary.

**Supported Stacks**: Node.js and React (JS/TS) and .NET Core (C#). Detect the stack by the project manifest — `package.json` → JS/TS; `*.csproj`/`*.sln` → .NET — and use the corresponding commands in phases 0 and 4.

## When to Activate

- Before opening a PR or merging
- When the user asks for a code review or PR review
- After implementing a non-trivial feature or fix
- When a change touches auth, data integrity, security, concurrency, deployment, public APIs, or shared UI behavior

This is the canonical full-review skill. Prefer it over generic review for PRs and meaningful diffs — the 5 phases already cover security analysis, so there is no need to run a separate security review in parallel.

For tiny documentation, formatting, generated metadata, or obvious one-line mechanical changes, use the local minimum instead: reread the changed hunk, check that the request is satisfied, scan for secrets or unrelated edits, and run only the relevant lightweight validation.

## Step 1: Detect the mode and scope

### PR Mode — the user provided a PR number or asked to review a pull request

1. Get the PR number (from context or ask the user).
2. Identify the repo: `gh repo view --json nameWithOwner -q .nameWithOwner`
3. Download the diff: `gh pr diff {PR}`
4. Read the intent: `gh pr view {PR} --json title,body,headRefName`
5. Load existing inline comments: `gh api repos/{REPO}/pulls/{PR}/comments` — build the set of `{path, line}` pairs to avoid reposting.
6. If the branch or description references a spec or ticket, read that file to validate requirements against the diff. Optional — skip if none.

### Local Mode — no PR

```bash
git diff --name-only           # unstaged worktree changes
git diff --staged --name-only  # staged changes
git diff --name-only main      # entire branch when a main branch exists
```

In both modes: completely read all changed files before starting the review.

## Step 2: Choose the execution strategy

- **Small meaningful change** (few files): execute the relevant phases yourself, sequentially. Keep all 5 phases for PRs or explicit review requests.
- **Tiny mechanical change**: use the local minimum described above and say which checks were skipped.
- **Large change** (15+ files, or large PR): launch parallel subagents with the available multi-agent tooling — one per phase — passing the diff, the file list, and (in PR mode) existing comments. Consolidate the results in Step 5.

## Step 3: Execute the 5 phases sequentially

---

### PHASE 0: Static Validation (Lint & Typing)

Check:
- **Linting**: Does the code respect project rules? (ESLint/Prettier in JS/TS; analyzers + `dotnet format` in .NET)
- **Typing**: Type errors, excessive use of `any` (TS), or suppression of nullable warnings and unnecessary `dynamic` (C#)?
- **Imports**: Undeclared dependencies, unused `using`/imports, or circular references?

Action — run the validation for the detected stack:

| Stack | Commands |
|---|---|
| Node.js / React (JS/TS) | `pnpm lint` + `pnpm build` (or the project's manager: npm/yarn) |
| .NET Core (C#) | `dotnet format --verify-no-changes` + `dotnet build -warnaserror` |

---

### PHASE 1: Structure & Design

**Source of Truth**: before evaluating, invoke the `code-rules` skill (always), plus `frontend-patterns` for UI code and `backend-patterns` for server code — in full-stack PRs, invoke all three. The rules from these skills are the canonical pass/fail criteria. The checks below are a high-level checklist — in any conflict, code-rules / frontend-patterns / backend-patterns prevails over your own judgment.

Check:
- **Single Responsibility**: Does each function/class solve only one problem?
- **Naming**: Descriptive names following the project's standard?
- **DRY**: Is there duplicated logic that should be abstracted?
- **Complexity**: Long functions or high cyclomatic complexity?

---

### PHASE 2: Logic & Concurrency

**Source of Truth**: apply the anti-patterns and rules from `code-rules` as the canonical criteria. In conflict with the checklist below, code-rules prevails.

Check:
- **Edge Cases**: Are `null`, `undefined`, empty, or out-of-range inputs handled?
- **Async/Await**: Promises (JS/TS) / Tasks (C#) properly handled, no race conditions?
- **Error Handling**: `try/catch` with proper logging?
- **Regression & Hallucination**: Out-of-scope changes, unrelated deleted code, phantom imports, calls with wrong signatures, `TODO` in production code, weakened test assertions.

---

### PHASE 3: Security (Security First)

Check:
- **Sanitization**: User inputs validated before DB or render?
- **Secrets**: No hardcoded API keys, tokens, or passwords?
- **Injection & XSS**: Parameterized queries? Protection against script injection?

---

### PHASE 4: Integrity (Build & Tests)

Check:
- **Build**: Compiles clean, no fatal warnings?
- **Coverage**: Does the main logic and new paths have tests?
- **Mocks**: External dependencies properly mocked?

Action — run the tests for the detected stack:

| Stack | Command |
|---|---|
| Node.js / React (JS/TS) | `pnpm test` (or npm/yarn) |
| .NET Core (C#) | `dotnet test` |

---

## Step 4: Second pass (gap detection)

Reread the full diff from top to bottom. List every file or hunk that no phase evaluated. For each uncovered file, run the relevant phases again. Only skip a file when you can explicitly state why it is clean. Config/lock files (`*.json`, `*.lock`, `*.yaml`) and pure type declarations are exempt.

## Step 5: Output

### Local Mode — report

For EACH problem found, use this exact format:

```
### Code Review Report

**Phase [Number]: [Phase Name]**
- **Status**: [ok Success / warning / failure]
- **Location**: [File]:[Line]
- **Severity**: [Low / Medium / High / Critical]
- **Description**: [Technical explanation]
- **Suggested Fix**:
  [suggested code snippet]
```

Final summary:
- Total problems by severity
- Phases that passed without issues
- At least one positive point about the change
- Verdict: **Approved**, **Approved with reservations**, or **Rejected**
- If rejected: list of mandatory fixes before merge

### Correction (Local mode — opt-in)

By default, review-code only reports and suggests — it does not edit files.

Apply the corrections to the files **only if** the request contains an imperative action verb: `corrija`, `corrigir`, `fix`, `aplique as correcoes`, `ajuste`, `resolva`. Requests like `revise`, `analise`, `veja`, `cheque` produce only the report with suggestions.

When authorized to fix:
- Fix Critical and High severities first; Medium/Low according to the request scope.
- After fixing, run PHASE 0 and PHASE 4 again (lint, build, tests) to confirm.
- List what was fixed and what remained as tech debt.

PR mode never edits files — Comment rule 6 applies.

### PR Mode — inline comments + summary

Post one inline comment per problem with `gh`, following the **Comment rules** below. Then, post a consolidated summary with `gh pr review {PR} --comment --body '...'`:

```markdown
## Review Summary

| | |
|---|---|
| **Executed phases** | 5 (Lint - Design - Logic - Security - Integrity) |
| **Problems** | {N} in {M} files |

### By severity
- **Critical ({N})** — [`path/file.ts:L42`] problem title
- **High ({N})**
- **Medium ({N})**
- **Low ({N})**

### Files without comments
- `path/to/file.ts` — no phase pointed out an issue (verify manually)
_(Omit this section if every logic file received at least one comment.)_

### Highlights
- [At least one well-resolved point of the change]

### Verdict
**Approved** / **Approved with reservations** / **Rejected**
```

If no problems: post `No problems found across the 5 phases.` and still include the table and a highlight.

### Comment rules (PR mode)

1. **Allowlist**: comment only on diff lines starting with `+` (except `+++`).
2. **No duplicates**: if there's already a comment at `{path, line}` within ±3 lines, skip.
3. **Mark resolved**: on older comments where the issue was fixed, reply `[RESOLVED] Seems resolved by recent changes.`
4. **False positive guard**: only report with confidence >= 80%. When in doubt, do not comment.
5. **Tone**: specific, actionable, collaborative. Explain the WHY of the problem.
6. **Never** approve, request changes (`request-changes`), or edit files. Use only `gh pr review {PR} --comment`.
7. **Marker**: start every inline comment with `<!-- review-code -->` for the consolidation to recognize it.

## Rules (both modes)

- Never approve code with **Critical** severity issues
- **High** severity issues must be fixed before merge
- **Medium** and **Low** issues can be tracked as tech debt
- Include at least one positive point about the change before listing problems
- If there are no problems, explicitly state that all phases passed
