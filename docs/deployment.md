# Running an Armature instance

This document is for the administrator who stands up an Armature instance on a machine: what runs, what is reachable by whom, the steps, and what is deliberately not there yet. It describes the deployment as built on 2026-10-21 (Phase 7). The commands are the ones in `docker/docker-compose.yml`; the reasons are in the Architecture Decision Records (ADRs) cited.

## The terms

Used the same way in every Armature document:

| Term | Meaning |
|---|---|
| **Server** | A machine. It runs processes; with Docker, it runs containers, each one process with its packaging |
| **Store** | One TerminusDB database: a graph with its own commit history, branches and `User` registry. The TerminusDB process holds any number of stores |
| **API** | The contract at `/api/v1` and the Hono code that implements it (`app/lib/api/`) |
| **Host** | One Node process running the API's code: `app/server.ts`, or the container built from it. A server runs as many hosts as it has ports for |
| **Hub** | One host bound to one store: the address a client talks to. Every hub serves the same API; there can be many hubs |
| **Instance** | A hub with its particular data. Usually interchangeable with hub |
| **Client**, **plugin** | Any program that consumes the API: the viewer, CoQui, an importer. Never touches a store |
| **Viewer** | Armature's own pages (Next.js), a client that only reads |

## What runs

```
                              one server, one private network
   ┌─────────────────────────────────────────────────────────────────────┐
   │   viewer container ──reads──▶ hub container ──▶ terminusdb container │
   │   (Next.js pages)             (Node, the API)    (the store server,   │
   │                                                   holding the stores) │
   └────────┬───────────────────────────┬──────────────────────┬──────────┘
            │ :3000 public              │ :3100 loopback       │ :6363 loopback
         readers                 operators on the server   operator scripts
```

Three containers from one compose file, `docker compose --profile hub up -d --build` in `docker/`:

| Container | Image | What it is | Published on the server |
|---|---|---|---|
| `viewer` | `docker/viewer.Dockerfile` | The pages, built once (Next.js standalone output); reads the hub by its service name `http://hub:3100` | Port 3000 on every interface: the public face |
| `hub` | `docker/hub.Dockerfile` | The API as one Node process, bundled into one file; reaches the store as `http://terminusdb:6363` | Port 3100 on loopback only |
| `terminusdb` | `terminusdb/terminusdb-server:v12.0.7` | The store server, with a named volume for its databases | Port 6363 on loopback only |

Each publication is a compose variable: `ARMATURE_VIEWER_BIND`, `ARMATURE_HUB_BIND`, `TERMINUSDB_BIND`, with `ARMATURE_HUB_PORT` and `ARMATURE_VIEWER_PORT` for the ports.

## Who can do what

- **Readers** reach the viewer. Its pages only read, and they carry no identity, so nothing a reader does reaches a writing route. The viewer is read-only by construction, not because the hub enforces it (see below).
- **Operators on the server** reach the hub on loopback (`curl http://127.0.0.1:3100/api/v1/discover`, a client run on the server) and the store on loopback with its password. This is where the schema and data are loaded, users registered, and repairs made.
- **Nobody else** reaches the hub or the store. The hub's identity resolver, `header`, trusts whatever `Armature-User` a request claims (ADR-0032), so a hub reachable from beyond the server would let anyone write as anyone. The loopback binding is the gate until an authenticating resolver (`oidc`, named and not built) or an authenticating proxy exists. Anything else placed on the private network can write to the hub; keep that network to these three containers.

Set `TERMINUSDB_ADMIN_PASS` on any server that is not a laptop. The compose default, `admin`, is for development only, and the hub takes the same value for its own connection.

## The steps

1. **Bring up the containers.** In `docker/`: `TERMINUSDB_ADMIN_PASS=<a real password> docker compose --profile hub up -d --build`. The hub and the viewer start before the store is ready; every request opens its own connection, so the hub answers 500 until the store is up and the viewer shows an error page until then.
2. **Load the schema** from the server, from the repository root: `TERMINUS_PASS=<the password> node scripts/load_schema.js`. The scripts read `TERMINUS_URL` (default `http://localhost:6363`), `TERMINUS_USER`, `TERMINUS_PASS` and `TERMINUS_DB` (default `armature`) from the shell.
3. **Load the data**: `node scripts/seed_data.js` for the demonstration course, or a re-import of an export (ADR-0031 decision 4; `docs/research-path.md` §6) for real data. Both are operator work against the store, outside the API (ADR-0062).
4. **Register the people** who will write, through the API on loopback: `POST /api/v1/users` with a registered caller (the seed registers `demo-designer@example.edu`). AI agents are users whose `externalId` begins with `agent:`. There are no routes to edit or delete a user; that is operator work too.
5. **Point clients at it.** The viewer already is. A writing client such as CoQui needs the hub's address, which today means running it on the server or widening `ARMATURE_HUB_BIND` behind a proxy that authenticates and sets `Armature-User` itself.

Optional: `ARMATURE_HUB_PUBLIC_URL` gives the viewer an address a reader's browser can follow for the raw-data links in page footers; unset, the links are omitted and the hub stays private. `ARMATURE_EXPORT_KEY` makes pseudonymous exports stable across runs (ADR-0031).

## Several projects

Decide what a project must keep separate (`docs/schema-guide.md` Part I says the same from a tool's side):

- **Projects that share people and history** can be `Course` documents in one store: one hub, one `User` registry, branches named per project. The coverage read takes `?course=`. Export slices are by class, not by course, so an export of such a store carries every course in it.
- **Projects that must not see each other**, and a study that wants a clean export per course (`research-path.md` §1), are separate stores. The one TerminusDB container holds them all; each needs its own hub, which is the `hub` service again with a different `TERMINUS_DB` and port. A second compose project gives a project its own store server as well. Whether one store should hold a course, a program or an institution is an open question of the plan (§6, "Project boundaries"); the mechanics above are the same whichever way it is answered.

A hub that serves several stores from one process is not built; until a deployment has more than a few, one hub container per store is simpler to reason about and to secure.

## Development on a laptop

`docker compose up -d` without the profile runs the store only. The hub then runs on the machine (`npm run build:hub && npm run start:hub` in `app/`, reading `app/.env.local`) and the viewer with `npm run dev`, pointed at it by `ARMATURE_HUB_URL` (default `http://localhost:3100`). The contract suite runs the API in-process against the store and never needs the hub or the viewer containers.

## What is not there yet

- **Authentication.** The `header` resolver trusts the caller; `oidc` is the named next resolver (ADR-0032). Until it exists, writes happen on the server or behind an authenticating proxy.
- **An administrator's page.** Loading, repair and user edits are terminal commands with the store's password. ADR-0062 (Proposed) describes three operator tools (`check` a branch, `delete`, `put --unchecked`) as commands reusing the API's code with store credentials; a page over them would need authentication first and evidence of what administrators actually do, which the first deployment off a laptop is expected to provide (plan §6).
- **A hosted instance.** This document is what one would run; none is running yet (plan, Phase 7).
- **Backups.** The store's data is the `terminusdb-data` volume. Back it up as a volume, or as an export at a commit (`GET /api/v1/export`), which reloads with steps 2 and 3.
