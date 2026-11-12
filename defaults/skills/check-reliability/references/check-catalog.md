# Reliability check catalog

| ID | Check | Base severity | Evidence to review |
|---|---|---:|---|
| REL01 | Swallowed errors | High | Empty `catch`, `catch` that only logs and continues where the caller needs to know, promises without `catch`, `async void` (.NET), errors converted to success responses. |
| REL02 | Timeouts on remote calls | High | HTTP, database, cache and queue clients without timeouts, or with defaults of minutes; no cancellation propagation. |
| REL03 | Retries with backoff | Medium | Retries on transient failures with backoff and a limit (Polly, `p-retry`), no retries on non-idempotent operations, no retry storms. |
| REL04 | Idempotency of jobs, consumers and webhooks | Critical | Handlers that run twice on redelivery (payments, emails, inventory); missing idempotency keys or deduplication; at-least-once delivery treated as exactly-once. |
| REL05 | Transactions and partial failure | Critical | Multi-step writes without a transaction; writes split between the database and another system (queue, storage, vendor) with no outbox, compensation or reconciliation. |
| REL06 | Concurrency and race conditions | High | Read-modify-write without locking or concurrency tokens, check-then-act on balances and counters, singleton services holding request state, shared mutable static state. |
| REL07 | Background job safety | High | Jobs that can overlap, jobs without a failure path or alert, unbounded queues, poison messages retried forever. |
| REL08 | Health and readiness checks | High | Liveness and readiness endpoints, checks for the real dependencies, and their use in deploy files. `ATTENTION` when the orchestrator config is outside the repository. |
| REL09 | Graceful shutdown | Medium | Handling of SIGTERM / host shutdown: in-flight requests and jobs finished or released, consumers stopped, connections closed. |
| REL10 | Structured logging and correlation | Medium | Logs with context (request id, user or tenant id, operation), correlation ids across services, consistent levels, no secrets. |
| REL11 | Configuration validation at startup | Medium | Required settings checked at startup (options validation, schema) instead of failing on first use; safe defaults. |
| REL12 | Resource cleanup | Medium | Streams, files, connections and `IDisposable` objects released (`using`, `finally`), event listeners removed. |
| REL13 | Dependency failure isolation | Medium | One failing optional dependency (email, analytics, a vendor) taking down a core path; missing fallbacks or circuit breakers where justified. |
| REL14 | Frontend error handling | Medium | Error boundaries, failed requests shown to the user with a way to retry, no unhandled promise rejections in effects, loading states that can end in an error. |

## Stack notes

- **.NET**: `async void`, `Task.Run` fire-and-forget without error handling, `IHostedService` stop logic, Hangfire `[DisableConcurrentExecution]`, EF Core concurrency tokens, Polly policies on `HttpClient`.
- **Node.js**: unhandled rejections, `process.on('SIGTERM')`, `AbortSignal.timeout`, BullMQ job options, `Promise.allSettled` versus `Promise.all` semantics.
- **React**: error boundaries per route, query libraries' retry and error states.
