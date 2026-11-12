---
name: backend-patterns
description: Backend architecture and API design patterns — layered architecture, database optimization, caching, error handling, auth, rate limiting, plus REST and GraphQL API design (resource naming, status codes, pagination, filtering, versioning). For Node.js, Express, GraphQL, and REST APIs.
origin: ECC
---

# Backend Development Patterns

Architecture decisions and patterns for scalable server-side applications, including REST and GraphQL API design.

## When to Activate

- Designing or reviewing API endpoints and contracts (REST or GraphQL)
- Choosing between architecture layers (controller, service, repository)
- Adding pagination, filtering, sorting, or versioning to an API
- Optimizing database queries
- Adding caching, background jobs, or async processing
- Structuring error handling, auth, or middleware

## Architecture Layers

### When to use which

| Layer | Responsibility | Rule |
|---|---|---|
| **Router/Controller/Resolver** | Parse request, validate input, return response | No business logic. No direct DB access |
| **Service** | Business logic, orchestration | No HTTP concepts (req/res). No direct DB queries |
| **Repository/Model** | Data access, queries | No business logic. Returns domain objects |
| **Middleware** | Cross-cutting concerns (auth, logging, rate limiting) | Composable, stateless, order-aware |

**Default flow**: Request -> Middleware -> Router/Resolver -> Service -> Model -> DB

Only skip layers when the operation is truly trivial (e.g., health check endpoint).

## API Design

Conventions for consistent, developer-friendly APIs.

### REST — URL Structure

- Resources: nouns, plural, lowercase, kebab-case
- CRUD maps to HTTP methods: GET (read), POST (create), PUT (replace), PATCH (update), DELETE (remove)
- Sub-resources for relationships: `/users/:id/orders`
- Actions that don't map to CRUD: `POST /orders/:id/cancel` (verb sparingly)
- Query params for filtering/sorting: `?status=active&sort=-created_at&limit=20`

### REST — Status Code Decision

| Situation | Code |
|---|---|
| Success with body | 200 |
| Created (include `Location` header) | 201 |
| Success, no body (DELETE, PUT) | 204 |
| Validation failure, malformed input | 400 |
| Missing/invalid authentication | 401 |
| Authenticated but not authorized | 403 |
| Resource not found | 404 |
| Duplicate/state conflict | 409 |
| Valid JSON but semantically wrong | 422 |
| Rate limit exceeded | 429 (include `Retry-After`) |
| Server error (never expose details) | 500 |

Never return 200 with `{ success: false }`. Use HTTP status codes semantically.

### Error Response Format

Consistent structure across all endpoints: a machine-readable error code (string enum), a human-readable message, field-level details for validation errors, and an HTTP status that matches the error semantics. Never leak internal details (stack traces, SQL errors, file paths) to the client.

```json
{
  "error": {
    "code": "validation_error",
    "message": "Human-readable description",
    "details": [{ "field": "email", "message": "Invalid format" }]
  }
}
```

### Pagination Decision

| Context | Strategy |
|---|---|
| Small datasets (<10K), admin dashboards | **Offset** (`?page=2&per_page=20`) |
| Large datasets, feeds, infinite scroll | **Cursor** (`?cursor=<opaque>&limit=20`) |
| Search results | Offset (users expect page numbers) |
| Public APIs | Cursor default, offset optional |

Cursor: fetch N+1 to determine `has_next`. Return opaque cursor (base64 encoded ID).

### Filtering & Sorting

- Equality: `?status=active`
- Comparison: `?price[gte]=10&price[lte]=100`
- Multiple values: `?category=a,b,c`
- Sort: `?sort=-created_at,name` (prefix `-` for descending)
- Sparse fields: `?fields=id,name,email`

### Versioning

- Default: URL path (`/api/v1/users`) — explicit, easy to route
- Max 2 active versions (current + previous)
- Non-breaking changes don't need new version (adding fields, optional params, new endpoints)
- Breaking changes require new version (removing/renaming fields, changing types)

### GraphQL

**Schema principles**
- Types represent domain entities, not database tables
- Queries for reads, Mutations for writes, Subscriptions for real-time
- Use input types for mutation arguments
- Prefer nullable fields by default (resilient to partial failures)
- Connection pattern for paginated lists (edges + pageInfo)

**Query design**
- Avoid deeply nested queries (max 3-4 levels)
- Use DataLoader pattern to solve N+1
- Limit query complexity/depth to prevent abuse
- Return user-friendly errors in mutation responses (not just GraphQL errors)

**Common mistakes**
- Exposing DB schema directly as GraphQL schema
- No pagination on list fields
- No rate limiting / query complexity limits
- Mutations that return `Boolean` instead of the affected entity

## Database Patterns

### Query Optimization Principles

- Select only needed columns, never `SELECT *` in production
- Use indexes on frequently queried fields
- Batch related queries (avoid N+1)
- Use pagination for list endpoints (cursor-based for large datasets, offset for small)
- Use projections and lean queries when you don't need full documents

### N+1 Prevention

Always batch-fetch related entities. Pattern: collect IDs -> single query -> map results back.

### Transactions

Use transactions when multiple writes must succeed or fail together. Keep transactions short to avoid lock contention.

### Connection Management

- Use connection pooling (never open/close per request)
- Set reasonable timeouts
- Handle connection loss gracefully with retry logic

## Caching Strategy Decision

| Data characteristics | Strategy |
|---|---|
| Rarely changes, read-heavy | Cache-aside with long TTL (minutes to hours) |
| Frequently changes, tolerance for staleness | Cache-aside with short TTL (seconds) |
| Must be consistent | Write-through or no cache |
| Expensive to compute, idempotent | Memoize at service layer |
| Per-user data | Cache with user-scoped key |
| Shared/global data | Cache with shared key, invalidate on write |

Invalidation is harder than caching. Prefer TTL-based expiration over manual invalidation when possible.

## Error Handling

- Distinguish operational errors (expected: validation, not found, auth) from programmer errors (bugs)
- Operational errors: return appropriate status code + structured error response (see API Design > Error Response Format)
- Programmer errors: log with stack trace, return generic 500, fix the bug
- Never leak internal details (stack traces, SQL errors, file paths) to the client
- Use typed/custom error classes to differentiate error types

## Authentication Patterns

| Pattern | When to use |
|---|---|
| **JWT (stateless)** | Microservices, API-to-API, when you can't share sessions |
| **Session (stateful)** | Monoliths, web apps, when you need revocation |
| **API Key** | Server-to-server, CLI tools, MCP integrations (`X-API-Key` or `Authorization: Bearer`) |
| **OAuth2/OIDC** | Third-party login, enterprise SSO |

Rules:
- Hash API keys before storing (SHA-256 minimum)
- Set reasonable TTLs on tokens/sessions
- Always validate on every request (don't trust client-side expiry)
- Refresh tokens must be rotated on use

## Rate Limiting

| Tier | Typical limit | Scope |
|---|---|---|
| Anonymous | 30-60/min | Per IP |
| Authenticated | 100-300/min | Per user/key |
| Internal/service | 1000+/min | Per service |

Use sliding window algorithm. Return `Retry-After` header on 429.

## Background Jobs

| Pattern | When |
|---|---|
| **Inline (await)** | <100ms, critical path |
| **Fire-and-forget** | Non-critical, <1s, OK to lose |
| **Job queue** | >1s, must complete, needs retry |
| **Cron/scheduled** | Recurring, time-based |
| **Event-driven** | Decoupled, multiple consumers (Kafka, RabbitMQ) |

## Logging Principles

- Structured JSON logs (not unstructured strings)
- Include: timestamp, level, message, requestId, userId (when available)
- Never log: passwords, tokens, PII, full request bodies in production
- Log levels: ERROR (actionable failures), WARN (degraded but functioning), INFO (business events), DEBUG (dev only)

## API Design Checklist

- [ ] Resource URLs follow naming conventions
- [ ] Correct HTTP methods/status codes
- [ ] Input validated with schema (Zod, Joi, class-validator)
- [ ] Error responses follow standard format
- [ ] Pagination on list endpoints
- [ ] Auth required (or explicitly public)
- [ ] Authorization checked (resource ownership)
- [ ] Rate limiting configured
- [ ] No internal details leaked in errors
- [ ] Consistent naming with existing endpoints

## Anti-Patterns

- Business logic in controllers/resolvers
- Direct DB access from routes
- Catching all errors silently (`catch(e) {}`)
- Hardcoded secrets in code
- God services (one service doing everything)
- N+1 queries in loops
- Missing input validation at system boundaries
- Synchronous heavy computation blocking event loop
