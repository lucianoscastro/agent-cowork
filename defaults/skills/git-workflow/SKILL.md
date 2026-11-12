---
name: git-workflow
description: Git workflow patterns including branching strategies, commit conventions, merge vs rebase, conflict resolution, and collaborative development best practices for teams of all sizes.
origin: ECC
---

# Git Workflow Patterns

## When to Activate

- Deciding branching strategy
- Writing commits and PRs
- Resolving conflicts or choosing merge vs rebase
- Managing releases

## Branching Strategy Decision

| Context | Strategy | Key Rule |
|---|---|---|
| SaaS, continuous deploy, any team size | **GitHub Flow** | `main` always deployable, feature branches + PR |
| High-velocity, 5+ experienced devs, feature flags | **Trunk-Based** | Short-lived branches (1-2 days), deploy multiple times/day |
| Scheduled releases, regulated, 10+ devs | **GitFlow** | `main` + `develop`, release branches, hotfix branches |

Default to **GitHub Flow** unless there's a reason not to.

## Commit Conventions

Format: `<type>(<scope>): <subject>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `revert`

Rules:
- Imperative mood, no period, max 50 chars in subject
- Body explains **why**, not what
- Footer references issues: `Closes #123`
- Never: "fixed stuff", "updates", "WIP" as final commit messages

## Merge vs Rebase Decision

| Situation | Use |
|---|---|
| Merging feature branch into main | **Merge** (preserves history) |
| Updating local branch with latest main | **Rebase** (linear history) |
| Branch pushed and shared with others | **Never rebase** |
| Branch is local-only, you're sole author | Rebase is safe |
| Protected branches (main, develop) | **Never rebase** |

Always use `--force-with-lease` instead of `--force` when force pushing.

## PR Standards

- Title: `<type>(<scope>): <description>` (under 70 chars)
- Body: What, Why, How, Testing checklist, Screenshots if UI
- Size: <500 lines ideal. Break larger changes into stacked PRs
- Self-review before requesting review
- CI must pass before merge

## Conflict Prevention

1. Keep branches short-lived (days, not weeks)
2. Rebase onto main frequently
3. Communicate about shared files
4. Use feature flags instead of long-lived branches
5. Review and merge PRs promptly

## Branch Naming

```
feature/<description>     fix/<description>
hotfix/<description>      release/<version>
experiment/<description>
```

Include ticket ID when available: `feature/JIRA-123-user-auth`

## Release Management

Use semantic versioning: `MAJOR.MINOR.PATCH`
- MAJOR: breaking changes
- MINOR: new features, backward compatible
- PATCH: bug fixes

Annotated tags for releases: `git tag -a v1.2.0 -m "Release notes"`

## Anti-Patterns

- Committing directly to main without PR
- Committing secrets (.env, API keys)
- Giant PRs (1000+ lines)
- "update" / "fix" commit messages
- Force pushing to shared branches
- Long-lived feature branches (weeks/months)
- Committing generated files (dist/, node_modules/)
