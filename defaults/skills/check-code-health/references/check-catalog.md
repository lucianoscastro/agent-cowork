# Code health check catalog

| ID | Check | Base severity | Evidence to review |
|---|---|---:|---|
| COD01 | Duplicated business rules | High | The same rule (a calculation, a validation, a status mapping) implemented in more than one place, in the backend, the frontend or stored procedures; diverging copies are critical. |
| COD02 | Dead code | Medium | Exported functions, classes, endpoints, components, feature flags and config keys with no callers; commented-out blocks. |
| COD03 | Oversized functions and files | Medium | Functions over ~80 lines or with many responsibilities, files over ~600 lines, components rendering many unrelated concerns. |
| COD04 | Deep nesting and complex conditionals | Medium | More than three levels of nesting, long `if/else` or `switch` chains encoding rules that a table or a map would hold. |
| COD05 | Layering violations | High | Controllers or React components querying the database or calling vendors directly, domain code depending on web or UI frameworks, data access spread outside the data layer. |
| COD06 | Circular dependencies | High | Modules or projects importing each other directly or through a cycle. |
| COD07 | God classes and modules | High | One service or utility that most of the code depends on and that keeps growing ("Helper", "Utils", "Manager" with dozens of unrelated methods). |
| COD08 | Primitive obsession on money, dates and identifiers | Medium | Money as `float`/`double`/`number` arithmetic, dates as strings, ids passed as untyped strings across layers. |
| COD09 | Magic values | Low | Repeated literal numbers and strings for statuses, roles, limits and URLs instead of named constants or enums. |
| COD10 | Inconsistent error handling | Medium | Several competing error styles (exceptions, result objects, error codes, `null`) in the same layer; errors mapped differently by each endpoint. |
| COD11 | Type safety escapes | Medium | `any`, `as unknown as`, `// @ts-ignore`, `dynamic`, `object` and unchecked casts on important paths; nullable warnings suppressed. |
| COD12 | Debt markers | Low | `TODO`, `FIXME`, `HACK` and workarounds, with their age when history is available. |

## Stack notes

- **.NET**: project references for layering, `Startup`/`Program` registrations to find live code, `#pragma warning disable`, nullable reference types.
- **Node.js / React**: barrel files hiding cycles, `eslint-disable` comments, prop drilling versus context, components that both fetch and render large trees.
