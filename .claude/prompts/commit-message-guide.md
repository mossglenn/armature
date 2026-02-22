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
| `schema` | `schema/schema.json` |
| `adr` | `schema/docs/adr/` |
| `api` | `api/` |
| `docker` | `docker/` |
| `scripts` | `scripts/` |
| `docs` | `docs/` |
| `.claude` | `.claude/` |

---

## Examples

```
schema(schema): add difficultyIndex and discriminationIndex to AssessmentItem

Computed fields written back by the API after LearningDataset analysis.
Enables item bank queries by empirical difficulty. See ADR-0009.
```

```
feat(api): add GET /objectives endpoint with coverage status

Returns all LearningObjectives for a course with their ModuleObjective
coverageStatus values. Pagination deferred — returns all for now.
```

```
docs(adr): add ADR-0011 for API framework selection

Chose Fastify over Express for schema-based validation support and
better TypeScript integration.
```

```
chore(docker): add Docker Compose for TerminusDB local development

Includes persistent volume mount and environment variable configuration.
```

```
fix(api): enforce minimum cardinality on AssessmentItem.assesses

Was accepting empty assesses array on create. Now returns 422 with
descriptive error. See ADR-0006.
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
