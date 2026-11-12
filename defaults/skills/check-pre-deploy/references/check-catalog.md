# 20-Check Security Catalog

Review every category in the default scope. Names and base severities are prioritization aids, not automatic proof. Apply statuses based on actual evidence; stack and product rules may make a check `N/A` or require `ATTENTION`.

| ID | Category | Base severity | Evidence to review |
|---|---|---:|---|
| C01 | API keys in the frontend | Critical | Secrets in code and public environment variables (`NEXT_PUBLIC_`, `VITE_`, etc.); browser-side AI SDKs; confirm a bundle when available and distinguish public-by-design keys. |
| C02 | Secrets in Git | Critical | Sensitive tracked files and local history; use a redacted scanner. A credential found in history requires rotation even if it is gone from HEAD. Without Git, use `N/A`. |
| C03 | Administrative keys in the client | Critical | Service-role/admin keys, admin SDKs, or connection strings imported into/bundled with client code. Confirm the server-only boundary; do not treat anon/publishable keys as secrets by themselves. |
| C04 | RLS and tenant isolation | Critical | RLS/policies or equivalent controls for every multi-user table/collection; reads, writes, search, aggregation, and exports. Missing migrations or access to effective configuration may require `ATTENTION`. |
| C05 | Data encryption | High | Sensitive data at rest, payment data/tokens, algorithms/configuration, and key management. Do not store PAN/CVV when a gateway can tokenize it. Distinguish TLS from at-rest encryption; do not assume all personal data must be encrypted. |
| C06 | Server-side authentication | Critical | Server-side session/identity validation for private routes, actions, functions, and webhooks; verify webhook signatures and do not use frontend state as proof of identity. |
| C07 | Authorization, tenant scope, and IDOR | Critical | Server-side role and ownership checks; map frontend gates to endpoints. Review every handler that reads/updates/deletes objects by ID, plus lists and exports. Review CORS, especially reflected origins combined with credentials. |
| C08 | Mass assignment | High | Request bodies are not assigned directly to entities with privileged fields; confirm allowlists, DTOs, or strict schemas for create/update. |
| C09 | Cookies and sessions | High | Session cookies use `HttpOnly`, `Secure` in production, and appropriate `SameSite`; tokens are not exposed to JavaScript without need. If `SameSite=None` is required, verify CSRF protection. Check platform configuration or a live URL when flags are managed outside the repo. |
| C10 | Password hashing | Critical | Passwords are never stored in plaintext, reversibly encrypted, or hashed with a fast general-purpose hash. Use managed auth or an appropriate KDF such as Argon2id, bcrypt, or scrypt. Use `N/A` when password login does not exist. |
| C11 | Rate limiting | High | Limits on login, recovery, AI, billing, email/SMS, and expensive operations; use shared storage in serverless deployments. Edge protection not visible in the repo may require `ATTENTION`. |
| C12 | Bot protection | Medium | Public signup, login, and forms; verify CAPTCHA/Turnstile or equivalent tokens server-side. Internal apps without public forms may use `N/A`. |
| C13 | SQL/NoSQL injection | Critical | Parameterized queries; search for concatenated/interpolated input and raw queries. Dynamic identifiers/order clauses need allowlists. Do not flag a parameterized template without tracing the API it uses. |
| C14 | Input validation and XSS | High | Server-side schemas; trace input into HTML/DOM, Markdown, templates, and URLs. Verify context-aware escaping/sanitization; an installed library is not enough. Include `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `eval`, `new Function`, and `javascript:`. |
| C15 | Data and error leakage | Medium | Stack traces, internal errors, debug mode, source maps, publicly served files, logs, and sensitive response fields. A public source map alone is usually an attention item, not a confirmed vulnerability. |
| C16 | File uploads | High | Size limits, server-side content allowlists, generated filenames, private storage, and safe delivery; review SVG/HTML and presigned URLs. Use `N/A` when uploads do not exist. |
| C17 | API response limits | Medium | DTOs/explicit field selection, pagination, and hard caps; look for `SELECT *`, whole user objects, unbounded responses, and expensive GraphQL queries. |
| C18 | Security headers | Medium | CSP, framing protection, `nosniff`, Referrer-Policy, and Permissions-Policy; effective configuration may live at the platform/CDN. Without a URL or effective configuration, record a limitation. |
| C19 | HTTPS and TLS | High | HTTP-to-HTTPS redirects, HSTS, mixed content, and TLS verification between services; look for `verify=False`, disabled TLS, and unverified certificates. Code alone does not prove deployed HTTPS configuration. |
| C20 | Vulnerable dependencies | High | Lockfiles, available audit tooling, and automated updates (Dependabot/Renovate or equivalent). Missing lockfiles require attention. Online audits may send names/versions; ask before querying. Without a current tool/database or network access, do not mark `OK`. |

## Consolidation rules

- A control in one handler does not prove the same control in other handlers. Record route/file coverage.
- A generic “no findings” result is never `OK` without a search and review of the relevant surface.
- `ATTENTION` must state what could not be verified and who can verify it (for example, the dashboard owner, infrastructure team, or product owner).
- Recommendations must fit the stack and must not suggest irreversible changes or production migrations without human validation.
- The numeric score is intentionally omitted: show severity counts, coverage, and a categorical verdict instead of implying precision through an aggregate score.
