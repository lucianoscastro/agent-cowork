# Performance check catalog

| ID | Check | Base severity | Evidence to review |
|---|---|---:|---|
| PRF01 | N+1 data access | High | Queries or ORM lazy loads inside loops, `.map` with awaited queries, EF navigation properties read per item, a repository call per row. |
| PRF02 | Unbounded queries and lists | High | Endpoints and jobs loading all rows (no `Take`/`LIMIT`, no paging), `ToList()` before filtering, `SELECT *` on wide tables, exports without streaming. |
| PRF03 | Indexes for filters and joins | Medium | `WHERE`, `ORDER BY` and join columns on large tables against the migrations or schema; stored procedures filtering on unindexed or function-wrapped columns. `ATTENTION` when the schema is not in the repository. |
| PRF04 | Serial remote calls | High | Independent HTTP, database or queue calls awaited one after another (`for … await`, sequential `await`s) where they could run in parallel or in one batch. |
| PRF05 | Blocking work on request paths | High | Sync-over-async (`.Result`, `.Wait()`, `GetAwaiter().GetResult()`), synchronous file or crypto work on the event loop, heavy CPU work per request, sending emails or calling slow vendors inline instead of a queue. |
| PRF06 | Chatty APIs | Medium | Screens that need many calls to render, endpoints returning too little so clients loop, missing batch endpoints. |
| PRF07 | Caching of costly reads | Medium | Reference data, configuration and expensive aggregates recomputed on every request; caches without expiry or invalidation. |
| PRF08 | Payload size | Medium | Responses returning whole object graphs, base64 files in JSON, missing compression, images without size limits. |
| PRF09 | Connection and client reuse | High | `new HttpClient()` per call (.NET), a database client or pool created per request, missing connection pooling, unbounded parallelism exhausting a pool. |
| PRF10 | Frontend bundle size | Medium | Large libraries imported whole (moment, lodash, chart libraries), no route-level code splitting, assets not optimized, source maps shipped as runtime code. |
| PRF11 | React rendering | Medium | Expensive work in render, new objects and callbacks passed to memoized children on every render, context values that change every render, long lists without virtualization, effects that refetch in loops. |
| PRF12 | Memory growth | High | Caches and maps that only grow, listeners and timers never removed, whole files or result sets held in memory, closures retaining large objects. |
| PRF13 | Background jobs and schedules | Medium | Jobs that scan whole tables each run, overlapping runs without a lock, retries that multiply load. |
| PRF14 | Timeouts as a performance guard | Medium | Remote calls without timeouts that hold threads or connections; missing cancellation propagation (`CancellationToken`, `AbortSignal`). |

## Stack notes

- **.NET**: EF Core `Include` explosions and lazy loading, `AsNoTracking` on read-only queries, `IAsyncEnumerable`/streaming for exports, `IHttpClientFactory`, Dapper queries inside loops.
- **Node.js**: `await` in `for` loops, `Promise.all` without a concurrency limit on large arrays, synchronous `fs` calls in handlers, `JSON.parse` of huge payloads.
- **React**: list keys, `useMemo`/`useCallback` only where profiling-relevant, data fetching libraries' cache settings, `React.lazy` routes.
