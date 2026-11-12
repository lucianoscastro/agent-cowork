# Privacy check catalog

Review every check in the default scope. Base severities guide prioritization; the evidence decides the status.

| ID | Check | Base severity | Evidence to review |
|---|---|---:|---|
| PRV01 | Personal data inventory | Medium | Entities, tables, DTOs and forms with personal fields, sensitive categories marked. A system with personal data and no way to tell where it lives is `ATTENTION`. |
| PRV02 | Personal data in logs | High | Logger calls, request/response logging middleware, exception messages and serialized objects that carry names, emails, CPF, phone, address, tokens or free text. Check log levels in production config. |
| PRV03 | Telemetry and analytics | High | Error trackers (Sentry, Application Insights), analytics and session replay SDKs receiving user identifiers, form contents or URLs with personal data in query strings. |
| PRV04 | Masking and minimization in responses | Medium | APIs and screens returning full documents (CPF, card, phone) where a masked or partial value is enough; list endpoints returning whole user objects. |
| PRV05 | Collection minimization | Medium | Fields collected without a visible use, optional fields stored as required, legacy columns still written. |
| PRV06 | Retention and deletion | High | Any retention rule, purge or anonymization job; soft delete that keeps personal data forever; backups and archives that keep deleted data. |
| PRV07 | Data subject rights | High | Ability to export a subject's data, correct it, and delete or anonymize it on request (LGPD art. 18): endpoints, admin tools or documented procedures. |
| PRV08 | Consent and legal basis records | Medium | Where consent is the basis (marketing, cookies, tracking): stored consent with date, version and channel, and the ability to withdraw. |
| PRV09 | Exports and reports | High | CSV/Excel/PDF exports and reports with personal data: who can trigger them, filters by tenant, masking, where the files are stored and for how long. |
| PRV10 | Sharing with third parties | High | API clients, webhooks, email/SMS providers, payment and CRM integrations receiving personal data; only the fields they need. |
| PRV11 | International transfer | Medium | Services and storage regions outside the country receiving personal data (cloud regions, SaaS vendors). Mark `ATTENTION` when only contracts can confirm the basis. |
| PRV12 | Encryption of sensitive data at rest | High | Sensitive categories and government IDs stored encrypted or tokenized where the risk calls for it; key handling. Do not demand encryption of every personal field. |
| PRV13 | Personal data in non-production | Medium | Seeds, fixtures, test files, sample dumps or staging config with real personal data. |
| PRV14 | Children's and sensitive data | Critical | Collection of data about minors or sensitive categories, the safeguards around it, and access restricted to those who need it. `N/A` with a reason when absent. |

## Stack notes

- **Node.js**: request loggers (morgan, pino-http) logging bodies or headers; `console.log(user)`; Prisma/TypeORM entities; Sentry `beforeSend` scrubbing.
- **React**: personal data in `localStorage`, URLs and analytics events; full documents rendered where a masked value would do.
- **.NET**: Serilog/NLog destructuring of entities (`{@User}`), `ILogger` messages with models, EF Core entities and migrations, Application Insights telemetry initializers.

## Consolidating

- A masking or scrubbing control proven in one place does not prove it elsewhere: record the coverage.
- Recommendations must fit the stack and never suggest deleting production data without a human decision.
