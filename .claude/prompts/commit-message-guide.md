# Commit Message Guide

Armature uses Conventional Commits format. Every commit message must be reviewable and useful to a future reader — human or AI — reconstructing what happened in this session.

---

## Format

```
<type>(<scope>): <short summary>

<optional body>

<optional footer>
```

The short summary is mandatory. Body and footer are used when the commit needs explanation.

---

## Types

| Type | When to use |
|---|---|
| `feat` | New capability, endpoint, type, or behavior |
| `fix` | Corrects a bug or schema error |
| `docs` | Documentation only — README, ADRs, schema comments, .claude files |
| `refactor` | Code restructuring with no behavior change |
| `test` | Test additions or changes |
| `chore` | Build config, dependencies, tooling, Docker |
| `schema` | Changes to `schema/schema.json` — use instead of `feat` for schema-only changes |

---

## Scopes

Use the directory or system being changed:

| Scope | Covers |
|---|---|
| `schema` | `schema/schema.json` (with its regenerated `app/lib/types.ts`, `app/lib/schemas.ts` and `docs/SCHEMA_APPENDIX.md`) |
| `adr` | `schema/docs/adr/` |
| `api` | The Armature API, `app/lib/api/` |
| `app` | The rest of `app/`: pages, configuration, generated files when not part of a schema change |
| `scripts` | `scripts/` |
| `docker` | `docker/` |
| `ci` | `.github/workflows/` |
| `deps` | Dependency changes in either `package.json` |
| `docs` | `docs/` |
| `research` | `docs/research/` |
| `.claude` | `.claude/` |

---

## Examples

```
feat(api): add the coverage read under /api/v1/intelligence

Computes each declared objective's coverage from the module's placements
at the requested ref, with both figures, their counts and the items behind
them. Nothing is stored. See ADR-0029, ADR-0056.
```

```
schema(schema): add DesignFinding and FindingStatus

An evidence-grounded concern about any design record, distinct from a
DesignNote's settled rationale. Dismissed requires a resolutionRationale,
enforced by the API. See ADR-0020.
```

```
docs(adr): add ADR-0054, the API as a Hono application

Host-neutral routes mounted in Next.js through one catch-all, so moving
to a standalone server is a deployment change. Verified by a six-check
spike before acceptance.
```

```
chore(docker): pin terminusdb-server to v12.0.7

The compose file used latest; every platform check was run against
v12.0.7.
```

```
fix(api): report each unrecognized key at its own path

Zod reports unknown keys as one issue with an empty path; split them so
a client learns which field was refused.
```

---

## Rules

1. **Show the message before committing.** Always present the proposed message for approval — don't commit silently.

2. **One logical change per commit.** Don't bundle a schema change, an API fix, and a README update into one commit.

3. **Reference ADRs when relevant.** If a commit implements or is constrained by an ADR, say `See ADR-XXXX` in the body.

4. **Be specific in the summary.** "Update schema" is useless. "Add prerequisiteType field to PrerequisiteRecord" is useful.

5. **Body explains why, not what.** The diff shows what changed. The body explains why it was necessary.

---

## Workflow

When asked to generate a commit message:

1. Run `git diff --staged` (or `git diff HEAD` if nothing is staged)
2. Analyze the changes — type, scope, and intent
3. Draft the message
4. Present it: "Here's the proposed commit message: [message] — confirm to commit?"
5. Wait for approval before running `git commit`
