---
name: terminusdb
description: Use when a question depends on how TerminusDB behaves — schema language (@key, @subdocument, @metadata, inheritance, migration), the document API (insert, replace, upsert, paging, data versions), version control (branches, commits, merge, diff, history, time travel), access control, the JavaScript client, or Docker configuration. Points at the vendored, version-stamped docs in docs/vendor/terminusdb and says when to verify against the live site or the installed client source instead.
---

# TerminusDB reference for Armature

Armature stores its graph in TerminusDB and wraps it behind the Armature API. Decisions in
ADRs and in `docs/development-plan.md` often rest on exactly what the store does, and the store
has changed under the project before (four releases between the one hand-copied page in
March 2026 and the v12.0.7 check in October 2026). This skill is how to answer a TerminusDB
question with the right source and the right amount of trust.

## Where the documentation is

- **`docs/vendor/terminusdb/`**: fifty curated pages as markdown, committed. Each file's
  frontmatter records the live URL, the upstream `lastUpdated` date where the page has one, the
  docs-repo commit it was taken from, and the TerminusDB release current at sync time.
- **`docs/vendor/terminusdb/INDEX.md`**: every documentation page (about 240) with title,
  description, upstream update date and local path. Start here when you do not know which page
  answers the question.
- **`docs/vendor/terminusdb/_all/`**: every non-curated page, gitignored. If it is absent, run the
  sync or open the page's URL from INDEX.md.
- **`docs/vendor/terminusdb/VERSION.json`**: when the sync ran, which docs commit it pinned, which
  server release was current, and which pages fell back to HTML conversion.

Upstream source: the public repo `dfrnt-labs/terminusdb-docs-static` (Apache-2.0) renders to
terminusdb.org/docs. There is no llms.txt and no MCP server. The older
`terminusdb/terminusdb-docs` repo is explicitly stale; never use it.

## Which page answers what

| Question | Start with |
|---|---|
| Schema syntax: `@key`, `@subdocument`, `@shared`, `@abstract`, `@inherits`, `@metadata`, `@documentation`, `@min_cardinality`, type families | `schema-reference-guide.md`, then `document-types-comparison.md` |
| Changing a schema with data in it | `schema-migration-reference-guide.md`, `what-is-schema-weakening.md` |
| Insert vs replace vs upsert, `overwrite`, `create`, `@capture`/`@ref`, GET parameters, data-version header | `document-insertion.md`, `http-documents-api.md` |
| Reading at a branch or commit, path shapes | `graph-spec-db-spec-database-path-identifiers.md`, `time-travel-howto.md` |
| Branches, merge and conflicts, rebase, reset, squash | `version-control-operations.md`, `merge-howto.md`, `branch-howto.md`, `git-for-data-reference.md` |
| Per-document history, audit trails, diffs between commits | `audit-tutorial.md`, `json-diff-and-patch.md`, `patch-endpoint.md` |
| Commit author and message on writes | `commit-message-howto.md` |
| Concurrent writers, retries, isolation | `immutability-and-concurrency.md` |
| Users, roles, capabilities, what scopes exist | `access-control.md`, `capabilities-api-modes.md` |
| JavaScript client methods | `javascript.md` (HTML-converted API reference), `use-the-javascript-client.md` |
| Docker image, environment variables, server settings | `install-terminusdb-as-a-docker-container.md`, `docker-advanced-configuration.md`, `enterprise-configuration.md` |

## Trust levels, in order

1. **The installed client source is authoritative for client behaviour.** Read
   `app/node_modules/<client>/lib/woqlClient.js` and `lib/typedef.js` before stating what a
   client method does. The docs describe the client loosely; the source does not. Example: the
   docs do not mention that every write method hardcodes the commit author from the connection
   user. The source shows it in one line. Since ADR-0055 the client is used only by `scripts/`;
   the API layer's contract is the HTTP API, so for route work read `http-documents-api.md` and
   the version-control pages, and consult the client source only to see how it built a URL.
2. **The running store is authoritative for server behaviour.** When an ADR depends on a platform
   fact (a key type on subdocuments, whether `@metadata` survives a load, a four-level inheritance
   chain), test it against the Docker container before encoding the decision. ADR-0013 and
   ADR-0017 call this the gating discipline.
3. **The vendored pages are the reference for everything else**, at the release named in
   `VERSION.json`.
4. **The live site and the server release notes** (`github.com/terminusdb/terminusdb/releases`)
   are the check when the question is version-sensitive, when `VERSION.json` is behind the latest
   release, or when a vendored page says something that contradicts observed behaviour.

## When to re-sync

Run the sync when any of these is true:

- A new TerminusDB server or client release has appeared since `VERSION.json`'s
  `terminusdbRelease`.
- The docs repo's `main` is ahead of `VERSION.json`'s `docsCommit`.
- A vendored page is about to be cited in an ADR and `VERSION.json` is more than a release old.

```bash
# from the repo root
node scripts/sync-terminusdb-docs.js                   # everything, ~10 seconds
node scripts/sync-terminusdb-docs.js --curated-only    # only the committed set
node scripts/sync-terminusdb-docs.js --only merge-howto,branch-howto
```

Commit the changed curated pages, `INDEX.md` and `VERSION.json` together. If the run reports
pages that "still contain {%", a new upstream Markdoc tag has appeared; add a case to
`convertMarkdoc` in the script. If it reports curated slugs not found upstream, a page was
renamed; fix the slug in the script's `CURATED` list and in the table above.

## Facts already verified for this project

Recorded in `docs/development-plan.md` §9 as of v12.0.7. The ones most often needed:

- `apply` is a three-way merge with field-level conflict detection; conflicts are reported, never
  resolved silently. It takes bare commit ids for `before_commit` and `after_commit`, and a
  conflict is HTTP 409 with witnesses of the form `{ "@op": "Conflict", "@expected", "@found" }`,
  not the `@before`/`@after_left`/`@after_right` the vendored merge page shows (platform check
  P). `rebase` replays commits and gives them new ids; `POST /api/rebase/<X>` with
  `rebase_from: <Y>` rebases X onto Y, the reverse of how the vendored page reads (check Q).
- When both sides inserted the same id, `apply` succeeds and makes no commit if the fields are
  identical, and reports a 409 with a witness `{ "@op": "InsertConflict", "@id_already_exists":
  "<iri>" }` if they differ, a different shape from the per-field witness (check W2, W2d).
- The document API's template query works over HTTP as a `POST` to the document path with
  `X-HTTP-Method-Override: GET` and a body `{ type, as_list, query: { field: value } }`; it
  returns the matching documents and the data-version header (check W1). A list body on `POST`,
  or on `PUT` with `create=true`, commits every document in one commit (check W3). **A template
  filters only on a required field: a template on an `Optional` reference field, or on a `Set`
  reference field in either value form, is a 500 `api:InternalServerError` (check Y).** The hub
  lists the type and filters in `Graph.where` for those.
- A commit's existence is checked by reading `ValidCommit/<id>` from `local/_commits`; a document
  read at a commit path that does not exist is a 500 (check U). A stale `TerminusDB-Data-Version`
  is HTTP 400 `api:DataVersionMismatch`; a bare commit id as the token is rejected (check M).
  Branch DELETE needs a `{}` body with a JSON content type (check T).
- Branch `origin` may be a branch head or a commit path. Reads at `local/commit/<id>` are
  read-only.
- `POST` inserts and rejects an existing id unless `overwrite=true`; `PUT` replaces and needs
  `create=true` to upsert. **`POST overwrite=true` is not a replace: it merged the old and new
  values of a field into a list (check X3a).** The hub upserts only with `PUT create=true`, which
  also takes a list, writes a Hash-keyed document without an `@id` by deriving it from the key
  fields, honours `@capture`/`@ref` within the list, returns the written ids as IRIs, and fails
  the whole list on one bad document (checks X1, X2b, X5). `GET` with `ids=[...]` reads several
  documents and silently drops missing ids (X4).
- The `TerminusDB-Data-Version` header gives optimistic concurrency; without it the server retries
  a write up to three times when the head moved, so blind concurrent writers both succeed.
- The JavaScript client cannot set the commit author; the HTTP API takes `author` and `message`
  as query parameters. The client also keeps a supplied data version in its instance headers
  without clearing it, flattens server errors into a string, and lacks the history `diff`
  option. ADR-0055 therefore keeps it out of `app/lib/api/`.
- Subdocuments need `@key` `Random` or `ValueHash`, nest under the parent, and cannot be
  referenced from outside.
- `Cardinality` is deprecated; use `Set` with `@min_cardinality`.
- No per-branch permissions; only basic auth is documented for self-hosted use.
- The npm client is now the `terminusdb` package (12.0.5); `@terminusdb/terminusdb-client` is the
  old name.

## Do not

- Do not hand-copy documentation pages into `docs/`. The March 2026 hand copy
  `docs/terminusdb-schema-doc.md` was removed on 2026-10-07; its content is
  `docs/vendor/terminusdb/schema-reference-guide.md`, kept current by the sync script.
- Do not edit anything under `docs/vendor/terminusdb/` by hand; the next sync overwrites it.
- Do not treat the docs as authoritative about the JavaScript client when the source is one
  file away.
