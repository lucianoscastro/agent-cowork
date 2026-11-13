# agentCowork — Product specification

Status: v1.0 (implemented) · Owner: project maintainer · Inspired by [Paperclip](https://github.com/paperclipai/paperclip) (MIT)

## 1. Vision

agentCowork is a self-hosted control plane that runs a small team of AI agents for a software company. The agents work the company's Jira and GitHub so developers can stay at the ends of the process: they write good tickets, and they review and merge.

Current scope: Node, React and .NET projects using pnpm, with Jira Cloud and GitHub, and Claude Code, Codex and Antigravity (`agy`) as agent runtimes.

## 2. Principles

| Principle | Meaning |
| --- | --- |
| **Gates, not trust** | Every agent claim passes a check the agent does not control: build and tests run by the platform, an independent reviewer, a human gate. |
| **Edges as code** | Limits are enforced by the platform (sandbox, tool allowlists, credentials the agent never sees), not only written in prompts. |
| **Humans own decisions** | The developer agent never merges. Product ambiguity goes back to a human as questions. |
| **Isolation first** | One container per company, one worktree per run. Credentials are injected only into the run that needs them. |
| **Everything configurable** | All settings, credentials, agents, models and prompts are managed in the admin UI. |
| **SCOPED prompts** | Every agent mission is a SCOPED prompt: Scope, Context, Operations, Plan B, Edges, Done. |

## 3. Deployment model

- **One container per company.** No data, credentials or processes are shared between companies. Each container has its own volume, port and admin login.
- **Single admin user** per container, configured in `docker-compose` through environment variables (`ADMIN_USERNAME`, `ADMIN_PASSWORD`). The UI requires login.
- **Bootstrap environment only:** admin credentials, `AGENTCOWORK_SECRET_KEY` (encrypts stored secrets) and the port. Everything else lives in the database and is edited in the UI.
- **Storage:** separate persistent volumes per company, by lifecycle:

| Volume | Mount | Content | Class | Backup |
| --- | --- | --- | --- | --- |
| `db` | `/data/db` | SQLite: settings, runs, questions, audit log, **encrypted secrets** | Critical | Daily |
| `work` | `/data/work` | Bare clones, run worktrees, package caches (pnpm store, NuGet). Caches share the volume with worktrees so pnpm can hardlink. | Rebuildable | No |
| `auth` | `/data/auth` | CLI login homes: `claude/` (`CLAUDE_CONFIG_DIR`), `codex/` (`CODEX_HOME`), `agy/` (linked as `~/.gemini`). Files `0600`. | Critical, most sensitive | Encrypted |
| `logs` | `/data/logs` | Run logs, tool calls, artifacts, and CLI transcripts (moved out of `auth` when a run ends) | History, kept **forever** | Optional |
| bind | `/backups` | Automatic online backups of `db` and `auth` | — | — |
| bind, read-only, optional | `/overrides` | Replacements for the shipped instructions, skills and prompts | — | — |

  Runs, logs and transcripts are removed only when the admin deletes them in the UI. `/tmp` and `HOME` stay on tmpfs.
- **Hardened runtime** (as today): Debian trixie base (Chromium from Debian security), read-only root filesystem, no capabilities, `no-new-privileges`, non-root user, UI on `127.0.0.1` unless the operator exposes it.

## 4. Domain model

| Entity | Description |
| --- | --- |
| **Settings** | Company name, language of agent output, defaults. |
| **Secret** | Encrypted value: API keys, account tokens, GitHub and Jira credentials. Never returned to the UI after it is saved, only shown as "set". |
| **Integration** | GitHub (token of the user the agents act as) and Jira (site, email, token). Each has a "test connection" action. |
| **Provider** | An agent runtime: `claude-code`, `codex`, `agy`. It has an auth method (`api-key` or `account`), a status, and a list of models. |
| **Project** | A set of repositories under a unique name, each checked out side by side in a folder named after the repository (`acme/web` → `web/`), with its stack (Node.js, React or .NET), whose default `verify` commands live under General and can be replaced per repository; one base branch per project, plus the Jira board its cards come from (the Developer's trigger JQL runs within it). |
| **Dry run** | Per agent (each agent's Settings): in dry run an agent does all the work but writes nothing to GitHub or Jira, so agents go live one at a time. New agents start in dry run. |
| **Agent** | One of the three agent types. It has an enabled flag, a trigger, a provider and model per role, a SCOPED prompt and limits. |
| **Assets** | Global instructions, skills and SCOPED prompts. Defaults are versioned in the repository (`defaults/`) and shipped in the image. Operators replace any of them by mounting read-only files under `/overrides`. Not stored in the database, not editable in the UI. |
| **Run** | One execution of an agent on one item (card or PR): stages, status, logs, tool calls, artifacts (PRs, comments), duration, tokens. |
| **Question** | A blocking question to a human (Jira comment or UI inbox) and its answer. |
| **Event** | Audit log of every mutating action, by the platform, an agent or the admin. |

## 5. Providers

All agent work goes through one interface, so agents do not depend on a runtime:

```ts
interface Provider {
  run(input: {
    prompt: string;
    schema: JsonSchema;        // structured final answer
    cwd: string;
    mode: 'read-only' | 'write';
    model: string;
    subagents?: SubagentSpec[]; // when the runtime supports them
  }): Promise<{ output: unknown; usage: Usage; transcript: string }>;
}
```

| Capability | Claude Code | Codex | agy |
| --- | --- | --- | --- |
| Headless command | `claude -p` | `codex exec` | `agy -p` |
| Structured output | `--json-schema` | `--output-schema` + `-o` | `--json-schema` (`structured_output` in the JSON envelope) |
| Read-only mode | tool allowlist (Read/Glob/Grep plus `cd`, `ls`, `wc`, `git diff/log/show/status/ls-files/rev-parse/blame`, and Claude Code's own simple readers inside the checkout; nothing that can write or run a command, such as `find -exec`, `sort -o`, `rg --pre` or git's `--output`/`--no-index`, nor build, install or reach the network; `/proc`, the credentials, the database and the backups are never readable) | no inner sandbox (bubblewrap cannot create namespaces in the hardened container) | approvals skipped (headless agy denies every unapproved command, so reviews could not run `git diff`) |
| Write mode | tool allowlist + container sandbox | `--sandbox workspace-write` | to be validated |
| Subagents | native, model per subagent | — | — |
| **Auth: API key** | `ANTHROPIC_API_KEY` | `OPENAI_API_KEY` / `codex login --with-api-key` | `GEMINI_API_KEY` + `modelProvider: gemini` (primary) |
| **Auth: account** | `claude setup-token`, driven from the UI: show the sign-in URL, paste the browser code back | `codex login` in the browser: show the sign-in URL, paste back the address the browser lands on (the local callback); works where workspaces disable device codes | Google OAuth URL, paste the code back. **Business accounts only**: personal accounts are not permitted by Google's terms for this use. |

Rules:

- The auth method is chosen per provider in the UI, and the platform runs the login flow. The resulting credential is stored as a secret.
- A provider gets only its own credential. GitHub and Jira credentials are never passed to any runtime.
- Repository hooks and MCP configs from checked-out branches are ignored.
- **No automatic retries**: a failed item goes to the Inbox and is picked up again only when a person clicks Retry; a provider usage limit is not a failure (the provider pauses and the item runs after it). With **Switch provider on a usage limit** (General, on by default) a call whose provider is paused or hits its limit moves on to the next one, Claude Code, Codex then agy, with that provider's default model (a Developer reviewer takes the lead's or the other reviewer's provider last); only when all three are limited does the run fail and wait. Browser steps stay on Claude Code.
- **Read-only is enforced by the platform** for every runtime: before a read-only call the platform snapshots HEAD and the working tree of each checkout, and afterwards reverts any change and records a warning on the run. The container (no capabilities, read-only root, no GitHub or Jira credentials) is the sandbox.
- `agy` ships as **experimental**; see [the spike](spikes/agy.md) for what is validated and what still needs real credentials.

## 6. Agents

### A. Developer

Turns Jira cards into verified draft pull requests.

| | |
| --- | --- |
| **Trigger** | A card on a project's board with the `agent-ready` label (configurable). |
| **Lead** | Claude Code. It plans, splits work and owns the card. |
| **Subagents** | Roles with their own model: `coder`, `tester`, `verifier`. They are grouped by shared code context, not by business area, and used only for truly parallel work. |
| **Reviewers** | Up to two independent reviewers, each switchable and with its own runtime and model (first on with Codex, second off by default), read-only. They audit the plan and the final diff in parallel; the review passes only when each one passes, and the lead gets every finding (the second reviewer's marked). With none on, plans and diffs go unreviewed and only the must-pass commands and the people on the PR check the work. |
| **Output** | One draft PR per changed repository, a Jira comment (Plan / Result / How to test) and a status transition. |
| **Never** | Merge, deploy, write to databases, or change CI configuration. |

Lifecycle (run by the platform):

*Cards in parallel* (1–4) sets how many cards run at once, across projects and within one: each card has its own checkout and branch `ai/<card>`.

| Stage | Agent work | Gate |
| --- | --- | --- |
| 1. Intake | Pick the card, lock it, move it to In Progress; fetch the failed-step logs of GitHub Actions runs the card links (the project's repositories, at most 3) into the prompts | Atomic checkout, so one run per card; agents have no network or GitHub token, so the platform reads CI for them |
| 2. Plan | Load skills, map the code, write the plan; **Codex reviews the plan** | **Plan review gate** (round limit). Questions go to the card **in one batch**, then the run waits. |
| 2b. Kind | The plan declares what the card needs: **code** (the steps below), **promote** (the platform opens PRs between existing branches of the project's repositories, e.g. `develop` → `qa`, with the plan as their description; never merges, and the follow-up does not watch them), **answer** (the answer goes on the card) or **handoff** (a checklist for a person with access agents lack: cloud settings, secrets, consoles; the card waits for a comment). A database change, schema or data, is **code**: an idempotent script in the repository, following its convention | The reviewers check the kind fits the card; outside code, their minor notes from an approved review are appended to the plan the person reads. Promotions must be two different branch names of a repository of the project; GitHub's compare proves both exist. The agent never gets the GitHub token. |
| 3. Build | Reproduce with a failing test, fix the root cause | — |
| 4. Verify | — | **Hard gate**: the platform runs each changed repository's `verify` commands. Red returns to Build (round limit). |
| 5. Review | **Codex reviews the diff**; the lead fixes findings | **Diff review gate** (round limit). Disagreement parks the run for a human. |
| 6. Ship | Draft PR, card comment, transition (reviewers come from the repository's CODEOWNERS or rules) | **Human gate**: merge |
| 7. Follow-up | Until every PR of the card is merged or closed (on merge the card moves to the configured status): answer each review thread and comment (fix it and resolve the thread, or decline it with a justification and leave the thread open for the reviewer), and keep the pipeline green (build, tests, quality gates such as SonarQube, conflicts with the base branch), reading the failed job logs and check reports | Local `verify` before every push. Red rounds have a limit; at the limit the agent says so on the PR and waits for a person. The card is done only when its PRs close. |

Concurrency: cards that touch the same code share a loop or wait in the same queue.

**Loop limits.** Every feedback loop has a round limit, configurable per agent in the UI. When a limit is hit, the run stops, is **parked** with its log and the reason (open findings, failing command), and shows up in the Inbox for a human to take over, re-scope or resume.

| Loop | Default limit | Counts as one round |
| --- | --- | --- |
| Plan review | 2 | Codex reviews the plan, the lead revises it |
| Verify | 3 | The platform runs `verify`, the lead fixes the failure |
| Diff review | 3 | Codex reviews the diff, the lead fixes the findings, `verify` runs again |
| PR follow-up | 3 | The pipeline of an open PR is red (or conflicts); the lead fixes it and pushes. A green pipeline resets the count, and a new comment resumes a parked PR. |
| Whole run | 90 min wall clock | Any stage |

Before pushing, the platform checks that a branch named `ai/<card>` is absent or holds only the agent's own commits; anyone else's commits there park the card instead of being overwritten.

A finding the lead rejects counts as a disagreement: it is recorded with both positions and parks the run. The lead cannot dismiss the reviewer on its own.

### B. Dependabot

Keeps dependencies current without human toil.

| | |
| --- | --- |
| **Trigger** | A PR opened by `dependabot[bot]` in any repository of the configured projects. |
| **Runtime** | Any provider with a low-cost model (default: the cheapest configured). |
| **Flow** | Release older than the cooldown → required checks green → platform `verify` → the model reads the changelog and diff for breaking changes → decision. Fails closed: a PR with no CI checks an hour after it opened, or a repository with no verify commands, goes to a human. Grouped PRs (several packages at once) follow the same flow when every package is read from the PR and none is a major; a PR whose packages can't all be read goes to a human. An update outside the policy (a major) follows the same flow once a person approves the PR's current commit on GitHub (approvals carrying the agentCowork footer, or older than Dependabot's last commit, don't count); the approval also brings a PR parked for a human back for assessment. A PR that conflicts with its base, or whose CI fails while it is behind its base, gets `@dependabot rebase` and its new commit is assessed from scratch; CI failing on an up-to-date branch can't be fixed by Dependabot: it becomes a card on the project's board for the Developer agent (issue type, labels and target status set in its Settings, `agent-ready` by default; one card per PR; the card carries the end of each failing job's log); the Developer works on Dependabot's branch and opens its PR into it (the link comes from the platform's record of the card, not the card's text), so the update merges once, through Dependabot's PR, whose assessment then expects the fix's code changes, and goes to a human when there is no board or Jira. |
| **Cooldown** | Merge only when the new version was published at least **N days** ago (default **3**, set in the UI). Protects against compromised or yanked releases. PRs inside the window are re-checked later. |
| **Policy** | Patch and minor with everything green and no risk found: **approve and merge**. Major, or any risk found: comment with the reason and request a human. |
| **Settings** | Repositories, merge method (squash, merge or rebase), semver policy, cooldown days, required checks. |
| **Never** | Edit code, force-merge, bypass branch protection, or touch other PRs. |

### C. Approver

Reviews pull requests that request review from the configured GitHub user.

| | |
| --- | --- |
| **Trigger** | Open, non-draft PRs where the user is requested **directly** (team requests don't count), in repositories of the configured projects only. Each head commit is reviewed once. |
| **Runtime** | Claude Code or Codex (configurable), in read-only mode. |
| **Decision** | No findings: **approve** as the user. Findings: inline comments, no approval. |
| **Never** | Approve with findings, push code, or review PRs outside its scope. |

### D. Auditor

Audits the code of every project repository, one category at a time, and keeps the findings over time.

| | |
| --- | --- |
| **Categories** | Each enabled on its own, with its own skill, provider, model and interval. |
| **Trigger** | Every repository of the configured projects, on its base branch: per category every **N days** and only when the branch has new commits since that category's last audit. Accessibility runs on React repositories only. A repository's due categories run at the same time, each as its own run, on its own worktree of the audited commit (the code is fetched once into the repository's cached clone; separate worktrees keep one model's writes from reaching another); *Repositories in parallel* sets how many repositories go at once. **Run now** audits every enabled category regardless of interval or new commits. |
| **Runtime** | Any provider, read-only, with the category's skill and one shared SCOPED prompt. For dependencies the platform first runs the package managers (`pnpm audit`/`outdated`, `dotnet list package --vulnerable`/`--outdated`) in the checkout, without credentials, and hands their output to the model. |
| **Output** | A report in the run (verdict, findings with file and line, coverage of the skill's checks, strengths, limitations, owner actions, copy-ready issues). Critical and high findings put the repository in the Inbox. The **Findings** page keeps each repository's history per category, compares an audit with the previous one of the same category (new, still open, fixed; matched by check and file), and creates a Jira card from a finding on the board of the repository's project, once per finding. |
| **Never** | Change code, open issues, run the project's own scripts, or print a secret or personal data. |

| Category | Skill | Default |
| --- | --- | --- |
| Security | `check-pre-deploy` (20 checks) | on, weekly |
| Privacy (LGPD/GDPR) | `check-privacy` (14 checks) | off, weekly |
| Performance | `check-performance` (14 checks) | off, every 14 days |
| Reliability | `check-reliability` (14 checks) | off, every 14 days |
| Test gaps | `check-test-gaps` (12 checks) | off, every 30 days |
| Code health | `check-code-health` (12 checks) | off, every 30 days |
| Dependencies | `check-dependencies` (12 checks) | off, weekly |
| Accessibility (WCAG 2.2 AA) | `check-accessibility` (14 checks) | off, every 30 days |

### E. Sentinel

QA for each project's test environment: separates real bugs from flaky tests and environment noise, and files the bugs with evidence. Nothing in it assumes one company's setup.

| | |
| --- | --- |
| **Environment** | Per project (Projects → Test environment), per repository: two checks, **End-to-end tests** and **Exploratory**, and for a checked one its URL (never production) and branch (empty: the project's base branch). The test variables (users, passwords, tokens) are one JSON object per repository, stored encrypted as `env.<project>.<owner/name>`: given only to the test commands and, masked, to the browser; the page shows only their names, and the variables a detected suite reads but the JSON lacks. |
| **Suite** | Detected on every run, so it follows the code: the platform reads the repository through the GitHub API on its branch and takes its own files: Playwright (`playwright.config.*`), Cucumber (`@cucumber/cucumber` with `.feature` files, run before a Playwright it wraps) or Cypress (`cypress.config.*`); .NET suites are recognized but not supported yet. It derives the folder, setup and run commands, how to run one test (`{file}:{line}` for Playwright and Cucumber, `--spec {file}` for Cypress), the URL variables (set to the repository's URL) and credential variables the suite's code reads, and a report the platform picks (Playwright JSON, Cucumber JSON or JUnit XML, at a path of its own). Nothing to configure; the page shows what was found. |
| **Trigger** | Once a day at a set UTC time, or Run now. If the project's CI also tests the environment, pick another hour. |
| **Triage** | The suite runs; each failed test, up to a limit per run, runs again alone N times (passing once means flaky, not filed); failing every time, a model replays it in a browser (Playwright MCP, Chromium, limited to the environment's origin, credentials masked) with the suite's code at hand, and decides bug, test problem, environment, or not reproduced. Only a high-confidence bug is filed. |
| **Bugs** | On the project's board, issue type configurable, labels `sentinel`, `qa-e2e` and a fingerprint of the test (file and title); with environment, commit, the test's source, steps, expected and actual, the suite's error, and attachments (browser screenshots, the HAR and console log cleaned of request bodies, credentials, cookies and secret values, and the suite's own failure screenshots). An open bug with the same fingerprint gets a comment instead of a duplicate. |
| **Exploration** | For a repository checked **Exploratory**, every few hours (6 by default, Sentinel → Settings) and only when its branch moved since the last exploration (the first time: its last 10 commits). The model reads the commits, the Jira cards they name and the changed files in a read-only checkout, picks up to three user-visible areas (none when only docs, CI or tests changed) and explores them in a browser, time-boxed. Anomalies seen twice, medium and above, go to the inbox with their steps and evidence; **Create card** there files them on the project's board. A failed exploration keeps its starting point, so the next covers the same changes. It may create data in the test environment, prefixed "[sentinel]", never real payments or deletions of others' records. |
| **Never** | Test production, change code or test files, or show secrets to the model. |

### F. Documenter

Keeps a living map of each repository: architecture, business rules and runtime flows, with diagrams, where people and agents read it before changing the code.

| | |
| --- | --- |
| **Output** | Under a docs folder of each repository (`.agents` by default, Documenter → Settings): `00-INDEX` (summary, navigation, glossary, what to read before touching each area), `01` topology and stack, `02` modules and coupling, `03` data model and persistence, `04` entry points and contracts, `05` security and observability, `06` state machines, `07` critical end-to-end flows, `08` technical debt and risks, and `domains/domain-<name>.md` per business domain. Every rule, formula, transition and flow cites `file:start-end`; Mermaid diagrams per file (context, containers, dependencies, ERD, sequences, state machines, risk heatmap). Written in the General output language. Other files already in the folder are kept. |
| **Trigger** | Every repository of the configured projects, every **N days** (7 by default) and only when its base branch has new commits since the last docs; **Run now** documents every repository at once. *Repositories in parallel* sets how many go at once. |
| **Runtime** | Any provider, write mode, on a worktree of the base branch. The first run writes the whole structure; later runs get the diff since the documented commit and update what it touched. Subagents, where the runtime has them, take one domain each. |
| **Pull request** | The platform reverts every change outside the docs folder, commits the folder on `ai/docs` and opens one PR per repository against the base branch, or updates the open one (force-push and a comment). A docs branch holding someone else's commits is never overwritten: the repository goes to the Inbox. Merging stays with humans. |
| **Never** | Change code, tests or configuration, run builds or installs, or write a secret's value into the docs. |

### Project brain

Each registered project has a brain: lessons the agents learned while working on it, so later runs start from them instead of rediscovering them (environments, databases and RLS, build and test quirks, conventions reviewers enforce, decisions people made).

| | |
| --- | --- |
| **Storage** | An Obsidian-compatible vault per project under `/data/brain/<project>` (bind-mount it to open it in Obsidian): one Markdown note per lesson, with front matter (`tags`, `repos`, `source`, `updated`), `[[links]]` between notes and an `INDEX.md` linking them all. Backed up daily with the database. Shared by every agent and run of the project, never across projects. |
| **Read** | Each run gets a frozen copy in its workspace (`brain/`), searchable with grep, and the notes most relevant to its task (full-text search, accents ignored, about 2k tokens) in its prompts, with a pointer to the Documenter's `00-INDEX.md`. Notes are data: the task and the code win over them. Notes another run writes meanwhile reach the next runs. |
| **Learn** | Only from signals: people's comments on the card or reviews on the PR, review findings the author fixed, must-pass or pipeline failures that were fixed. When a live run had one, a final **Learn** step (the lead's provider, read-only) returns at most 3 notes, updating existing ones rather than duplicating. Today: Developer runs and PR follow-ups. |
| **Write** | Only the platform writes, one note at a time per project, atomically. A note unchanged since the writer read it is replaced; one changed meanwhile (another run, a person in Obsidian) keeps its text and gets the new one appended under `## Update (run N, date)`. Notes that look like credentials are refused. |
| **UI** | **Work → Brain**: each project's notes, read-only, and a download of the vault. People edit or delete notes in Obsidian. |

### Default SCOPED prompts

Every agent ships its default prompts, versioned in `defaults/prompts/<agent>/` (one prompt per agent, or one per stage when the agent's flow has stages):

| Agent | Prompts |
| --- | --- |
| Approver | `approver/review.md` |
| Dependabot | `dependabot/assess.md` |
| Developer | `developer/plan.md`, `developer/implement.md`, `developer/fix.md`, `developer/address-review.md`, `developer/follow-up.md` (open PRs), and the reviewer's `developer/review-plan.md` and `developer/review-diff.md` |
| Auditor | `auditor/audit.md` (shared by every category) |
| Sentinel | `sentinel/reproduce.md`, `sentinel/explore.md` |

Operators override any prompt with a read-only mount; the UI shows whether each prompt is the default or a custom mount, and cannot change it. Every prompt follows this shape:

```markdown
## Scope      what to do, and how far it goes
## Context    role, tools, and the facts the agent can't guess
## Operations the steps per item, and their output
## Plan B     what to do when the direct path isn't possible
## Edges      boundaries it must never cross
## Done       how we verify the work is finished
```

Platform-provided variables (`{{card}}`, `{{repos}}`, `{{diff}}`, `{{language}}`, …) are documented next to the defaults. Platform rules (output schema, credential and tool limits) are appended after the prompt and cannot be overridden.

## 7. Admin UI

The global nav has a language picker (English, Português, Español, with flags) and a light/dark theme button; both choices are kept in the browser (`localStorage`), and without one the UI follows the browser's language and the system theme. Translations live in `ui/src/locales/` (the English text is the key; a missing one shows in English). Server messages and the agents' output are not translated by the UI: the agents' language is a General setting.

| Screen | Content |
| --- | --- |
| Login | Single admin user from the environment; language and theme can be picked before signing in |
| Home | What waits for a human, a setup checklist until the instance can work, each agent's state and why it is off (linking to the fix), account limits, running and recent runs |
| General | The agents' output language, poll interval and provider fallback on usage limits; **Notifications**: a webhook URL (stored as a secret) that gets a JSON post per event (`text` for Slack, Mattermost and Teams workflows, `content` for Discord, plus `event`, `title`, `url`, `agent`, `instance`, `at`), with a Send test button that reports how it answered. Events, each switchable: something needs a person (an item enters the Inbox, or needs one again for a new reason; dry runs and cards put back in the queue never notify), an agent opened or updated PRs (Developer, Documenter), a provider paused at its usage limit, Dependabot merged a PR (off by default). Sending never blocks an agent: an unreachable webhook is logged. An optional UI address makes the messages link to the Inbox. Also the verify commands per stack. |
| Accounts | GitHub and Jira credentials with a connection test; per runtime the auth method, login flows (URL and code), status and available models |
| Projects | Repositories, stacks, base branch, Jira board, and the test environment (Sentinel) |
| Agent (one per agent) | Overview: state, live or dry run, Run now (redoes the agent's work now, including items already handled: every audit category, every open Dependabot PR, every PR still requesting review, the e2e suites and explorations; the Developer only looks for cards, since redoing one would open a second PR; a Run now whose poll fails, e.g. GitHub down, is kept for the next poll), Stop, last runs, its inbox items. Settings: enable, dry run, trigger, provider and model per role, loop limits, policies. Prompts: its prompts read-only with their source (default or custom mount). Global instructions and skills have their own read-only page. |
| Runs | Live stages, logs, tool calls, artifacts. **Kill switch** per run and per agent. **Cleanup**: delete selected runs, or all runs older than a date or per agent, with their logs and transcripts, after a confirmation that shows what will be removed. |
| Inbox | Open questions, parked runs, Dependabot PRs waiting for a human |
| Findings | Audit history per repository and category, with new / still open / fixed findings and Create Jira card |
| Brain | Each project's brain: its notes (read-only) and a download of the vault; people edit them in Obsidian |
| Usage | Each provider's account limits as its last run reported them (usage windows with their resets: Claude Code per plan from its runs; Codex per plan and agy per model group, also read every 10 minutes without a model call, from `codex app-server` and agy's `/usage`, so they stay current while an account is blocked) and a hit limit's pause, which **Try again now** lifts; tokens and Claude's estimated cost per run, and totals by agent, by model and by day |
| Activity | Audit log |

Navigation groups the screens by intent: **Home**, **Work** (Inbox, Runs, Findings, Brain, Usage), **Team** (the agents) and **Setup** (Projects, Accounts, General, Instructions, Activity). A bar on every page names the agents that are live. The visual language follows `docs/DESIGN.md`: one accent color for actions, hairline cards, light and dark themes.

## 8. Technical direction

| Area | Choice | Why |
| --- | --- | --- |
| Server | Node + TypeScript (run directly with type stripping), `node:http` with a small router | No runtime dependencies to patch or audit |
| Database | `node:sqlite` (WAL), one document per settings section, plus runs, events, items and audit tables | Built into Node, one file in the `db` volume, online backups with `backup()` |
| Secrets | AES-256-GCM with a key derived from `AGENTCOWORK_SECRET_KEY`; stored only encrypted, never sent to the UI | |
| UI | React 19 + Vite, plain CSS with light and dark tokens, hash routing | The only build-time dependencies; the image ships static files |
| Runtimes | Native CLIs in the image. `script` (util-linux) provides the pseudo-terminal the Claude and agy account logins need | No native Node addons |
| Packaging | One image, one container per company | Isolation decision |

Code copied from Paperclip keeps its MIT copyright notice in the copied files. (The current implementation reuses Paperclip's ideas, not its code.)

## 9. Out of scope (for now)

- Budgets and cost limits. Usage is recorded per run, but nothing is enforced.
- Multiple users and roles.
- Trackers other than Jira Cloud, and hosts other than GitHub.
- Merging by the developer agent.
- E2E sentinel and golden-set evaluation (planned for later).

## 10. Phases

| Phase | Delivers | Done when |
| --- | --- | --- |
| **P0 Foundation** | SQLite, API, admin login, Integrations, Providers (Claude Code and Codex, both auth methods), Projects, Runs and Activity screens; current features migrated | The current review and Jira flows run from database config with no env files beyond bootstrap |
| **P1 Approver** | Agent C on the new platform, SCOPED prompt, provider choice | Same results as today in dry run, with either Claude Code or Codex |
| **P2 Dependabot** | Agent B with the semver merge policy | Patch and minor PRs merged on a test repository; majors routed to a human |
| **P3 Developer** | Agent A: staged lifecycle, subagents with per-role models, Codex review gate, kill switch | Draft PRs with green verification and a resolved Codex review on a test board |
| **P4 agy** | Provider spike, then the adapter | Headless output and both auth methods validated |

## 11. Open questions

1. `agy`: see the spike results in `docs/spikes/agy.md`.
