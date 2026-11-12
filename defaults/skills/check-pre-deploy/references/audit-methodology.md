# Audit Methodology

Use `check-catalog.md` as the full-coverage checklist. Record a status, rationale, evidence, and limitations for every C01–C20 check in the JSON. `OK` requires positive verification; a shallow search with no matches is not enough. Use `OUT_OF_SCOPE` only when the user explicitly limits the request.

## Inventory and evidence

Before searching, identify the stack from actual files: manifests and lockfiles, routes, middleware, database clients, auth configuration, frontend, and deployment/CI/IaC. Explain how each of the 20 checks maps to the stack. Mark a check `N/A` only with a reason.

Build a coverage ledger for all relevant handlers: method and path, entry-point file/line, handler, authentication, authorization, tenant/object isolation, and review result. Include API routes, server actions, serverless functions, and equivalent handlers. Review every sensitive route. If the list is long, divide it into disjoint groups without leaving any handler unreviewed. If subagents are used, assign non-overlapping groups and consolidate the complete route list.

Each confirmed finding must include:

- category, severity, and exploitability conditions;
- exact file and line number, checked against the current file;
- the smallest code excerpt that demonstrates the behavior, with secrets redacted;
- attack path and concrete impact;
- a stack-appropriate fix and verifiable acceptance criteria.

Use severity consistently: **critical** for broad compromise or immediate privileged control; **high** for significant unauthorized access, sensitive data exposure, or privileged actions; **medium** for limited impact or additional exploit conditions; **low** for small, localized impact; **informational** for observations without a confirmed vulnerability. Explain prerequisites such as feature flags, insecure configuration, or public route reachability. Do not raise severity based only on a suspicious pattern.

Record verified protections as strengths, with file/line evidence and the scope actually reviewed. Avoid broad claims such as “the system is secure”; prefer “the reviewed handlers listed below apply X.” List files and environments that could not be assessed.

## 1. User and tenant data isolation

First identify the actual control: RLS/policies, tenant middleware, organization/workspace scoping, user filters, or a combination. Trace the authenticated identity through to the database.

Review tenant data reads and writes, including lists, search, aggregation, reports, exports, and helper queries. Confirm the filter is enforced at a trusted server/database boundary, covers every path, and cannot be removed or bypassed through client-controlled parameters. Do not assume RLS is enabled because the project uses Supabase: verify migrations/policies and client/server key usage. If effective policy can only be checked in a console or deployed environment, mark it unverified.

## 2. Server-side authorization

Find role/permission gates in the frontend (`isAdmin`, `canEdit`, roles, feature gates) and map each privileged operation to its backend handler. Confirm authorization is checked again on the server for every route/action and affected resource; hiding a button or page is not access control.

Record which privileged handlers were paired and verified. A shared control counts only when every handler passes through it and there is no alternate path.

## 3. IDOR and object ownership

Systematically review every handler that fetches, updates, deletes, or exports objects identified by IDs in the path, query, or body. Confirm the handler checks ownership or tenant membership on the object actually loaded, and does not rely on a client-provided ID without a trusted relationship. Include lists, relationships, and bulk operations where identifier substitution could cross tenants.

Do not mark `findById` alone as IDOR. Trace authorization through the query and response. Record every reviewed handler, including those that enforce scope correctly.

## 4. Secrets and credentials

Look for hardcoded credentials in code, configs, manifests, Docker/Compose, CI, Helm, Terraform, scripts, docs, tracked `.env*` files, Git history, and available/generated frontend bundles. Include private keys, passwords, tokens, JWT/webhook secrets, and unsafe defaults such as `${VAR:-...}`. Check whether startup rejects insecure defaults and whether secrets can be overridden correctly.

Use an available local scanner such as Gitleaks in redacted mode. Do not send secret content to external services. When reviewing a match, preserve the variable name and line but replace its value with `[REDACTED]` before displaying or storing it. Redact PEM keys from the `BEGIN` marker through the matching `END` marker; never dump raw key contents into the terminal, report, or temporary files. A secret removed from HEAD may remain in history and still requires manual rotation.

For frontend exposure, confirm whether the value is actually in a public bundle and distinguish public-by-design keys from privileged credentials. If no built bundle is available, state that exposure in the published artifact was not confirmed.

## 5. XSS and user-controlled content

On the frontend, trace data into sinks such as `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `[innerHTML]`, Markdown/HTML renderers, `eval`, `new Function`, and user-controlled `href`/`src` values, including `javascript:` schemes. Verify contextual escaping or sanitization at the sink; the mere presence of a sanitizer library does not prove protection.

On the backend, review user content in HTML templates, emails, and HTML responses. Confirm context-appropriate escaping and sanitization when HTML is intentionally allowed. Distinguish confirmed XSS from sinks with constant/trusted content or proven sanitization.

## Execution practices

- Prefer static review (`rg`, file inspection, and Git) and security tools already installed. Do not create or execute Python scripts, install dependencies globally, or run project scripts without a clear need and risk assessment.
- Git history inspection is local. Prevent credential-bearing lines from appearing in terminal/chat output. Run secret scanners in redacted mode.
- Do not perform active penetration tests to prove a finding. Confirm it from implementation/configuration and document required conditions.
- If a case depends on external infrastructure, mark the limitation and give the owner a safe validation step; do not invent a result.

## Status values

Use these exact status values in the structured data and report:

- `FAIL`: confirmed issue in code or configuration.
- `ATTENTION`: relevant suspicion or an external/production layer that could not be verified; state exactly what remains to be checked.
- `OK`: the control was inspected and positive evidence covers the declared scope.
- `N/A`: the surface does not exist; explain why.
- `OUT_OF_SCOPE`: the user explicitly requested a partial audit; do not count it as coverage or convert it to `OK`.

Record decisions that require the product owner separately from manual actions (for example, rotating a secret, confirming a policy in a dashboard, or enabling a WAF rule). Do not perform external manual actions during a read-only audit.

## Partial scope, incomplete projects, and deployed sites

- If only attached files are provided, assess only those files and state that the rest of the repository/infrastructure was not inspected. If only a URL is provided, do not infer code security: assess only authorized public surfaces and mark code-dependent checks `ATTENTION`.
- In a monorepo, map each check to the app being deployed; do not mix stacks or routes from different services.
- If the directory appears to be a template, stale branch, or wrong repository, highlight that limitation before the verdict.
- For a deployed site, make only authorized passive GET requests to the same origin. Stop on redirects to another origin, private IP, or local address. Without a URL, headers, HTTP-to-HTTPS redirect, cookies, and the published bundle may remain `ATTENTION`.

## Verdict

Use a categorical verdict instead of a numeric score that implies false precision:

- **🔴 DO NOT DEPLOY:** at least one confirmed critical failure.
- **🟠 FIX BEFORE DEPLOYMENT:** a confirmed high failure or an unverified critical control.
- **🟡 REVIEW PENDING:** no confirmed critical/high failure, but relevant checks remain `ATTENTION` or coverage is partial.
- **🟢 NO CONFIRMED BLOCKER IN SCOPE:** no confirmed critical/high failure and no material limitation; this is not a security guarantee.

Show counts by severity and status next to the verdict. Any out-of-scope or unverified category prevents claiming the entire system was covered.
