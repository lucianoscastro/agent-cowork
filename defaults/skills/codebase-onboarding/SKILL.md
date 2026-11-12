---
name: codebase-onboarding
description: Analyze an unfamiliar codebase and generate a structured onboarding guide with architecture map, key entry points, conventions, request lifecycle, and common commands. Use for first-pass repository orientation, "help me understand/onboard me", "me explique esse repo". Disambiguation - to only create or refresh a CLAUDE.md/AGENTS.md instruction file use the built-in init skill (or edit the file directly); use this skill when the goal is understanding the codebase, not writing instructions.
origin: ECC
---

# Codebase Onboarding

Systematically analyze an unfamiliar codebase and produce onboarding artifacts.

## When to Use

- First time opening an unfamiliar project
- Joining a new team or repository
- "help me understand this codebase" / "onboard me"

For just creating or refreshing agent instructions, use the built-in `init` skill or edit the existing instruction file directly — preserve any instructions already there.

## Workflow

### Phase 1: Reconnaissance (parallel)

Run these checks simultaneously using Glob/Grep (not Read on every file):

1. **Package manifest**: package.json, go.mod, Cargo.toml, pyproject.toml, etc.
2. **Framework fingerprinting**: next.config.*, vite.config.*, angular.json, django settings, etc.
3. **Entry points**: main.*, index.*, app.*, server.*, cmd/
4. **Directory structure**: top 2 levels (ignore node_modules, vendor, .git, dist)
5. **Config/tooling**: eslint, prettier, tsconfig, Makefile, Dockerfile, CI configs
6. **Test structure**: tests/, __tests__/, *.test.*, *.spec.*, jest.config.*, vitest.*

### Phase 2: Architecture Mapping

From reconnaissance, identify:
- **Tech stack**: languages, frameworks, DB, ORM, build tools, CI
- **Architecture pattern**: monolith, monorepo, microservices, serverless
- **API style**: REST, GraphQL, gRPC, tRPC
- **Key directories**: map top-level dirs to purpose
- **Data flow**: trace one request from entry to response (router -> validator -> service -> DB)

### Phase 3: Convention Detection

- **Naming**: file naming (kebab, camel, Pascal, snake), component patterns
- **Code patterns**: error handling, DI vs direct imports, async style
- **Git conventions**: branch naming, commit style, PR workflow (from recent history)
- If git history is shallow/empty, note it and skip

### Phase 4: Generate Artifacts

**Default output: Onboarding Guide** (printed to conversation)
- Overview (2-3 sentences)
- Tech stack table
- Architecture description
- Key entry points with file paths
- Directory map
- Request lifecycle trace
- Conventions summary
- Common tasks (dev, test, lint, build)

**Optional output: Agent Instructions** (only if requested)
- Update `AGENTS.md` when present; create it only if the user explicitly asks for an instruction file.
- Preserve existing instructions and add only repository-specific conventions discovered in Phase 3.
- Do not create or update `CLAUDE.md` unless the user explicitly asks for that filename.

## Rules

- Don't read every file — use Glob/Grep for recon, Read selectively for ambiguity
- Trust code over config when they disagree
- Do not rewrite agent instruction files unless explicitly requested
- Stay concise — guide should be scannable in 2 minutes
- Flag unknowns honestly ("Could not determine test runner")
- Don't copy the README — add structural insight it lacks
