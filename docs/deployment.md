# Running an Armature instance

This document is for the administrator who stands up an Armature instance on a machine: what runs, what is reachable by whom, the steps, and what is deliberately not there yet. It describes the deployment as built on 2026-10-21 (Phase 7), rehearsed the same day on a fresh Ubuntu 24.04 virtual machine (VM) and then run on a DigitalOcean Droplet at a real domain (§ "A hosted instance"). The commands are the ones in `docker/docker-compose.yml`; the reasons are in the Architecture Decision Records (ADRs) cited.

## The terms

Used the same way in every Armature document:

| Term | Meaning |
|---|---|
| **Server** | A machine. It runs processes; with Docker, it runs containers, each one process with its packaging |
| **Schema** | The vocabulary: `schema/schema.json`, its types, fields and rules. What a design record is |
| **Store** | One TerminusDB database: a graph with its own commit history, branches and `User` registry. The TerminusDB process holds any number of stores |
| **API** | The contract at `/api/v1` and the Hono code that implements it (`app/lib/api/`) |
| **Host** | One Node process running the API's code: `app/server.ts`, or the container built from it. A server runs as many hosts as it has ports for |
| **Hub** | One host bound to one store: the address a client talks to. Every hub serves the same API; there can be many hubs |
| **Instance** | A hub with its particular data. Usually interchangeable with hub |
| **Client**, **plugin** | Any program that consumes the API: the viewer, CoQui, an importer. Never touches a store |
| **Viewer** | Armature's own pages (Next.js), a client that only reads |
| **Remote hub**, **workspace hub** | A hub's two roles (ADR-0065): a remote is a hub as built, where branches are created, merged and deleted and people registered; a workspace hub is the same API on one person's machine, holding workspaces cloned from one remote and leaving those operations to it (400 `remote_only`). Every hub so far on a server is a remote; § "A workspace hub on this machine" runs the other |
| **Workspace**, **base** | A branch on the remote, owned by one person and cloned to their workspace hub; the base is the remote commit it was cloned at. The rest of the workspace terms (local commit, push, bring in `main`, deliver) are defined in `docs/workspace-hub-plan.md` §2 |

## What runs

```
                              one server, two private networks
   ┌───────────────────────────── armature (the front) ──────────────────────────────┐
   │  caddy ──▶ viewer container ──reads──▶ hub container ◀── a client beside it      │
   │  (TLS)     (Next.js pages)             (Node, the API)                           │
   └────┬───────────────┬─────────────────────────┬────────────────────────────────────┘
        │               │          ┌──────────────┴──────── armature-store ───────────┐
        │               │          │  hub container ──▶ terminusdb container           │
        │               │          │                    (the store server and stores)  │
        │               │          └──────────────┬──────────────────────┬────────────┘
        │ :80, :443     │ :3000 loopback          │ :3100 loopback       │ :6363 loopback
     readers        an operator's check     operators on the server   operator scripts
```

The containers, from one compose file in `docker/`:

| Container | Image | What it is | Published on the server |
|---|---|---|---|
| `caddy` | `caddy:2.10.2-alpine` with `docker/Caddyfile` | The front door: HTTPS for `ARMATURE_SITE` with a certificate it obtains and renews itself, proxied to the viewer by its service name | Ports 80 and 443 on every interface: the public face |
| `viewer` | `docker/viewer.Dockerfile` | The pages, built once (Next.js standalone output); reads the hub by its service name `http://hub:3100` | Port 3000 on loopback only |
| `hub` | `docker/hub.Dockerfile` | The API as one Node process, bundled into one file; reaches the store as `http://terminusdb:6363` | Port 3100 on loopback only |
| `terminusdb` | `terminusdb/terminusdb-server:v12.0.7` | The store server, with a named volume for its databases | Port 6363 on loopback only |
| `workspace` | `docker/hub.Dockerfile` | A workspace hub (profile `workspace`; § "A workspace hub on this machine"): the hub's image in workspace mode, its workspaces in a folder in a named volume, the file-backed store (ADR-0066); no store server | Port 3101 on loopback only |

There are two private networks (ADR-0067 decision 8, note; built 2026-11-01). The front one is named `armature` (whatever the checkout's directory is called): the hubs, the viewer, Caddy, and a client deployed beside the instance join it (§ "A client on the same server"), and call the hub as `http://hub:3100`. The store network, `armature-store`, is joined only by TerminusDB, the hub and the operator service, so nothing on the front network can reach the store; a workspace hub has no store and never joins it. Profiles choose what runs. `--profile hub` runs the store, the hub and the viewer, all on loopback: an instance for the machine it runs on. `--profile public` adds Caddy: a hosted instance; it refuses to start Caddy while `TERMINUSDB_ADMIN_PASS` is unset or `admin` (a one-shot `public-guard` service Caddy waits on, so `up` fails naming the variable and nothing listens beyond the machine). `--profile workspace` adds a workspace hub. The `operator` service (profile `operator`) is not a running container but a way to run the operator scripts on the store network (step 3). Every service restarts with Docker (`restart: unless-stopped`), so an instance comes back after a reboot.

Every hub here runs the `header` resolver inside its container on `0.0.0.0`, so the compose file sets `ARMATURE_TRUST_NETWORK=1` on each, saying a private network is the gate. The hub's image does not: run on its own, under `header`, it refuses to listen on anything but loopback (ADR-0067 decision 8). An instance started before 2026-11-01 upgrades in place: `docker compose --profile public up -d --build` with the newer file moves the store onto `armature-store` and keeps every document (rehearsed; § "A workspace hub on this machine").

Each publication is a compose variable: `ARMATURE_VIEWER_BIND`, `ARMATURE_HUB_BIND`, `TERMINUSDB_BIND`, with `ARMATURE_HUB_PORT` and `ARMATURE_VIEWER_PORT` for the ports.

## Who can do what

- **Readers** reach the viewer through Caddy. Its pages only read, and they carry no identity, so nothing a reader does reaches a writing route. The viewer is read-only by construction, not because the hub enforces it (see below). Caddy proxies the viewer only: `/api/v1/…` at the public address is the viewer's 404, not the hub.
- **Operators on the server** reach the hub on loopback (`curl http://127.0.0.1:3100/api/v1/discover`, a client run on the server) and the store on loopback with its password. This is where the schema and data are loaded, users registered, and repairs made (see "Repair").
- **Nobody else** reaches the hub or the store. The hub's default identity resolver, `header`, trusts whatever `Armature-User` a request claims (ADR-0032), so a hub reachable from beyond the server would let anyone write as anyone. The loopback binding is the gate under it. The authenticating resolver, `oidc`, exists since 2026-11-05 (ADR-0067 decision 1): under `ARMATURE_IDENTITY=oidc`, with `ARMATURE_OIDC_ISSUER` and `ARMATURE_OIDC_AUDIENCE` set, every request but `GET /discover` carries a bearer token the hub verifies against the identity provider's keys, a person is registered on first sign-in only when `ARMATURE_OIDC_ADMIT` lists their provider or email domain, and the first administrator is registered by the operator's `put` on `main` with `issuer` and `externalId` (the person's `sub` at the provider), then granted `Administrator`. Under `oidc` the `public` profile also publishes the hub through Caddy at its own name, `ARMATURE_API_HOST` (`api.<site>` by default), every request to it verified, `GET /discover` and the health probes excepted; under `header` nothing proxies the hub, whatever the variable says (§ "An instance under `oidc`"). Since 2026-11-01 the hub does decide what a resolved identity may do, from `Grant` documents on `main` (ADR-0068): the seed makes the designer an administrator and a maintainer of every branch, whoever creates a branch owns it, and only a maintainer merges into `main`; under `header` that guards against mistakes, since the header itself is still trusted. Anything else placed on the front network can write to the hub as anyone, though it cannot reach the store; keep that network to these containers and to a client you deploy beside them on purpose (§ "A client on the same server").
- **No web page from elsewhere** reaches the hub, even one open in a browser on the server or on a laptop running a hub. The hub answers only loopback host names and those in `ARMATURE_ALLOWED_HOSTS` (the compose file sets `hub`, the name the viewer and a client beside the instance use), so a page that points its own domain at the machine is refused; and it refuses a request whose `Origin` is `null` or a remote web origin (`http` or `https` on a name that is not a loopback one) not in `ARMATURE_ALLOWED_ORIGINS`, empty by default (ADR-0067 decision 7, built 2026-10-30; `app/lib/api/boundary.ts`). A page served from the machine itself (a loopback origin) and a desktop shell (`tauri://localhost`) are served, as local programs the `header` resolver already trusts, but without CORS answers: only a listed origin gets the CORS headers that let a browser page read the hub's responses. A name anything calls the hub by goes in `ARMATURE_ALLOWED_HOSTS` in `docker/.env`; `hub` is always included.

Set `TERMINUSDB_ADMIN_PASS` on any server that is not a laptop, in `docker/.env` (step 1). The compose default, `admin`, is for development only, and the hub and the operator scripts take the same value for their own connections. The `public` profile will not start Caddy without it.

## The steps

The server needs Docker with the Compose plugin and a checkout of this repository, nothing else: no Node.js, since the images and the operator scripts bring their own.

1. **Prepare the server.** On Ubuntu 24.04: `sudo apt-get install -y docker.io docker-compose-v2`. Run the instance as an ordinary user in the `docker` group rather than as root (a fresh Droplet logs you in as root: `adduser --disabled-password --gecos "" armature`, `usermod -aG docker armature`, and copy `/root/.ssh/authorized_keys` into `/home/armature/.ssh/`); a user added to the group must log in again before it applies. As that user, clone the repository and write the instance's settings to `docker/.env`, readable by that user only:
   ```
   cd armature/docker
   (umask 077; printf 'TERMINUSDB_ADMIN_PASS=%s\nARMATURE_SITE=%s\n' "$(openssl rand -hex 16)" armature.example.org > .env)
   ```
   Compose reads `docker/.env` on every command run in `docker/`, and Git ignores it (`.env*`). Keep the settings there rather than on the command line: a later `up` without them would recreate the hub with the development password, which the store refuses, and Caddy with the site `localhost`.
2. **Bring up the containers.** In `docker/`: `docker compose --profile public up -d --build` (or `--profile hub` for an instance only the server itself reads, or before the domain resolves; see "The address" below). The hub and the viewer start before the store is ready; every request opens its own connection, so the hub answers 500 until the store is up and the viewer shows an error page until then.
3. **Load the schema and the data** through the `operator` service, which runs the scripts in a throwaway Node 22 container on the store network, so the store keeps its loopback binding. In `docker/` (the password comes from `docker/.env`):
   - `docker compose run --rm operator node wait_for_store.js`
   - `docker compose run --rm operator node load_schema.js`
   - `docker compose run --rm operator node seed_data.js` for the demonstration course, or a re-import of an export for real data (ADR-0031 decision 4; `docs/research-path.md` §6)

   The repository is mounted read-only; the scripts' dependencies are installed into a volume on first use and again only when `scripts/package-lock.json` changes (`docker/operator-entrypoint.sh`). Loading is operator work against the store, outside the API (ADR-0062); so is repair, with the tools under "Repair". On a laptop the same scripts also run directly with Node (`node scripts/load_schema.js`), reading `TERMINUS_URL` (default `http://localhost:6363`), `TERMINUS_USER`, `TERMINUS_PASS` and `TERMINUS_DB` (default `armature`) from the shell.
4. **Register the people** who will write, through the API on loopback: `POST /api/v1/users` with a registered caller (the seed registers `demo-designer@example.edu`):
   ```
   curl -X POST http://127.0.0.1:3100/api/v1/users -H 'Content-Type: application/json' \
     -H 'Armature-User: demo-designer@example.edu' \
     -d '{"message":"Register a reviewer","user":{"displayName":"…","externalId":"…"}}'
   ```
   AI agents are users whose `externalId` begins with `agent:`. There are no routes to edit or delete a user; that is operator work too (see "Repair").
5. **Point clients at it.** The viewer already is. A writing client such as CoQui needs the hub's address, which today means running it on the server, on the `armature` network (§ "A client on the same server"), or widening `ARMATURE_HUB_BIND` behind a proxy that authenticates and sets `Armature-User` itself (a deployment of the `header` resolver behind a trusted network, not the planned mechanism). The route for a writing client elsewhere is an instance under the `oidc` resolver, whose hub Caddy publishes at `api.<site>` and which takes a signed token on every request (§ "An instance under `oidc`"; ADR-0067, built 2026-11-05).

Optional: `ARMATURE_HUB_PUBLIC_URL` gives the viewer an address a reader's browser can follow for the raw-data links in page footers; unset, the links are omitted and the hub stays private. If it names the hub by a name other than a loopback one, that name goes in `ARMATURE_ALLOWED_HOSTS` too, or the hub refuses the reader's request. `ARMATURE_ALLOWED_ORIGINS` lists web origins whose pages may call the hub from a browser (comma-separated, `https://tool.example.org`); none needs to today. `ARMATURE_EXPORT_KEY` makes pseudonymous exports stable across runs (ADR-0031).

## Repair

A few states can be reached through the API and not left through it: an identifier written under the wrong type, a user with a typo, a record that predates a rule, a branch a crashed test left behind (ADR-0062). The operator tools repair them from the hub's container, where the store's credentials already are, and every repair is a new commit with an author and a reason; history is never rewritten. In `docker/`:

- `docker compose exec hub node operator.mjs check` reports every rule the data on `main` breaks, in the shape the API's 422 uses. `--branch <name>` or `--commit <id>` checks another state, `--json` prints it for a program. It writes nothing and exits 1 when it finds something. Run it after every repair.
- `docker compose exec hub node operator.mjs delete <id> --branch <name> --as <externalId> --reason "<why>"` deletes one document as a commit by that registered user. The store refuses to delete a document another one references; the deleted document stays readable at the commit before, which the tool prints.
- `docker compose exec -T hub node operator.mjs put - --branch <name> --as <externalId> --reason "<why>" < fix.json` writes one document, or an array of them, through the same pipeline and rules as the API. A user's email is corrected this way on `main`. `--unchecked` skips the hub's rules, never the store's, for a repair that needs an intermediate state the rules refuse; the commit message says the rules were skipped, and `check` should run straight after.
- `docker compose exec hub node operator.mjs delete --scratch-branch <name> --as <externalId>` deletes a branch whose name starts with `test-`, `warmup-`, `anon-`, `future-` or `operator-` (or a workspace branch `<handle>_<such a name>`), first revoking the grants that name it as a marked commit on `main` by the operator (ADR-0068 decision 3). A branch holding design work is never deleted; give it a name that marks it as abandoned instead. `check` on `main` also reports a grant in force naming a branch the store lacks, and a branch with no owner; the repair for either is `put` on the grant, and `put` on `main` is how an instance's first administrator is written when the seed is not used.

Each repair is made on a short-lived branch named `operator-…` and lands on its target as one commit marked in its metadata, `{ "armature": { "operator": { "tool", "rulesSkipped" } } }`, so a reader of the log can tell a repair from a plugin's write. The short-lived branch is deleted when the repair ends; one a crash left behind is deleted like any scratch branch. A repair is refused, not merged, if its target branch moved while it ran; run it again.

`--as` names the operator's own `User`, registered like anyone else (step 4); the same person may be a designer on one commit and an operator on the next, and the message says which. On a laptop, `npm run operator --workspace app -- check` builds and runs the same tools with `app/.env.local`.

## A client on the same server

Added 2026-10-25, for a demonstration in which CoQui writes and the viewer shows what it wrote. A writing client can run on the instance's server without an identity system: it joins the front network, calls the hub by its service name, is reachable from outside only through Caddy, and cannot reach the store. The hub's `header` resolver still trusts its caller; what makes that safe is unchanged, since nothing outside the server can reach the hub. The client becomes the one component that decides who a person is: its own sign-in, or a fixed demonstration user, chooses the `Armature-User` it sends.

What the client brings, in its own repository (Armature's files never name it):

- **A container,** in a compose file whose service joins `armature` as an external network and publishes no port:
  ```yaml
  services:
    coqui:
      build: .
      restart: unless-stopped
      environment:
        - ARMATURE_URL=http://hub:3100
      networks: [armature]
  networks:
    armature:
      external: true
  ```
  Start it after the instance, which creates the network; `docker network ls` shows `armature` once the instance is up.
- **Its site,** as a file in `docker/sites/` on the server, which Caddy imports (`docker/sites/README.md` has the form and the reload command). Its domain needs its own `A` record, as `ARMATURE_SITE` does. Git ignores the files there; they belong to the server.
- **Its people.** A client that writes as the seed's users (`demo-reviewer@example.edu`, `demo-designer@example.edu`) needs no registration; otherwise step 4.

Two rules keep it safe, and the second is the client's:

1. **The hub stays unreachable from outside.** Nothing about the hub's publication changes; do not widen `ARMATURE_HUB_BIND` for the client, which reaches the hub inside the network.
2. **`Armature-User` is chosen by the client's server, never by a browser.** Every call to the hub is made in server-side code; a route that forwarded a header, a body field or a query parameter naming the user would let any visitor write as anyone.

Rehearsed on 2026-10-25 on a fresh Lima VM (Ubuntu 24.04), with a stand-in client: a Node container in its own compose project, joined to `armature`, writing a finding through the hub as the seed's reviewer, and served through Caddy from a site file. From the laptop, the client's site answered and its write appeared in the viewer on the next load. A request carrying `Armature-User: demo-designer@example.edu` was written as the reviewer, since the client ignores what the caller sends. Ports 3000, 3100 and 6363 were closed, and `/api/v1/discover` at the public address was the viewer's 404. A reset with `--recreate` removed the write and left the seed checking clean, and after a reboot all five containers came back, the client still on the network. With no site file, Caddy logs a warning ("No files matching import glob pattern") and serves the instance alone.

Run on a DigitalOcean Droplet on 2026-10-26 with CoQui as the client (its `docs/armature-demo-runbook.md` is the client's side of the same arrangement): clean clones of both repositories' `main` (Armature `24a476e`, CoQui `34ee4e4`, the private one through a read-only deploy key made on the server), `s-2vcpu-4gb` in `tor1`, x86-64. One Caddy got certificates for both names (`armature.amosglenn.com` from `ARMATURE_SITE`, `coqui-demo.amosglenn.com` from the client's file in `docker/sites/`) on the first attempt. From outside: 3000, 3100, 3200 (the client's loopback port), 6363 and Caddy's admin port 2019 were closed; both names answered `http://` with 308 to `https://` and served over HTTP/2; `/api/v1/discover` was a 404 under both. The client's walk ran in Chromium at the public address with `Armature-User: demo-designer@example.edu` added to every request the browser made: the attestation, the finding, its withdrawal and the branch head were all the reviewer's, on the visitor's branch and absent from `main`, and the client's link opened the viewer on that branch. After a reboot the viewer answered in 23 seconds and the client in 25, with no new certificate requested. The reset with the client's restart took 6 seconds, removed the visitor's branch and left the seed checking clean; the walk then passed on a new branch. Building the client's image (334 MB on x86-64) took the machine to 2.2 GB of its 4. The Droplet was deleted after the checks.

Check from outside, before anyone else uses it: the hub's and the store's ports (3100, 6363) are closed; the client's domain answers through Caddy; the instance's domain still serves the viewer; and no request to the client lets the caller choose the person written as. The memory is small: the three Armature containers used about 375 MiB on the Droplet of 2026-10-21 (the store's share grows with use), and on 2026-10-26, after the walks, all five used about 380 MiB, the CoQui container 79 of it.

### Resetting a demonstration instance

A demonstration that others write to drifts from the seed, and every write lengthens the commit log, which slows the store's history reads. `load_schema.js --recreate` deletes the database, with its documents, branches and log, creates it again and loads the schema; the seed follows. In `docker/`:

```
docker compose run --rm operator node load_schema.js --recreate
docker compose run --rm operator node seed_data.js
```

It destroys everything the database holds: never on an instance with real data. For a nightly reset, a crontab line for the instance's user (`crontab -e`): `0 4 * * * cd ~/armature/docker && docker compose run --rm operator node load_schema.js --recreate && docker compose run --rm operator node seed_data.js`. A client that caches what it read from the hub should expect the graph to return to the seed: the seed's identifiers are the same after a reset, those the hub derives from key fields (placements, attestations, declarations) included, while every commit identifier changes.

## A hosted instance

What a server on the internet adds to the steps above, and what was measured on 2026-10-21: first in a rehearsal on a local Ubuntu 24.04 VM (Lima, 2 virtual CPUs, 4 GB), then on a DigitalOcean Droplet (`s-2vcpu-4gb`, region `nyc3`) serving `armature.amosglenn.com`, which was verified from outside and then destroyed by choice (§ "The DigitalOcean run").

**The machine.** Two shared virtual CPUs, 4 GB of memory, 40 GB of disk, a public IPv4 address, either architecture (the TerminusDB and Node images are published for amd64 and arm64). Running, the three Armature containers used about 375 MiB with the seed (the store 292 MiB, the hub 38, the viewer 43). Building the images on the server is the peak: 1.65 GB for the whole machine in the rehearsal (39 seconds on an Apple-silicon VM) and 1.67 GB on the Droplet (104 seconds on its shared x86 CPUs). A 2 GB machine therefore needs a swap file or images built elsewhere; 4 GB builds in place.

**The address.** `ARMATURE_SITE` is the domain Caddy answers for. Give it an `A` record (not a `CNAME`, which names another name; a Droplet has only an address) pointing at the server, and keep ports 80 and 443 open, because Let's Encrypt checks the domain through them before issuing the certificate. Start Caddy only once the record answers at the domain's own nameserver (`dig +short <the domain> @<one of its NS records>`): until then run step 2 with `--profile hub` and do step 3, then run step 2 with `--profile public`. A request for a certificate made before the name resolves fails, and repeated failures are rate-limited. Avoid querying a public resolver (1.1.1.1, 8.8.8.8) for the name before the record exists: it caches the "no such name" for the zone's negative-caching time, which delays your own checks, though not Let's Encrypt's. On the Droplet, whose domain's DNS is at GoDaddy, the certificate came on the first attempt. Caddy keeps the certificate in the `caddy-data` volume and renews it itself; a `CAA` record on the domain, if there is one, must allow Let's Encrypt. `ARMATURE_SITE=:80` serves plain HTTP on any address, for a rehearsal without a domain.

**The firewall.** Use the provider's firewall, which sits outside the machine, allowing 22, 80 and 443 only. A firewall on the machine (Ubuntu's `ufw`) does not cover containers: Docker writes its own packet-filter rules for every published port ahead of `ufw`'s, so a port published on every interface is reachable whatever `ufw` says (verified in the rehearsal with a probe container on 8080). This is why the compose file binds every port but Caddy's to loopback; widening one of the `*_BIND` variables on a hosted server publishes it to the internet. On the Droplet both layers held: from outside, 3000, 3100 and 6363 timed out (the provider's firewall drops them before the machine sees them), `http://` answered 308 to `https://`, and `/api/v1/discover` at the public address was the viewer's 404.

**Reboots and updates.** The restart policy brings all four containers back after a reboot (verified: on the VM a user registered before the reboot was still there; on the Droplet the coverage page answered over HTTPS about 26 seconds after the reboot command, with the stored certificate and no new request to Let's Encrypt). To update: `git pull`, then step 2 again; Docker rebuilds what changed and replaces those containers, with the settings from `docker/.env` (on the Droplet, an `up` with the file and no variables recreated nothing). A schema change also needs step 3's `load_schema.js` (with `--clear-instances` only for a breaking change, which empties the data first).

**Backups.** The store's data is the `terminusdb-data` volume. Back it up as a volume or a provider snapshot of the machine, or as an export at a commit (`GET /api/v1/export` on loopback), which reloads with step 3.

**Showing a laptop or a rehearsal instance without a server.** `cloudflared tunnel --url http://<the viewer or Caddy's address>` prints a temporary public HTTPS address under `trycloudflare.com`, with no account, for as long as the command runs. It forwards one port outward, so pointing it at the viewer or at Caddy publishes nothing else. Such tunnels carry no uptime guarantee; in the rehearsal one attempt failed to register over QUIC and `--protocol http2 --edge-ip-version 4` worked.

### An instance under `oidc`

Since 2026-11-05 (ADR-0067 decisions 1, 4, 5, 7 and 9; ADR-0068 decision 4). The same containers, with the hub's identity resolver verifying a bearer token from an identity provider on every request, and the hub published beside the viewer so that clients elsewhere can write. What changes from the steps above:

1. **The provider.** Any OpenID Connect provider: the institution's, a hosted one, or CILogon for research logins (ADR-0067 open question 2 names none). Register two clients there: one for people, a public native client with PKCE (its id goes in `ARMATURE_OIDC_CLIENT_ID`, which `GET /discover` publishes for programs to sign in with), and one for the viewer, a confidential client with the client credentials grant. Configure the provider to put this hub's audience, the value of `ARMATURE_OIDC_AUDIENCE`, into both clients' access tokens; providers call this an audience mapper or an API identifier, and a token without it is refused (`invalid_token`, `reason: audience`). A person's token carries `name` and `email`; a service's carries neither and names its client in `azp` or `client_id`, which is how the hub tells them apart.
2. **The settings,** in `docker/.env` beside the password and the site:
   ```
   ARMATURE_IDENTITY=oidc
   ARMATURE_OIDC_ISSUER=https://login.example.edu/realms/armature   # the token's iss, exactly
   ARMATURE_OIDC_AUDIENCE=armature-hub                                # the token's aud
   ARMATURE_OIDC_ADMIT=example.edu                                    # who is registered on first sign-in: issuers (URLs) and email domains; empty admits no one
   ARMATURE_OIDC_CLIENT_ID=armature-desktop                           # the native client, for GET /discover
   ARMATURE_API_HOST=api.armature.example.org                         # where Caddy publishes the hub; api.<ARMATURE_SITE> by default
   ARMATURE_HUB_PUBLIC_URL=https://api.armature.example.org           # so the viewer's footers link to it
   ARMATURE_HUB_CLIENT_ID=armature-viewer                             # the viewer's own credential
   ARMATURE_HUB_CLIENT_SECRET=…
   ```
   `ARMATURE_OIDC_JWKS_URL` names the provider's key set when it is not where the issuer's metadata says, and `ARMATURE_HUB_TOKEN_ENDPOINT` the token endpoint when the viewer's container cannot reach the issuer's public name (the rehearsal below needs both). The `public` profile refuses to start Caddy while `oidc` is set without its issuer and audience, or without a bare host name in `ARMATURE_API_HOST` (step 2's `up` names what is missing). `ARMATURE_API_HOST` needs its own `A` record and, like the site, gets its certificate from Let's Encrypt; `ARMATURE_API_SCHEME=http` serves it plain, for a rehearsal.
3. **The first administrator,** before anyone signs in. Under `oidc` a person is matched by the provider and their subject together, so a `User` registered under `header`, the seed's included, is never a token's subject: the first administrator is written by the operator's `put` on `main` with `issuer` and `externalId` (the person's `sub` at the provider; many providers show it in the account's details, or decode a token's payload), then granted `Administrator` the same way:
   ```
   printf '[{"@type":"User","@id":"User/pat","displayName":"Pat Admin","externalId":"<sub>","email":"pat@example.edu","issuer":"%s"},
            {"@type":"Grant","user":"User/pat","role":"Administrator","status":"Active","rationale":"The instance administrator"}]' "$ARMATURE_OIDC_ISSUER" \
     | docker compose exec -T hub node operator.mjs put - --branch main --as demo-designer@example.edu --reason "The first administrator"
   ```
   Everyone else signs in: admitted by `ARMATURE_OIDC_ADMIT`, a person is registered on their first request; otherwise their valid token is 403 `not_registered` until an administrator registers them with `POST /users`, naming `issuer`. An instance moving from `header` to `oidc` adds `issuer` to its existing `User` documents the same way first, so no one is registered twice. The viewer's agent is registered once by any person (`externalId` `agent:<its client id>`), and reads.
4. **The checks from outside,** once `--profile public` is up: `GET https://api.<site>/api/v1/discover` answers with `identity.resolver: "oidc"`, the issuer, the audience and the client id, and `/api/v1/health/live` and `/health/ready` answer without a token; `/api/v1/users/me` without a token is 401 `identity_required` with `WWW-Authenticate: Bearer`; with a token from the provider it is the person, and a token for another audience, an expired one, or one signed by anyone else is 401 `invalid_token` naming the reason; a write with a token writes as that person and no other, whatever `Armature-User` claims (403 `forbidden`, `reason: relay`, unless the caller is a service holding a `Relay` grant); `ETag` and `If-Match` round trip through the proxy, so a stale `If-Match` is 412. The proxy limits a request body to 10 MB, the hub's own cap, and waits 90 seconds for the hub's answer (`docker/caddy/oidc.caddy`).

**A rehearsal with Keycloak,** on the VM of § "Testing a deployment": `docker compose --profile public --profile rehearsal-oidc up -d --build` adds an identity provider in development mode on loopback port 8080, its realm from `docker/rehearsal/keycloak-realm.json`: the two clients above (`armature-desktop`, with password sign-in enabled so a rehearsal's `curl` gets a token; `armature-viewer`, secret `rehearsal-viewer-secret`), both with `armature-hub` as audience, and two people, `designer` and `reviewer`, whose passwords are their names and whose emails are under `example.edu`. Tokens name the issuer by `KEYCLOAK_HOSTNAME` (`http://localhost:8080` by default), which the containers cannot reach, so the hub and the viewer are pointed at the service name for the keys and the token endpoint:
```
TERMINUSDB_ADMIN_PASS=<something>
ARMATURE_SITE=http://armature.rehearsal
ARMATURE_IDENTITY=oidc
ARMATURE_OIDC_ISSUER=http://localhost:8080/realms/armature
ARMATURE_OIDC_AUDIENCE=armature-hub
ARMATURE_OIDC_ADMIT=example.edu
ARMATURE_OIDC_CLIENT_ID=armature-desktop
ARMATURE_OIDC_JWKS_URL=http://keycloak:8080/realms/armature/protocol/openid-connect/certs
ARMATURE_API_HOST=api.armature.rehearsal
ARMATURE_API_SCHEME=http
ARMATURE_HUB_CLIENT_ID=armature-viewer
ARMATURE_HUB_CLIENT_SECRET=rehearsal-viewer-secret
ARMATURE_HUB_TOKEN_ENDPOINT=http://keycloak:8080/realms/armature/protocol/openid-connect/token
```
A token for the designer, from the VM: `curl -s -d grant_type=password -d client_id=armature-desktop -d username=designer -d password=designer http://localhost:8080/realms/armature/protocol/openid-connect/token | jq -r .access_token`. The two names resolve nowhere, so the checks send them as the `Host` header to the VM's address (`curl -H 'Host: api.armature.rehearsal' http://<vm>/api/v1/discover`). Keycloak here is a rehearsal's provider and never a deployment's: in memory, development mode, a fixed secret in the repository.

**Rehearsed 2026-11-05** on a fresh Lima VM (Ubuntu 24.04, 2 virtual CPUs, 4 GB) from a clean copy of the branch, the `public` and `rehearsal-oidc` profiles together, the settings above. The guard refused `oidc` with `ARMATURE_SITE=:80` and no API host, naming the variable. Every check of step 4 held through Caddy with the two names sent as `Host`: discovery open with the issuer, audience and client id; both probes open; no token 401 with the challenge; a token with its signature altered `signature`, Keycloak's own token for its account console `audience`; the designer and the reviewer registered on their first request under `example.edu` with their issuer and no grants; the viewer's service token its agent once registered, refused a branch with `credential`; the user list refused to the reviewer, served to the administrator, the agents open to both; `Armature-User` beside a token refused as a relay claim; a write as the token's person with the owner grant written; a stale `If-Match` 412 and a fresh one landing, through the proxy; an 11 MB body 413 at the proxy; the viewer's pages 200 with its own credential; `/api/v1/discover` under the site's own name the viewer's 404; ports 3000, 3100, 6363 and 8080 closed on the VM's address; the operator's `check` clean. A workspace hub beside it (`--profile workspace`, `ARMATURE_REMOTE_TOKEN` the designer's token) created and cloned a workspace through the token, mirrored the owner and the agents only, pushed a local commit, and refused a local request as anyone else with `remote_identity`. Three things the rehearsal found and this branch fixed: Keycloak 26 puts `sub` in an access token only through its `basic` client scope, which the realm now names explicitly; the operator's `put` refused `User` documents, so the first administrator could not be written (ADR-0062 had promised it; it takes them now); and the viewer kept a token the hub had begun refusing after the provider's keys changed, answering 500 until it expired, so it now forgets a refused token and asks once more. Whole-day timings: the images built in about 100 seconds on the VM, Keycloak answered 6 to 9 seconds after its container started.

### The DigitalOcean run

How the Droplet of 2026-10-21 was made, for whoever stands one up again. It was driven from a laptop with `doctl`, DigitalOcean's command-line tool, and an API token that never touched a file:

- **The token** was scoped to what the run needs (`droplet:create`, `droplet:read`, `droplet:delete`, `actions:read`, `image:read`, `sizes:read`, `regions:read`, `ssh_key:read`, `firewall:create`, `firewall:read`, `firewall:update`, `firewall:delete`, `account:read`), with the shortest expiry offered, and kept in the macOS Keychain (`security add-generic-password -a "$USER" -s digitalocean-armature -w`, which prompts for the value). Each command read it inline: `DIGITALOCEAN_ACCESS_TOKEN="$(security find-generic-password -s digitalocean-armature -w)" doctl …`. `doctl auth init` was not used, since it saves the token in doctl's configuration file. The token cannot upload an SSH key (`ssh_key:read` only), so the key is added in the control panel.
- **The Droplet:** `doctl compute droplet create armature-demo --region nyc3 --size s-2vcpu-4gb --image ubuntu-24-04-x64 --ssh-keys <key id> --tag-name armature --wait`. It is billed per second from creation to deletion, $0.0357 an hour at this size; a powered-off Droplet still bills. A size is not offered in every region at every moment: on 2026-10-26 `nyc3` refused `s-2vcpu-4gb` ("Size is not available in this region") and `tor1` served; `doctl compute size list -o json` lists each size's regions.
- **The firewall,** attached by tag: `doctl compute firewall create --name armature-demo --tag-names armature --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:80,… protocol:tcp,ports:443,… protocol:udp,ports:443,…" --outbound-rules "protocol:tcp,ports:all,… protocol:udp,ports:all,… protocol:icmp,…"` (UDP 443 is HTTP/3).
- **Then** steps 1 to 3 over SSH, as root for the packages and the user, as `armature` for the rest; "The address" for the record; the checks from outside as listed above. Ubuntu's DigitalOcean image already refuses password logins and runs unattended security upgrades.
- **Removal:** `doctl compute droplet delete <id>`, `doctl compute firewall delete <id>`, the `A` record at the registrar, a deploy key a client's checkout used (`gh repo deploy-key delete <id> -R <repository>`), and the address's entry in `~/.ssh/known_hosts` (`ssh-keygen -R <address>`), since the address goes to someone else.

## Testing a deployment: a virtual machine and a Droplet

Decided 2026-10-22. Continuous integration (CI) already tests the code on every push: lint and type checks, the contract suite against a fresh TerminusDB on a clean Linux runner, and both images built and started. A virtual machine (VM) or a Droplet adds nothing for a change to a route, a rule or the seed. What they test is what CI never sees: Compose, the network, the host, and the internet.

**A VM on the laptop (Lima): before merging any change to how an instance runs.** A pull request that changes `docker/docker-compose.yml`, either Dockerfile, the `Caddyfile`, `docker/operator-entrypoint.sh`, or the steps in this guide gets a rehearsal on a fresh VM before it merges: steps 1 to 3 from a clean clone of the branch, the checks under "A hosted instance", and the operator's `check`. Also rehearse there:

- **Upgrading an instance that holds data:** pull a newer `main`, rebuild, load the schema, against a volume that already holds documents. CI always starts empty, so it cannot catch a schema change that existing data does not survive. Do this before the first such change reaches a kept instance.
- **Restart and reboot behavior,** including the store stalls that follow a cold start; a VM can be power-cycled on purpose.
- **A backup and its restore,** before anyone depends on one.

The VM matters because a laptop hides problems with what is already on it: an installed `node_modules`, a `.env.local`, cached images, old volumes. The rehearsal of 2026-10-21 found three gaps that way, and a read-only mount that worked only because a folder already existed on the laptop. A VM that matches the rehearsal's (Ubuntu 24.04, 2 virtual CPUs, 4 GB, no shared folders, no port forwarding, reached at its own address):

```
limactl start --name=armature-rehearsal --tty=false --cpus=2 --memory=4 --disk=40 --mount-none \
  --containerd=none --network=vzNAT \
  --set '.portForwards=[{"guestPortRange":[1,65535],"guestIP":"0.0.0.0","ignore":true},{"guestPortRange":[1,65535],"ignore":true}]' \
  template:ubuntu-24.04
```

Lima on an Apple Silicon laptop runs arm64, while the Droplet and CI's runners are x86-64: a VM proves a clean Linux machine, not the Droplet's processor.

**A Droplet: for what only a public machine shows, at the moments it matters.** It costs money by the hour and faces the internet, so it is used:

- **Before keeping an instance:** the domain's DNS, Let's Encrypt issuance, the provider's firewall (Docker's published ports bypass `ufw`), a reboot, and memory (building the images peaked at 1.65 GB, so a 2 GB machine needs published images to pull).
- **Before the first remote writing client, and again whenever authentication changes:** from outside, a write without credentials is refused, the hub's and store's ports stay closed, and the author is whom the hub resolved, never what the caller claimed: under the `oidc` resolver (ADR-0067, built 2026-11-05; § "An instance under `oidc`" lists the checks) a token with a wrong audience or an expired one is refused, and a `Host` or `Origin` the hub does not serve is refused from outside (built 2026-10-30). The first such client is planned to be a workspace hub's push (ADR-0065), so that push is the check to run end to end.
- **When the hub is reached through Caddy** (under `oidc`, or behind a proxy that sets `Armature-User` as a deployment of `header`): the `ETag` and `If-Match` round trip end to end. A proxy that compresses or rewrites responses can alter the `ETag`, and the 412 concurrency check depends on it arriving unchanged; check, do not assume.
- **When plugins write concurrently:** the store's contention between writers (one commit graph for every branch) is measured on the real machine.

Follow "The DigitalOcean run" above, and delete the Droplet afterward unless it is the kept instance.

**Never run the contract suite against a store that holds real data.** It creates and deletes branches and registers and removes users on `main`, and a run that crashes leaves them behind. On a server, run the suite against a scratch database on the same TerminusDB (a different `TERMINUS_DB`), or use the operator's `check` (`docker compose exec hub node operator.mjs check`), which writes nothing and is the health check for a live instance.

## Several projects

Decide what a project must keep separate (`docs/schema-guide.md` Part I says the same from a tool's side):

- **Projects that share people and history** can be `Course` documents in one store: one hub, one `User` registry, branches named per project. The coverage read takes `?course=`. Export slices are by class, not by course, so an export of such a store carries every course in it.
- **Projects that must not see each other**, and a study that wants a clean export per course (`research-path.md` §1), are separate stores. The one TerminusDB container holds them all; each needs its own hub, which is the `hub` service again with a different `TERMINUS_DB` and port. A second compose project gives a project its own store server as well. Whether one store should hold a course, a program or an institution is an open question of the plan (§6, "Project boundaries"); the mechanics above are the same whichever way it is answered.

A hub that serves several stores from one process is not built; until a deployment has more than a few, one hub container per store is simpler to reason about and to secure.

## A workspace hub on this machine

Added 2026-11-01, for developers and researchers (ADR-0065; `docs/workspace-hub-plan.md` §10). A designer's install will be a desktop program, at the plan's step 7. The `workspace` service is the hub's image in workspace mode: it clones workspaces from a remote and serves tools on loopback port 3101 (`ARMATURE_WORKSPACE_PORT`). Its workspaces live in the file-backed store (ADR-0066; since the night of 2026-11-02 the one local store, by its decision 4), a folder in the named volume `workspace-folder` holding each workspace's commits beside its records, so the service needs no store server and stays off the store network. Until that night the profile kept its workspaces in a database of the store server here (`ARMATURE_WORKSPACE_DB`, volume `workspace-records`); such a volume holds records without their commits and is not read by the new service, so a workspace made before then is cloned again.

- **Beside an instance,** to try the cycle on one machine: `docker compose --profile hub --profile workspace up -d --build`. The remote is the `hub` service by default (`ARMATURE_REMOTE_URL=http://hub:3100`).
- **The local token** (since 2026-11-03; ADR-0065 decision 7): every write to a workspace hub carries its per-launch secret as `Armature-Local-Token`, and a write without it is **403** `forbidden` (`reason: local_token`); reads need nothing. The desktop program will draw it at each start and hand it to the tools it launches as `ARMATURE_LOCAL_TOKEN`. Until then, set `ARMATURE_LOCAL_TOKEN` in `docker/.env` (`openssl rand -hex 32`), or leave it empty and read the value the hub drew from `docker compose logs workspace`, where it is printed once at each start (and so changes with every restart). The profile also sets `ARMATURE_WORKSPACE_ACTIONS=routes`, since it has no program in front of it: push, bring in and deliver are served as routes here, while a workspace hub run without that setting refuses them (**403** `forbidden`, `reason: program_action`) and `GET /discover` says `actions: program`.
- **What a workspace holds offline** (since 2026-11-02): the branch at its base, the remote's state at each older commit its records name (snapshots, most-referenced first within `ARMATURE_SNAPSHOTS` commits per workspace, 20 by default, set in the service's environment), and the branch's log; a read at any other commit is forwarded to the remote while it can be reached (`docs/api.md`, Workspace).
- **Without a container** (since 2026-11-02; ADR-0066): the hub's bundle alone over the same file-backed store, which is what a designer's install will run. `ARMATURE_ROLE=workspace ARMATURE_REMOTE_URL=<the remote> ARMATURE_WORKSPACE_DIR=<a folder> node app/dist/server.mjs` after `npm run build:hub`; no `TERMINUS_*` variable is read, and the hub says `store: the file-backed store in <the folder>` when it starts, prints the local token it drew unless `ARMATURE_LOCAL_TOKEN` chose one, and says whether the action routes are served (`ARMATURE_WORKSPACE_ACTIONS=routes`) or refused (the default; the bullet above). The folder holds one subfolder per branch (`head.json`, `commits/`), a workspace's records beside its commits, and a `lock` file that refuses a second hub on the same folder. There is no store setting: the role names the store, a remote hub's TerminusDB and a workspace hub's the folder, and a hub given `ARMATURE_STORE` refuses to start (the setting of one day, retired by ADR-0066 decision 4). Keep the folder outside OneDrive, iCloud Drive or Dropbox: a synced folder works while the sync client runs (rehearsed 2026-11-03 on Windows with OneDrive's Files On-Demand), but a commit file the client has made cloud-only cannot be read while the client is stopped or the machine offline, and the hub then answers every request **503** `store_unreadable` naming the file until it is back on disk (since 2026-11-03; before that a bare 500 until a restart). The remedy is the sync client running, or the folder marked "always keep on this device" (ADR-0066 Verification, the note of 2026-11-03). While the client runs, Windows also refuses, now and then, to replace a file the client has just picked up; the hub tries such a rename again for about 2.5 seconds, which the rehearsal's measurement says is plenty, and answers **503** `store_unwritable` naming the file only when that fails, with nothing lost (since 2026-11-03).
- **Against a remote elsewhere:** set `ARMATURE_REMOTE_URL` in `docker/.env` and run `docker compose --profile workspace up -d --build`. The remote must answer to the name in that address: it refuses any host name but loopback and its `ARMATURE_ALLOWED_HOSTS`, so a hub run on the laptop itself is not reachable from the container as `localhost` and needs a name it allows. A remote on another machine cannot be trusted with the `header` resolver, so a remote elsewhere under `header` is a rehearsal arrangement only. A remote under `oidc` (since 2026-11-05) takes the owner's bearer token instead: the hub's process reads it from `ARMATURE_REMOTE_TOKEN` and sends it on every call to the remote, with no `Armature-User`, and refuses to make, push, bring in or deliver a workspace the remote does not resolve that token to the owner of (403 `forbidden`, `reason: remote_identity`); the desktop program will hold the token from the person's sign-in instead (ADR-0067 decision 2). The compose profile does not pass the variable through yet; that comes with the hub's public name.

Then, with a person the remote has registered:

```
curl -X POST http://127.0.0.1:3101/api/v1/workspace -H 'Content-Type: application/json' \
  -H 'Armature-User: demo-designer@example.edu' -H "Armature-Local-Token: $ARMATURE_LOCAL_TOKEN" \
  -d '{"name":"chapter-2"}'
```

creates `demo-designer_chapter-2` on the remote and clones it; tools then write to that branch at `http://127.0.0.1:3101/api/v1`, every write with the same token header, and `GET /api/v1/workspace/demo-designer_chapter-2/status` shows the local commits since the clone and how many are pushed, and `POST /api/v1/workspace/demo-designer_chapter-2/push`, as the same person with the token, replays the local commits on the remote; `…/bring-in` brings in the remote's `main` and `…/deliver`, with a message, merges the workspace into `main` (`docs/api.md`, Workspace; all built 2026-11-01, the token since 2026-11-03).

**Rehearsed on 2026-11-01** on a fresh Lima VM (Ubuntu 24.04, Docker 29.1 and Compose 2.40 from Ubuntu's packages):

- The `public` profile with no `docker/.env`, and with the password `admin`, failed `up` with exit 1 and the guard's message, Caddy created but not running.
- An instance on `main`'s compose file (`public`, seed loaded, `check` clean) was upgraded in place by `up -d --build` with the new file. The head and every document were unchanged, `check` was still clean, the store was on `armature-store` alone, the hub on both networks, and the viewer and Caddy on `armature`.
- A client container on `armature`, and the viewer, reached the hub and could not resolve `terminusdb`. The hub's image run alone exited 1, refusing to listen on `0.0.0.0`.
- With `--profile workspace` beside the instance, a workspace was created and cloned, a local write stayed off the remote, a write to `main` was `remote_only`, and status survived a restart of the container.
- From the laptop only port 80 answered; 3000, 3100, 3101 and 6363 were closed.
- After the VM was power-cycled every container came back and the workspace's status still answered.

**Rehearsed again on 2026-11-02 (night)** on a fresh Lima VM of the same kind, when the file-backed store became a workspace hub's default and the profile was pinned to `ARMATURE_STORE=terminusdb`:

- `--profile hub --profile workspace up -d --build`, the schema and the seed through the operator service: the `workspace` container started over `http://terminusdb:6363 database workspace`, the `hub` container over `armature`; a workspace was created and cloned, its records volume held `workspace.json`, `snapshots.json` and `log.json` and no `head.json` or `commits/`, the remote listed the branch, status survived a restart, `check` on `main` was clean, and only 3000, 3100, 3101 and 6363 were published, on loopback.
- The hub's image run as a remote hub with `ARMATURE_STORE=files` exited 1 with its message. Run in workspace mode with `ARMATURE_STORE` unset and a folder the image's `node` user can write, it started over the file-backed store and wrote its `lock` there.

**Rehearsed a third time the same night** on a fresh Lima VM, when ADR-0066 decision 4 moved the profile onto the folder:

- The resolved `workspace` service carried no `TERMINUS_*` variable and no store setting. After `--profile hub --profile workspace up -d --build`, the schema and the seed, the container started over `the file-backed store in /workspaces`, was on the `armature` network alone and could not resolve `terminusdb`.
- A workspace was created and cloned: the volume held `store.json`, the `lock` (the container's process), `main/`, two `at.<commit>/` snapshot folders and the workspace's own folder with `head.json`, `commits/` and its three records. A local write was a commit file there, `localCommits: 1` in status, and 404 on the remote. After a restart of the container the lock was taken over, status still counted the commit and the document still read. A push replayed it as one remote commit, after which the remote served the document; the remote listed the branch and `check` on `main` was clean.
- The image given `ARMATURE_STORE` exited 1. Only 3000, 3100, 3101 and 6363 were published, on loopback.

**Rehearsed a fourth time on 2026-11-03 (night)** on a fresh Lima VM of the same kind, when every write to a workspace hub began to carry the local token and the action routes were gated:

- `--profile hub --profile workspace up -d --build` with no `ARMATURE_LOCAL_TOKEN` in `docker/.env`: the workspace container's log said `actions: … served as routes (ARMATURE_WORKSPACE_ACTIONS=routes)` and printed a 64-character `local token` it had drawn; `GET /discover` said `localToken: required, actions: routes`. Creating a workspace without the header, and with a wrong value, was **403** `forbidden` with `reason: local_token`; with the printed value, 201. A write without the token was 403 and with it 200; status, a read, needed none. A push without the token was 403, with it 200, and the remote held the document.
- After `restart workspace` the log showed a different token, the old value was refused and the new one accepted, and status still counted the commits.
- With `ARMATURE_LOCAL_TOKEN` set in `docker/.env` and `up -d` again, the log said `local token: from ARMATURE_LOCAL_TOKEN`, the chosen value wrote and the drawn one was refused.
- The hub's image run alone in workspace mode on the `armature` network, with a token and without `ARMATURE_WORKSPACE_ACTIONS`, said the actions `are the program's own; the routes are refused`, listed `actions: program`, refused `POST …/push` with **403** `forbidden`, `reason: program_action`, and still cloned a workspace with the token.
- Only 3000, 3100, 3101 and 6363 were published, on loopback.

The runtimes beyond Docker Engine and Docker Desktop (Colima on macOS, Podman Desktop on Windows; plan §10) are not yet rehearsed with this profile.

## Development on a laptop

`docker compose up -d` without a profile runs the store only. The hub then runs on the machine (`npm run build:hub && npm run start:hub` in `app/`, reading `app/.env.local`) and the viewer with `npm run dev`, pointed at it by `ARMATURE_HUB_URL` (default `http://localhost:3100`). The contract suite runs the API in-process against the store and never needs the hub or the viewer containers. `docker compose --profile hub up -d --build` runs the whole instance on loopback (the viewer at `http://localhost:3000`); `docker compose --profile hub rm -sf hub viewer` removes those two and leaves the store.

## What is not there yet

- **Authentication.** Built: every hub checks `Host` and `Origin` (ADR-0067 decision 7, 2026-10-30; § "Who can do what"). Built 2026-11-01: decision 8's bound on `header`, a hub refusing to listen beyond loopback unless `ARMATURE_TRUST_NETWORK=1`, which the compose file sets. Built 2026-11-01: decisions 3, 6 and the rest of 8, agents acting for people under either resolver (`Armature-Agent`, the person recorded in a trailer the hub writes and refuses from clients). Built 2026-11-05: decision 1, the `oidc` resolver verifying a bearer token against the issuer's published keys with admission on first sign-in (`ARMATURE_OIDC_ADMIT`), the resolving half of decision 4 (a service's token resolves to its agent and reads), and decision 9, `GET /discover` saying how to authenticate (`app/README.md` lists the variables). Built later the same day: relays (decision 5), a service holding a `Relay` grant delivering a person's earlier work as theirs; the viewer holding a service credential (`app/README.md`: `ARMATURE_HUB_TOKEN`, or its client id and secret); a workspace hub reaching a remote under `oidc` with the owner's token (decision 2's hub side); and the hub published beside the viewer under `oidc` with the health routes (decision 7's note; § "An instance under `oidc`"). Specified, not built: the program's own sign-in (below). Until then writes happen on the server or beside the hub on its network under `header`. A proxy that authenticates and sets `Armature-User` itself (Caddy could, with an identity provider) is a possible deployment of `header` behind a trusted network, which ADR-0067 lists under its alternatives and does not exclude; it is not the mechanism, since agents, relays and the on-behalf-of record need claims the hub itself sees and checks.
- **Authorization.** Built 2026-11-01 (ADR-0068): `Grant` documents on `main`, branch ownership, only a maintainer merging into `main`, 403 `forbidden`, the check run on a remote hub under every resolver. A branch with no owner stays writable by any registered user until the migration window is closed, which is not yet a setting; `GET /discover` says `ownerlessBranches: "writable"`. Built 2026-11-05 with the `oidc` resolver, the rows amended on 2026-10-30: under `oidc`, first sign-in registers a person only when `ARMATURE_OIDC_ADMIT` lists their identity provider or email domain, and a full export or the user list needs a maintainer of `main` or an administrator, the default export being pseudonymous (ADR-0067 decision 1 and ADR-0068 decision 4, notes).
- **Native sign-in for programs.** The desktop program's own sign-in with PKCE and its keychain (ADR-0067 decision 2) comes with the program (the workspace hub plan's step 7); until then a workspace hub takes the owner's token from `ARMATURE_REMOTE_TOKEN`. The hub published beside the viewer, with the health routes and the proxy's limits, was built 2026-11-05 (§ "An instance under `oidc`").
- **An administrator's page.** Loading, repair and user edits are terminal commands with the store's password: the scripts, and the three operator tools of ADR-0062 in the hub's container (see "Repair"). A page over them would need authentication first and evidence of what administrators actually do, which the first deployment off a laptop is expected to provide (plan §6).
- **A standing hosted instance.** One ran on a DigitalOcean Droplet on 2026-10-21, was verified from outside and was destroyed by choice; a second ran on 2026-10-26 with CoQui beside it (§ "A client on the same server") and was deleted after its checks; none is running. Standing one up again is the steps above; at the size used it costs $24 a month.
- **Images built elsewhere.** The server builds its own images from the checkout. CI builds both images on every push but does not publish them; publishing them to a registry would let a 2 GB server pull rather than build.
