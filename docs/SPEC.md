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
| **Secret** | Encrypted value: API keys, account tokens, GitHub and Jira credentials, database passwords. Never returned to the UI after it is saved, only shown as "set". |
| **Integration** | GitHub (token of the user the agents act as) and Jira (site, email, token). Each has a "test connection" action. |
| **Provider** | An agent runtime: `claude-code`, `codex`, `agy`. It has an auth method (`api-key` or `account`), a status, and a list of models. |
| **Project** | A set of repositories under a unique name, each checked out side by side in a folder named after the repository (`acme/web` → `web/`), with its stack (Node.js, React or .NET), whose default `verify` commands live under General and can be replaced per repository; one base branch per project, plus the Jira board its cards come from (the Developer's trigger JQL runs within it), and optional databases (see Project databases). |
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
- Repository hooks and MCP configs from checked-out branches are ignored. The platform's own git runs with a checkout's hooks, fsmonitor, credential helpers, `ext::` remotes and signing off, reads no global config, and fetches from and pushes to `https://github.com/<repo>.git` itself from a bare repository only it writes, which borrows the checkout's objects: a checkout's config (its remotes, a proxy, a credential helper) never reaches a command holding the GitHub token. Only `gh` and those commands get the token, which is never in the process environment.
- **Runtime config is reset before each call**: Claude Code gets a fresh config directory holding only the platform's instructions and skills; Codex's `config.toml` and agy's settings and extensions are removed (their logins stay). Nothing an earlier call wrote there (a hook, a notify program, an MCP server, a plugin) runs.
- **Agents run as their own Linux user** (`agent`), apart from the platform's (`node`): the runtimes, the repositories' commands (verify, the Sentinel's suites, the Auditor's package tools) and the account logins. That user has no capability and cannot read the platform's process (its environment holds the secret key), database, logs, brains or backups. It writes only the checkouts, the package caches, the runtimes' logins and a fresh HOME per call; it reads the repository caches but cannot write them (their config, their hooks). The container starts as root only to set this up (`entrypoint.sh`), then runs as `node` with SETUID, SETGID (switch to `agent`), KILL (stop its processes) and DAC_OVERRIDE (read and remove what it writes). When the last agent process ends, whatever that user still runs is killed. A container started as `node` (an older compose) runs agents as the platform's user, and General says so.
- **Agents reach the network only through the platform's proxy, and only allowed hosts**: a firewall rule (nftables, set at start) refuses every address but loopback to the `agent` user, Docker's DNS included; the proxy on loopback lets through the hosts in **General → Network** (by default the runtimes' APIs and logins, GitHub downloads, and the npm, NuGet, PyPI and Playwright registries) and the hosts of the projects' test environments. `*` allows any host. Refused hosts are logged and listed in General, to add what agents need (a private registry). The platform's own requests (GitHub, Jira, the databases) do not pass through it.
- **Known limits**: agents of concurrent runs share the one `agent` user, so they can reach each other's checkouts, and a process one leaves lives on while another run's agent works; the package caches are shared, so a run could plant a package another run then uses. An allowed host is allowed on any port, and one that accepts uploads with someone else's credentials (GitHub, a registry) still carries data out. Link-local addresses (a cloud's metadata service) are never reached, even with `*`.
- **No automatic retries**: a failed item goes to the Inbox and is picked up again only when a person clicks Retry; a provider usage limit is not a failure (the provider pauses and the item runs after it). With **Switch provider on a usage limit** (General, on by default) a call whose provider is paused or hits its limit moves on to the next one, Claude Code, Codex then agy, with that provider's default model (a Developer reviewer takes the lead's or the other reviewer's provider last); only when all three are limited does the run fail and wait. Browser steps stay on Claude Code.
- **Read-only is enforced by the platform** for every runtime: before a read-only call the platform snapshots HEAD and the working tree of each checkout, and afterwards reverts any change and records a warning on the run. The container (agents as their own user with no capability, read-only root, allowed hosts only, no GitHub or Jira credentials) is the sandbox.
- `agy` ships as **experimental**; see [the spike](spikes/agy.md) for what is validated and what still needs real credentials.

## 6. Agents

### A. Developer

Turns Jira cards into verified draft pull requests.

| | |
| --- | --- |
| **Trigger** | A card on a project's board with the `agent-ready` label (configurable), within the JQL every agent that takes cards shares (`jira.readyJql`, GitHub and Jira → Jira; `statusCategory != Done` by default, e.g. `statusCategory != Done AND status = "Ready for AI"`). A trigger JQL saved before it becomes both: its label, and the rest as the shared JQL. |
| **Card flow** | Shared by every agent that takes cards (`jira.startTransition`, `blockedTransition`, `reviewTransition`, `readyTransition`; GitHub and Jira → Jira; a transition or status name, empty leaves the card): taken, the card moves to `In Progress`; waiting for people's answers, to `Blocked`; waiting for their approval of a finished proposal, to its own status (e.g. `Ready For Review`; empty, the same as waiting for people), so the board tells a question from a proposal to approve; handed to another agent, to the hand-off status (empty by default; with a JQL that names a status, that status, so the next agent finds it). A card already in the status stays. **Assigned** (`jira.assign`, on by default): a card an agent takes is assigned to the Jira account the agents act as, before it moves (a workflow may ask for an assignee), so the board shows who is on it; a refused assignment (the account lacks the Assign issues or Assignable user permission) is a warning on the run and the work goes on, and **Check on Jira** reports both permissions. Moves saved on the Developer before become the shared ones, and the hand-off defaults to the status the JQL names. The Developer's own moves are only when its PRs open and when they merge. **Work log** (`jira.worklog`, off by default): each live run on a card (the Developer's, its PR follow-ups and what it learns from how they ended, the Product Manager's) logs its time there as a Jira work log, apart from the comments, saying the agent, the run, its tokens, then each model it called with that model's time and tokens, and a link to the run when the UI address is set (Notifications); the estimate stays and nobody is notified. It counts in Jira's time reports like people's time; a run cut by a restart logs nothing, and a refused entry (time tracking off) is a warning on the run. **Check on Jira** reports whether time tracking is on. |
| **Lead** | Claude Code. It plans, splits work and owns the card. **Plan model** (`planModel`, empty by default): the plan alone on another model of the lead's provider; the lead's model builds, fixes and follows up. The most capable (and costliest) models pay off in plans of ambiguous or multi-repository cards, the weekly security audit and discovery, not in coders, Dependabot, the Documenter, the Sentinel or follow-ups; **Outcomes by model** (Usage) and the golden set measure it. |
| **Subagents** | Roles with their own model: `coder`, `tester`, `verifier`. They are grouped by shared code context, not by business area. With them, they write the code: the lead hands each a step with its files, documents and role, runs independent steps in parallel, reviews their changes and re-verifies, and writes only the glue itself. Each is written as a role: what it reads first, how it works, what it may edit (the coder only its step's files, the tester only tests), what it delivers (with what it could not verify) and what it hands back to the lead; neither reverts changes it did not make. |
| **Reviewers** | Up to two independent reviewers, each switchable and with its own runtime and model (first on with Codex, second off by default), read-only. They audit the plan and the final diff in parallel; the review passes only when each one passes, and the lead gets every finding (the second reviewer's marked). With none on, plans and diffs go unreviewed and only the must-pass commands and the people on the PR check the work. |
| **Output** | One draft PR per changed repository, a Jira comment (Plan / Result / How to test) and a status transition. The reviewed plan goes on the card as `developer-plan.md` before anything is built, in place of the one before (attached first, then the older copy removed), so people see what is being built and why; runs never read it back. |
| **Never** | Merge, deploy, write to databases, or change CI configuration (the platform refuses to push it). |

Lifecycle (run by the platform):

*Cards in parallel* (1–4) sets how many cards run at once, across projects and within one: each card has its own checkout and branch `ai/<card>`.

| Stage | Agent work | Gate |
| --- | --- | --- |
| 1. Intake | Pick the card, lock it, move it to In Progress; fetch the failed-step logs of GitHub Actions runs the card links (the project's repositories, at most 3) into the prompts | Atomic checkout, so one run per card; agents get no GitHub token, so the platform reads CI for them |
| 2. Plan | Load skills, map the code and its history (`git log`), write the plan with the files it changes and the tests it adds (`files`, `tests`); **Codex reviews the plan** | **Plan review gate** (round limit). Questions go to the card **in one batch**, then the run waits. |
| 2b. Kind | The plan declares what the card needs: **code** (the steps below), **promote** (the platform opens PRs between existing branches of the project's repositories, e.g. `develop` → `qa`, with the plan as their description; never merges, and the follow-up does not watch them), **answer** (the answer goes on the card) or **handoff** (a checklist for a person with access agents lack: cloud settings, secrets, consoles; the card waits for a comment). A database change, schema or data, is **code**: an idempotent script in the repository, following its convention | The reviewers check the kind fits the card; outside code, their minor notes from an approved review are appended to the plan the person reads. Promotions must be two different branch names of a repository of the project; GitHub's compare proves both exist. The agent never gets the GitHub token. |
| 3. Build | Reproduce with a failing test, fix the root cause. A card whose spec has a `tasks.md` (a medium or larger change) is built **one task per call**, in order, the run's time limit raised by *extra minutes per spec task* (20 by default) for each task: each call is told its task and that the earlier ones are committed, then Verify and Validate run on that task (its rows of the `## Checks` table; the last task, every row) before the next starts, and the task's Jira sub-task moves to in progress, then done. A verified task leaves a **checkpoint**: a ref in each repository's cached clone (`refs/agentcowork/<card>/<task>-<fingerprint>`, never pushed), the fingerprint chained in build order over the exact base of each repository, what people wrote on the card, `design.md` and the ADRs, every earlier task, and the task's own text, the criteria it covers and its checks rows. A later run of the card (after a hand-back to the Product Manager, a failure or the time limit) resumes after the tasks whose checkpoint it finds; a moved base, a new comment from a person or a changed design builds everything again; the last task is always built again, and a task built again moves its sub-task back to in progress. Opening a real PR (not a dry run) clears the card's checkpoints, so rework after it builds from the base. The PR description has one section per task. A small spec, whose few tasks sit in `spec.md`, is built in one call like a card without a spec, its sub-tasks moved together. | — |
| 3a. Browser check | Only with a Claude lead, in a project with a React repository (`browserCheck`, on by default) | Each build call gets headless, isolated browser tools (the image's Playwright MCP and Chromium) whose requests are filtered to `localhost`/`127.0.0.1` (an origin filter that keeps the browser on the app, not a security boundary: a redirect can leave it). When the change alters what a person sees, the lead follows the `browser-check` skill: starts the app from its checkout, walks the changed screens, reads the console and failed requests, tries a narrow viewport and the keyboard, and reports what it checked under How to test. Screenshots land in the run's log, never in the repository. On a provider the call falls back to, it builds without the browser. Whatever a runtime call leaves running (a dev server) is killed with it when the call ends. |
| 4. Verify | — | **Hard gate**: the platform runs each changed repository's `verify` commands. Red returns to Build (round limit). |
| 4b. Validate | Only for a card with a spec from the Product Manager | **Spec gate**: every test the spec's `## Checks` table names (per task, when built per task) is in the change (the file changed, a case of that name in it). A missing one returns to Build like a red verify, in the same round limit. The PR description lists each criterion with the test that proves it. |
| 4c. Platform checks | — | **Push gate**, before the diff review and again before shipping, on the base fetched from GitHub: a change to `.github/workflows` or `.github/actions` (a pushed branch runs them with the repository's secrets) or an added line shaped like a credential (token prefixes, AWS key ids, private keys) parks the card, without repeating the line. Deleted or skipped tests, a lockfile changed without its manifest, files outside the plan's, the plan's tests missing, a URL with a password or a JWT, and a change over 2,000 lines go to the reviewer, who judges each, and to the PR under **Platform checks**. The PR follow-up checks what each push adds (blocked, it asks on the PR) and the Documenter its docs. The diff is read as git has it whatever the checkout's config and attributes say: every file as text, no external diff or textconv, names NUL-separated and paths never pathspec magic. |
| 5. Review | **Codex reviews the diff**; the lead fixes findings | **Diff review gate** (round limit). Disagreement parks the run for a human. |
| 6. Ship | Draft PR, card comment, transition (reviewers come from the repository's CODEOWNERS or rules) | **Human gate**: merge |
| 7. Follow-up | Until every PR of the card is merged or closed (on merge the card moves to the configured status): answer each review thread and comment of the repository's own people (owner, member or collaborator) and installed apps, ignoring anyone else's (fix it and resolve the thread, or decline it with a justification and leave the thread open for the reviewer), and keep the pipeline green (build, tests, quality gates such as SonarQube, conflicts with the base branch), reading the failed job logs and check reports | Local `verify` before every push. Red rounds have a limit; at the limit the agent says so on the PR and waits for a person. The card is done only when its PRs close. |

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
| **Output** | Under a docs folder of each repository (`.agents` by default, Documenter → Settings): `00-INDEX` (summary, navigation, glossary, what to read before touching each area), `01` topology and stack, `02` modules and coupling, `03` data model and persistence, `04` entry points and contracts, `05` security and observability, `06` state machines, `07` critical end-to-end flows, `08` technical debt and risks, and `domains/domain-<name>.md` per business domain. The index names the commit it describes and maps **every** file in the folder, people's own ones and the specialist roles included; after the run the platform lists at its end (`## Not described yet`) any file the map does not name, and the next run describes them. Every rule, formula, transition and flow cites `file:start-end`; Mermaid diagrams per file (context, containers, dependencies, ERD, sequences, state machines, risk heatmap). Written in the General output language. Other files already in the folder are kept. |
| **Trigger** | Every repository of the configured projects, every **N days** (7 by default) and only when its base branch has new commits since the last docs; **Run now** documents every repository at once. *Repositories in parallel* sets how many go at once. |
| **Runtime** | Any provider, write mode, on a worktree of the base branch. The first run writes the whole structure; later runs get the diff since the documented commit and update what it touched. Subagents, where the runtime has them, take one domain each. |
| **Pull request** | The platform reverts every change outside the docs folder, commits the folder on `ai/docs` and opens one PR per repository against the base branch, or updates the open one (force-push and a comment). A docs branch holding someone else's commits is never overwritten: the repository goes to the Inbox. Merging stays with humans. |
| **Never** | Change code, tests or configuration, run builds or installs, or write a secret's value into the docs. |

### G. Product Manager

Turns a card into the documents a developer builds from, before any code: what must be true, what is built, and in what order. Method adapted from the Tech Leads Club `tlc-plan` and `tlc-spec-driven` skills and compozy's question protocol (skill `spec-writing`, with its notice).

| | |
| --- | --- |
| **Trigger** | A card on a project's board with the `agent-spec` label (configurable), within the shared JQL (`jira.readyJql`, as for the Developer), moving along the shared card flow like the Developer's: `In Progress` when taken (an approved discovery stays there while its cards are built), `Blocked` while its questions wait, the approval status while a finished spec or discovery waits for people (its comment opens with a green panel, "Ready for review" in a larger title and what to reply in bold, before the summary; questions open with a yellow one, as the Developer's do; a site that refuses panels gets the same words, the title in bold), the hand-off status when it goes to the Developer; with the `agent-discovery` label (configurable), it gets a discovery instead (below). Back on a card already specified, the label asks for a new version: comment what to change, then put it back. **Run now** takes every labelled card again. |
| **Questions** | Gray areas (decisions that are people's, with more than one defensible answer, that the code does not settle) go to the card **in one batch** before any document is written, after a few lines of what the Product Manager understood (so people can correct the reading itself): numbered, each with why it matters and 2 to 4 options, one recommended; people answer like `Q1 a`. Two are easy to miss and always asked when they change what gets built: why the card is wanted, when it does not say (the one open question, answered in words), and a choice between ways to build it that differ in what users get, the cost or the time. The card waits; an answer resumes it. Unless approval is on, nobody reviews the documents before the Developer builds them, so nothing may rest on a guess. |
| **Output** | Markdown attachments of the card, sized to the change: `spec.md` always (problem and what must not get worse, acceptance criteria in EARS with concrete values, out of scope, assumptions, and the shape of the change when it has one), `tasks.md` (ordered tasks, each with its test; every criterion mapped to a test), `design.md` and `ADR-NN-*.md` only when the work needs them, and with approval on, a clickable prototype `mockup-<flow>.html` of each screen flow the card changes. Headings in English, prose in the output language. A version is attached whole, and only when something changed; a new version starts from the card's current documents, and one it leaves out is dropped. Each ADR also becomes a lesson of the project brain, so later cards conform to it. |
| **Runtime** | The lead (Claude Code by default) runs read only, like every call that reads people's text, on checkouts of the project's repositories: it returns the documents and the platform saves them, refusing any name outside the layout. Independent reviewers, configured like the Developer's (none, one or both; Codex first by default, the second off until switched on), read the documents read-only against the request and the code, in parallel; with both, each must approve. The lead revises them for blockers and majors, up to the round limit (2). Findings still open go on the card for the people reviewing the code. |
| **Layout check** | Before any reviewer, after the first version and after each revision, the platform checks what it reads from the documents: tasks it can parse (`### T1: …` in `tasks.md`, or `1. **T1** …` under `## Tasks` of a small `spec.md`), no task id used twice, criteria under `## Criteria` (`- **AC1** …`), a `## Checks` row with a named test and an existing task for every criterion and only for criteria, and task ids kept from the previous version (a kept title keeps its number). A problem goes back to the lead to fix, twice at most; past that the run fails and a later poll tries again. Costs no model call when the documents are right. |
| **Hand-off** | To the Developer, straight away or after approval (below): the platform attaches the documents (one current version on the card: once the new set is attached, every older document and prototype of the layout is removed, a file people attached under one of those names included; the run logs keep each version), comments a summary on the card, swaps `agent-spec` for the label the Developer's trigger names (`agent-ready`) and wakes the Developer. The Developer saves the card's current Markdown attachments in its workspace (of the spec documents, the newest set): with a `spec.md` it builds the tasks in order, one call each (stage 3), gives every criterion a test and never edits the documents, and its reviewers treat a criterion without a step or a test as a major finding. Before the PR, the platform checks that each test the `## Checks` table names is in the change (Developer stage 4b). The human gate is the review of the code's pull request. |
| **Approval** | Off by default (`agents.pm.approval`): the card goes straight to the Developer. On, the documents are attached (and the sub-tasks kept) as usual, the card keeps `agent-spec` and waits, and its comment asks a person to reply with only `approved` (`aprovado`, `aprobado`, `LGTM`; case, punctuation and emoji aside). When every comment people wrote since is such a word, the Product Manager hands the card over without a model call. Any other comment asks for changes: a new version is written from the discussion and posted for approval again, so a change request is never dropped for a later approval. When the card changes a screen, a clickable prototype (`mockup-<flow>.html`) is attached with the documents: one self-contained HTML file per flow drawn in the product's look with fictional data, showing only what the criteria say, downloaded and opened in a browser. The platform puts a content policy right after its doctype that blocks every request (inline CSS, scripts and `data:` images only), and sends a prototype that names a web address (even encoded) or is no whole document back to the lead, like a layout problem; reviewers flag a screen change without one. The policy is not a boundary against navigation (a link, or an address a script builds), which only someone who can write the card could plant. The Developer gets it with the documents and follows its content and flow with the repository's own components; the criteria win where they differ. Whoever can comment on the card can approve it, as whoever can label it can start the agent. Retry or a restart with nothing new on the card keeps it waiting, and a run that fails or is stopped keeps the wait, so its retry reads the same comments. In dry run the summary says it would wait. |
| **Sub-tasks** | On by default (`agents.pm.subtasks`). At the hand-off each task of the version gets a Jira sub-task of the card named `T1: <deliverable>`, the project's sub-task issue type found by Jira's own flag (its name differs per site). A new version renames the sub-tasks whose title changed, creates the new ones, and comments on and closes those of dropped tasks. The documents stay the source of truth: the sub-task says to change the spec, not the sub-task. Board searches skip sub-tasks, so no trigger JQL makes one a card of its own. A project without a sub-task type, or a Jira error, leaves a warning and the hand-off goes on. |
| **Discovery** | For work people explore and approve before anything is specified, such as rethinking how a product looks and flows. A card with `agent-discovery` (`agents.pm.discoveryLabel`), usually an epic, gets after the same questions, `discovery.md` (the problem, the screens and flows as the code has them today, the proposed direction screen by screen, a technical analysis against the code with what is reused, what changes, what is new, the risks and the relative effort, the cards proposed to build it in dependency order, out of scope, assumptions) and, when it changes what people see, clickable prototypes of the main screens (`mockup-<area>.html`) in the proposed look, sealed offline like the spec's. No criteria, tasks, ADRs or sub-tasks. The reviewers check it with a discovery checklist, and a person always approves it on the card, whatever `approval` says: "approved" takes the label off and asks for the cards that build it to be created **as children of the discovery's card**, with `agent-spec`; any other comment gets a new version. Nothing goes to the Developer, and both labels come off, so the discovery itself is never specified; a spec's hand-off likewise removes a discovery label. The discovery is searched in the board's project rather than on the board, since boards leave epics out; a card waiting on people stays what it was posted as, whatever its labels become meanwhile, and labels match whatever their case, as in Jira. Its children are the epic's stories and tasks (sub-tasks are never picked up as cards). A child card is specified from its parent's current `discovery.md` and prototypes, saved read only in its workspace; with approval on, its own prototype covers only what it changes beyond them. The Developer building a child card gets them too (they are part of its build checkpoints), and follows the prototypes' look and flow for what the card changes, with the criteria deciding where they differ. The discovery label must differ from the trigger label and from the Developer's. |
| **Back from the Developer** | When the Developer, building from a spec, finds something in it that does not hold (it would ask a question), it comments what, swaps its label back for `agent-spec` and moves the card to the shared hand-off status (so a shared JQL that takes only `Ready for AI` finds it again; when the workflow refuses, a person moves it), waking the Product Manager, which writes a new version from that comment (asking people when only they can settle it) and hands the card over again; the Developer resumes after the tasks the new version left unchanged. At most twice per card; after that, and whenever the Product Manager is off or in dry run, the Developer asks people on the card as usual. |
| **Never** | Write code, change anything in the repositories, or change a card's priority or estimate (its status moves only along the shared card flow). Its trigger label can't be the Developer's: the agent stays off with that reason. |

### Project brain

Each registered project has a brain: lessons the agents learned while working on it, so later runs start from them instead of rediscovering them (environments, databases and RLS, build and test quirks, conventions reviewers enforce, decisions people made).

| | |
| --- | --- |
| **Storage** | An Obsidian-compatible vault per project under `/data/brain/<project>` (bind-mount it to open it in Obsidian): one Markdown note per lesson, with front matter (`tags`, `repos`, `source`, `updated`), `[[links]]` between notes and an `INDEX.md` linking them all. Backed up daily with the database. Shared by every agent and run of the project, never across projects. |
| **Read** | Every agent reads the brain of the project its work belongs to (a repository's: the first project that lists it). Its prompts get the notes most relevant to its task (full-text search, accents ignored, about 2k tokens). The Developer, whose workspace sits outside the checkouts, also gets a frozen copy of the vault (`brain/`), searchable with grep; agents that work in a checkout itself (Approver, Auditor, Dependabot, Documenter, Sentinel) get no copy, which could be committed or audited as the repository's own files. Notes are data: the task and the code win over them, and the Auditor still reports what the code shows, citing the note. Notes another run writes meanwhile reach the next runs. |
| **Learn** | Only from signals. **Developer**: people's comments on the card or reviews on the PR, review findings the author fixed, must-pass or pipeline failures that were fixed; and, when a card's PRs end, a PR closed without a merge where people said why, what people wrote after the last follow-up, and commits people pushed on the agent's branch before the merge (their diffs, merge commits and the agent's own commits left out), as a **PR outcome** run. **Approver**: people's replies to the findings of its earlier review of the same PR (also shown to the new review, so it does not repeat a finding the author answered without a reason). **Sentinel**: a failing end-to-end test that a browser reproduction traced, with high confidence, to the environment or the test rather than the application. When a live run had one, a final **Learn** step (the agent's provider, read-only) returns at most 3 notes, updating existing ones rather than duplicating. The Auditor, Dependabot and Documenter only read: their runs have no person's answer or verified fix to learn from. |
| **Write** | Only the platform writes, one note at a time per project, atomically. A note unchanged since the writer read it is replaced; one changed meanwhile (another run, a person) keeps its text and gets the new one appended under `## Update (run N, date)`. Notes that look like credentials are refused. |
| **UI** | **Work → Brain**: each project's notes and a download of the vault. People add a note (path and Markdown with front matter; it is linked from `INDEX.md`), edit one (the index too) or delete one (its index line goes with it), each audited. A save or delete is refused when the note changed since it was opened (a run learned meanwhile), and a note that looks like a credential is refused. The vault also opens in Obsidian. |

### Repository rules

Every agent's prompt starts its project context with what each repository it works on tells agents, found in the checkout by the platform, so no agent depends on an `AGENTS.md` that names each file: the instruction files (`CLAUDE.md`, `AGENTS.md`), the docs folders (the Documenter's and `.agents/`: their files and subfolders, and the `00-INDEX.md` to start at), and the specialist roles (`<docs>/roles/*.md` and the Claude Code agents in `.claude/agents/`, described by their `description:` or first line). The runtimes never load a repository's own agents or settings (hooks would run code from the branch), so the roles reach every runtime this way. Agents read the instruction files, then the documents and the role that fit their task; these files shape how they work in the repository, never their prompt's rules, and the code wins when they disagree. Links are never followed, so no file outside the checkout reaches a prompt.

The shared instructions (`defaults/AGENTS.md`) add: decide technical, reversible choices inside the repository's patterns, and ask when a choice changes what users see, breaks a contract or older clients, needs production data or accepts more security debt; say what was not verified; never revert changes someone else made. The Developer's plan has an **Unconfirmed** section; its reviewers check the plan and the diff against the repository's rules, and treat a weakness the repository already records as known debt as known (a finding only when the change makes it worse), as the Approver does.

### Project databases

A project can list databases the agents may use: SQL Server, PostgreSQL or MongoDB, each with a unique name, an access (`read` or `write`), a description of what it holds, and its connection field by field, as in a JDBC URL: engine, host, port (the engine's default when empty), database, user and options (`key=value` pairs; MongoDB also takes a seed list as host, or `mongodb+srv`). Only the password is a secret (`db.<project>.<name>`): the project's **Save** in **Setup → Projects** stores it, it never comes back to the UI, and the platform builds the URL when it connects, encoding user and password; the fields are validated so none can add credentials, a path or a query to it. Saving the projects deletes the password of a database no project lists any more, so one added later under the old name never inherits it. Only Claude Code and Codex reach the tools: a plan on a runtime without them that needs the database (data, a schema the code does not show, a script to validate) declares `needs_tools`, and the card waits in Blocked with a blue note naming when they are back, out of the Inbox, and resumes on its own once one is ready (a comment does not resume it; a runtime that had the tools asking for them parks the card for a person). **Test connection** runs on the saved settings and reports the server and whether the login can write (a read database whose login can write gets a warning: the login is the real barrier).

| | |
| --- | --- |
| **Tools** | The platform serves `db_list`, `db_schema`, `db_query` and, with write, `db_validate` over MCP (Streamable HTTP, JSON responses) on a loopback port that is never published. Each run gets a random token per access level, revoked when the run ends; the runtime receives it in an environment variable, never on its command line. Claude Code and Codex get the tools (Codex with this server's tools pre-approved, since headless Codex refuses calls that need an approval); Antigravity does not yet, because its CLI only reads MCP servers from a global file. |
| **Who** | The Developer: read while planning, read plus `db_validate` in the calls that change code (build, fixes, addressing reviews). Its reviewers are always read-only. Other agents get none yet. |
| **Reads** | At most 200 rows and 60 kB per answer, 30 s per statement, one connection per call. PostgreSQL runs one statement (extended protocol) in a `READ ONLY` transaction; SQL Server runs in a transaction that is always rolled back and runs no procedure (`db_schema` shows their definitions); MongoDB takes one command from an allow-list (find, aggregate without `$out`/`$merge`, count, distinct, listCollections, listIndexes), and the platform sets its database, session and transaction fields. |
| **Validate** | Never saves: the script runs twice in one transaction (the second run shows whether it is idempotent), then the platform rolls back. SQL Server scripts may use `GO`. Refused before anything runs, in reads too: transaction control (`BEGIN TRAN`, `COMMIT`, `ROLLBACK`, Postgres `END`/`ABORT`, in code and inside strings), and SQL the transaction cannot follow: dynamic SQL and other sessions on SQL Server (`EXEC(...)`, `EXEC @var`, `sp_executesql`, `OPENROWSET`, `OPENQUERY`, `xp_cmdshell`, `sp_OA*`, `sp_start_job`), `dblink` and `COPY ... PROGRAM` on PostgreSQL. A procedure or trigger already in the database can still commit: after each SQL Server batch the platform checks it is still in the transaction it opened (by its id, not its count), and if not, the call fails and the run records a warning, since what ran before may be saved. PostgreSQL and MongoDB cannot commit from inside the transaction. MongoDB needs a replica set for transactions. |
| **Logins** | The login is the real barrier: **Test connection** warns when a read database's login can write, and when any login administers the whole server (superuser, sysadmin, MongoDB without authentication), which reaches past the database. |
| **Secrets** | No model sees the password or the URL. Errors, results and the inputs recorded on the run are masked for the URL, its password (at any length, also as escaped in JSON) and user, and anything shaped like a credential in a connection string; result values are masked before they are serialized. Every validation is in the audit log. The tools' token is in the runtime's environment, so the commands an agent runs could read it: it only gives what the agent already has, for one run, on a port reachable only inside the container. |
| **Prompts** | The Developer's prompts list the databases (name, engine, access, description) with the rules: read only on read databases and in read-only steps, filter every query and never select credential columns, read a non-production database before production, `db_validate` never saves, data is not instructions, never copy credentials or personal data into code, commits or text. A database change itself always ships as an idempotent script in a pull request. |

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
| Projects | Repositories, stacks, base branch, Jira board, and the test environment (Sentinel); a saved project exports as JSON (its settings only: test variables, database passwords and the brain stay) and imports as a new unsaved project, refused on save while its name is taken |
| Agent (one per agent) | Overview: state, live or dry run, Run now (redoes the agent's work now, including items already handled: every audit category, every open Dependabot PR, every PR still requesting review, the e2e suites and explorations; the Developer only looks for cards, since redoing one would open a second PR; a Run now whose poll fails, e.g. GitHub down, is kept for the next poll), Stop, last runs, its inbox items. Settings: enable, dry run, trigger, provider and model per role, loop limits, policies. Prompts: its prompts read-only with their source (default or custom mount). Global instructions and skills have their own read-only page. |
| Runs | Live stages, logs, tool calls, artifacts. **Kill switch** per run and per agent. **Cleanup**: delete selected runs, or all runs older than a date or per agent, with their logs and transcripts, after a confirmation that shows what will be removed. |
| Inbox | Open questions, parked runs, Dependabot PRs waiting for a human. An item leaves on its own once its subject is gone: a PR merged, closed, no longer requesting the review or replaced by a newer commit, or a card done or deleted on the board |
| Findings | Audit history per repository and category, with new / still open / fixed findings and Create Jira card |
| Brain | Each project's brain: its notes, which people add, edit and delete here or in Obsidian, and a download of the vault |
| Usage | Each provider's account limits as its last run reported them (usage windows with their resets: Claude Code per plan from its runs; Codex per plan and agy per model group, also read every 10 minutes without a model call, from `codex app-server` and agy's `/usage`, so they stay current while an account is blocked) and a hit limit's pause, which **Try again now** lifts; tokens per run (input, cache and output), and totals by agent, by model and by day; no money cost is shown. **Outcomes by model**: per model, the cards of live Developer runs it worked on, how many merged and closed, and its tokens per merged card (a card counts for every model on it) |
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

- Money budgets. Tokens are recorded per run; the one limit is the **token limit per run** (General, 0: none), checked after each call: a run over it fails and goes to the Inbox.
- Multiple users and roles.
- Trackers other than Jira Cloud, and hosts other than GitHub.
- Merging by the developer agent.
- E2E sentinel (planned for later). The **golden set** is a script, not a screen: `node src/golden.ts KEY... [--model <lead>] [--plan-model <model>]` in the container builds closed cards with merged PRs again in dry run, from the commit their first build started from, with only what the card said then (no comments, no attached plan, no brain), on its own branch and without checkpoints, and runs the tests the merged PRs added or changed against the result. It prints status, review rounds, those tests, tokens and minutes per card.

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
