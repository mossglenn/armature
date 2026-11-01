# @armature/client

A thin typed client for the Armature API: every `/api/v1` route as a function, grouped as [the API reference](../../docs/api.md) groups them (`documents`, `branches`, `users`, `intelligence`, `export`). It adds nothing the routes do not have. What it carries so a plugin need not:

- the ref: `{ branch }` or `{ ref: '<commit-id>' }` on every read, `main` when neither;
- the commit every response was served from or created, read from the `ETag` and returned as `commit`;
- optimistic concurrency: `ifMatch: '<commit-id>'` on a write becomes `If-Match`, and a moved branch is a thrown `HubError` with code `precondition_failed` (412);
- identity: the `user` given to `createClient` is sent as `Armature-User`;
- the write envelopes (`{ message, document }`, `{ message, documents }`, …);
- errors: a non-2xx answer throws `HubError` with the hub's `status`, stable `code`, `message` and the body's other fields as `details` (a merge conflict's `conflicts`, a rule violation's `violations`).

Types come from [`@armature/types`](../types/README.md): `documents.get('LearningObjective', id)` resolves to a `LearningObjective`.

```ts
import { createClient, HubError } from '@armature/client';

const hub = createClient({ baseUrl: 'http://localhost:3100', user: 'demo-designer@example.edu' });

const { data: objectives, commit } = await hub.documents.list('LearningObjective', { branch: 'main' });
const coverage = await hub.intelligence.coverage('how-ai-works', { ref: commit });

await hub.branches.create('round-3');
try {
  await hub.documents.put('DesignNote', 'why-ethics-first', {
    branch: 'round-3',
    message: 'Record why ethics precedes limitations',
    document: { label: 'Module order', rationale: 'SME feedback', subject: ['Module/how-ai-works'] },
  });
} catch (err) {
  if (err instanceof HubError && err.code === 'invariant_violation') console.log(err.details.violations);
}
```

**Testing a plugin without a server.** `createClient` takes a `fetch`. Hand it a Hono app's `request` and every call runs in-process; the hub's own contract test does exactly this (`app/lib/api/client.test.ts`):

```ts
const hub = createClient({ baseUrl: 'http://hub.test', user: '…', fetch: (input, init) => app.request(input, init) });
```

**Deadlines and cancellation.** `timeout` gives every call a deadline in milliseconds, its body included, after which it rejects with the fetch's `TimeoutError`; `signal` cancels every call when it aborts (`AbortError`). Both are client options, so for a signal per request (an incoming request's own, say) create a client per request. There is no default deadline and no retry. A write that timed out may have landed: re-read, or retry with `ifMatch`, rather than resend it blindly.

```ts
const hub = createClient({ baseUrl: process.env.ARMATURE_HUB_URL!, user: '…', timeout: 10_000, signal: request.signal });
```

**Installing it in another repository.** Neither package is published to a registry; another repository installs both by git reference, the types first, since the client takes them as a peer dependency (it uses the copy you install rather than fetching its own). With pnpm:

```sh
pnpm add github:mossglenn/armature#path:packages/types github:mossglenn/armature#path:packages/client
```

To pin a commit, put it before the path: `github:mossglenn/armature#<commit>&path:packages/client` (and the same commit for the types). npm cannot install a package from a subdirectory of a repository; use pnpm, or check the repository out beside yours and install the two directories by path.

Both packages ship TypeScript source and no build, so the importing tool compiles them:

- **Next.js** compiles a dependency's source only when told to, in `next.config`: `transpilePackages: ['@armature/client', '@armature/types']`. Without it the build fails with "Unknown module type" on `src/index.ts`.
- **Vitest, `tsx` and Vite** compile them as they are.
- **Node alone** does not: it refuses to strip types from files under `node_modules`. Run scripts through `tsx`.
- **`tsc`** checks their source with your options (`skipLibCheck` covers declaration files only); they compile under `strict`.

CI installs both packages this way on every change, with pnpm outside this repository's workspace, and runs them under `tsc`, Vitest, `tsx` and a Next build (`install-check/run.sh`).

**The version contract (ADR-0059).** Every call sends `Armature-Version: <CLIENT_REVISION>`, the contract revision this client was written against, and every result carries the revision the hub served it under as `version`. A hub that does not serve the client's revision throws `HubError` with code `unsupported_version` and `details.supported`; a hub *older* than the client serves reads and refuses writes, so a client ahead of its hub can look but stops before its first commit. Pass `capabilities: ['armature/intelligence.coverage', …]` to be refused by name (`unsupported_capability`) when a hub lacks a feature, `version: null` to send no revision, and call `hub.discover()` to ask a hub about itself first. `hub.schema({ ref })` returns the schema graph at a commit, so a tool discovers types from the hub rather than from a copy of `schema.json`.
