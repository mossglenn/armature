# Running an Armature instance

This document is for the administrator who stands up an Armature instance on a machine: what runs, what is reachable by whom, the steps, and what is deliberately not there yet. It describes the deployment as built on 2026-10-21 (Phase 7) and rehearsed the same day on a fresh Ubuntu 24.04 virtual machine (VM) shaped like the hosting target (§ "A hosted instance"). The commands are the ones in `docker/docker-compose.yml`; the reasons are in the Architecture Decision Records (ADRs) cited.

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
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  caddy ──▶ viewer container ──reads──▶ hub container ──▶ terminusdb container │
   │  (TLS)     (Next.js pages)             (Node, the API)    (the store server,   │
   │                                                            holding the stores) │
   └────┬───────────────┬──────────────────────────┬──────────────────────┬────────┘
        │ :80, :443     │ :3000 loopback           │ :3100 loopback       │ :6363 loopback
     readers        an operator's check      operators on the server   operator scripts
```

Four containers from one compose file, in `docker/`:

| Container | Image | What it is | Published on the server |
|---|---|---|---|
| `caddy` | `caddy:2.10.2-alpine` with `docker/Caddyfile` | The front door: HTTPS for `ARMATURE_SITE` with a certificate it obtains and renews itself, proxied to the viewer by its service name | Ports 80 and 443 on every interface: the public face |
| `viewer` | `docker/viewer.Dockerfile` | The pages, built once (Next.js standalone output); reads the hub by its service name `http://hub:3100` | Port 3000 on loopback only |
| `hub` | `docker/hub.Dockerfile` | The API as one Node process, bundled into one file; reaches the store as `http://terminusdb:6363` | Port 3100 on loopback only |
| `terminusdb` | `terminusdb/terminusdb-server:v12.0.7` | The store server, with a named volume for its databases | Port 6363 on loopback only |

Two profiles choose how many run. `--profile hub` runs the store, the hub and the viewer, all on loopback: an instance for the machine it runs on. `--profile public` adds Caddy: a hosted instance. A fifth service, `operator` (profile `operator`), is not a running container but a way to run the operator scripts on the private network (step 3). Every service restarts with Docker (`restart: unless-stopped`), so an instance comes back after a reboot.

Each publication is a compose variable: `ARMATURE_VIEWER_BIND`, `ARMATURE_HUB_BIND`, `TERMINUSDB_BIND`, with `ARMATURE_HUB_PORT` and `ARMATURE_VIEWER_PORT` for the ports.

## Who can do what

- **Readers** reach the viewer through Caddy. Its pages only read, and they carry no identity, so nothing a reader does reaches a writing route. The viewer is read-only by construction, not because the hub enforces it (see below). Caddy proxies the viewer only: `/api/v1/…` at the public address is the viewer's 404, not the hub.
- **Operators on the server** reach the hub on loopback (`curl http://127.0.0.1:3100/api/v1/discover`, a client run on the server) and the store on loopback with its password. This is where the schema and data are loaded, users registered, and repairs made.
- **Nobody else** reaches the hub or the store. The hub's identity resolver, `header`, trusts whatever `Armature-User` a request claims (ADR-0032), so a hub reachable from beyond the server would let anyone write as anyone. The loopback binding is the gate until an authenticating resolver (`oidc`, named and not built) or an authenticating proxy exists. Anything else placed on the private network can write to the hub; keep that network to these containers.

Set `TERMINUSDB_ADMIN_PASS` on any server that is not a laptop. The compose default, `admin`, is for development only, and the hub and the operator scripts take the same value for their own connections.

## The steps

The server needs Docker with the Compose plugin and a checkout of this repository, nothing else: no Node.js, since the images and the operator scripts bring their own.

1. **Prepare the server.** On Ubuntu 24.04: `sudo apt-get install -y docker.io docker-compose-v2`, then `sudo usermod -aG docker $USER` and log in again so the group applies. Clone the repository. Keep the password where the commands below can read it, readable by you only (the rehearsal used `openssl rand -hex 16 > ~/.armature-pass; chmod 600 ~/.armature-pass`).
2. **Bring up the containers.** In `docker/`: `TERMINUSDB_ADMIN_PASS=$(cat ~/.armature-pass) ARMATURE_SITE=<the domain> docker compose --profile public up -d --build` (or `--profile hub` for an instance only the server itself reads). The hub and the viewer start before the store is ready; every request opens its own connection, so the hub answers 500 until the store is up and the viewer shows an error page until then.
3. **Load the schema and the data** through the `operator` service, which runs the scripts in a throwaway Node 22 container on the private network, so the store keeps its loopback binding. In `docker/`, with `TERMINUSDB_ADMIN_PASS` exported:
   - `docker compose run --rm operator node wait_for_store.js`
   - `docker compose run --rm operator node load_schema.js`
   - `docker compose run --rm operator node seed_data.js` for the demonstration course, or a re-import of an export for real data (ADR-0031 decision 4; `docs/research-path.md` §6)

   The repository is mounted read-only; the scripts' dependencies are installed into a volume on first use and again only when `scripts/package-lock.json` changes (`docker/operator-entrypoint.sh`). Loading and repair are operator work against the store, outside the API (ADR-0062). On a laptop the same scripts also run directly with Node (`node scripts/load_schema.js`), reading `TERMINUS_URL` (default `http://localhost:6363`), `TERMINUS_USER`, `TERMINUS_PASS` and `TERMINUS_DB` (default `armature`) from the shell.
4. **Register the people** who will write, through the API on loopback: `POST /api/v1/users` with a registered caller (the seed registers `demo-designer@example.edu`):
   ```
   curl -X POST http://127.0.0.1:3100/api/v1/users -H 'Content-Type: application/json' \
     -H 'Armature-User: demo-designer@example.edu' \
     -d '{"message":"Register a reviewer","user":{"displayName":"…","externalId":"…"}}'
   ```
   AI agents are users whose `externalId` begins with `agent:`. There are no routes to edit or delete a user; that is operator work too.
5. **Point clients at it.** The viewer already is. A writing client such as CoQui needs the hub's address, which today means running it on the server or widening `ARMATURE_HUB_BIND` behind a proxy that authenticates and sets `Armature-User` itself.

Optional: `ARMATURE_HUB_PUBLIC_URL` gives the viewer an address a reader's browser can follow for the raw-data links in page footers; unset, the links are omitted and the hub stays private. `ARMATURE_EXPORT_KEY` makes pseudonymous exports stable across runs (ADR-0031).

## A hosted instance

What a server on the internet adds to the steps above, and what the rehearsal of 2026-10-21 measured.

**The machine.** Two shared virtual CPUs, 4 GB of memory, 40 GB of disk, a public IPv4 address, either architecture (the TerminusDB and Node images are published for amd64 and arm64). Running, the three Armature containers used about 375 MiB with the seed (the store 292 MiB, the hub 38, the viewer 43). Building the images on the server is the peak: 1.65 GB for the whole machine in the rehearsal, 39 seconds on two virtual CPUs. A 2 GB machine therefore needs a swap file or images built elsewhere; 4 GB builds in place.

**The address.** `ARMATURE_SITE` is the domain Caddy answers for; point its DNS `A` record at the server before step 2, and keep ports 80 and 443 open, because Let's Encrypt checks the domain through them before issuing the certificate. Caddy keeps the certificate in the `caddy-data` volume and renews it itself. `ARMATURE_SITE=:80` serves plain HTTP on any address, for a rehearsal without a domain.

**The firewall.** Use the provider's firewall, which sits outside the machine, allowing 22, 80 and 443 only. A firewall on the machine (Ubuntu's `ufw`) does not cover containers: Docker writes its own packet-filter rules for every published port ahead of `ufw`'s, so a port published on every interface is reachable whatever `ufw` says (verified in the rehearsal with a probe container on 8080). This is why the compose file binds every port but Caddy's to loopback; widening one of the `*_BIND` variables on a hosted server publishes it to the internet.

**Reboots and updates.** The restart policy brings all four containers back after a reboot (verified: the viewer answered within seconds of boot, and a user registered before the reboot was still there). To update: `git pull`, then step 2 again; Docker rebuilds what changed and replaces those containers. A schema change also needs step 3's `load_schema.js` (with `--clear-instances` only for a breaking change, which empties the data first).

**Backups.** The store's data is the `terminusdb-data` volume. Back it up as a volume or a provider snapshot of the machine, or as an export at a commit (`GET /api/v1/export` on loopback), which reloads with step 3.

**Showing a laptop or a rehearsal instance without a server.** `cloudflared tunnel --url http://<the viewer or Caddy's address>` prints a temporary public HTTPS address under `trycloudflare.com`, with no account, for as long as the command runs. It forwards one port outward, so pointing it at the viewer or at Caddy publishes nothing else. Such tunnels carry no uptime guarantee; in the rehearsal one attempt failed to register over QUIC and `--protocol http2 --edge-ip-version 4` worked.

## Several projects

Decide what a project must keep separate (`docs/schema-guide.md` Part I says the same from a tool's side):

- **Projects that share people and history** can be `Course` documents in one store: one hub, one `User` registry, branches named per project. The coverage read takes `?course=`. Export slices are by class, not by course, so an export of such a store carries every course in it.
- **Projects that must not see each other**, and a study that wants a clean export per course (`research-path.md` §1), are separate stores. The one TerminusDB container holds them all; each needs its own hub, which is the `hub` service again with a different `TERMINUS_DB` and port. A second compose project gives a project its own store server as well. Whether one store should hold a course, a program or an institution is an open question of the plan (§6, "Project boundaries"); the mechanics above are the same whichever way it is answered.

A hub that serves several stores from one process is not built; until a deployment has more than a few, one hub container per store is simpler to reason about and to secure.

## Development on a laptop

`docker compose up -d` without a profile runs the store only. The hub then runs on the machine (`npm run build:hub && npm run start:hub` in `app/`, reading `app/.env.local`) and the viewer with `npm run dev`, pointed at it by `ARMATURE_HUB_URL` (default `http://localhost:3100`). The contract suite runs the API in-process against the store and never needs the hub or the viewer containers. `docker compose --profile hub up -d --build` runs the whole instance on loopback (the viewer at `http://localhost:3000`); `docker compose --profile hub rm -sf hub viewer` removes those two and leaves the store.

## What is not there yet

- **Authentication.** The `header` resolver trusts the caller; `oidc` is the named next resolver (ADR-0032). Until it exists, writes happen on the server or behind an authenticating proxy. Caddy is where such a proxy would sit (it can ask an identity provider before forwarding and set the header itself); that is not configured.
- **An administrator's page.** Loading, repair and user edits are terminal commands with the store's password. ADR-0062 (Proposed) describes three operator tools (`check` a branch, `delete`, `put --unchecked`) as commands reusing the API's code with store credentials; a page over them would need authentication first and evidence of what administrators actually do, which the first deployment off a laptop is expected to provide (plan §6).
- **A hosted instance.** Rehearsed on a local VM (2026-10-21); none is running yet (plan, Phase 7).
- **Images built elsewhere.** The server builds its own images from the checkout. CI builds both images on every push but does not publish them; publishing them to a registry would let a 2 GB server pull rather than build.
