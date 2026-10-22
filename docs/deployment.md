# Running an Armature instance

This document is for the administrator who stands up an Armature instance on a machine: what runs, what is reachable by whom, the steps, and what is deliberately not there yet. It describes the deployment as built on 2026-10-21 (Phase 7), rehearsed the same day on a fresh Ubuntu 24.04 virtual machine (VM) and then run on a DigitalOcean Droplet at a real domain (§ "A hosted instance"). The commands are the ones in `docker/docker-compose.yml`; the reasons are in the Architecture Decision Records (ADRs) cited.

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
- **Operators on the server** reach the hub on loopback (`curl http://127.0.0.1:3100/api/v1/discover`, a client run on the server) and the store on loopback with its password. This is where the schema and data are loaded, users registered, and repairs made (see "Repair").
- **Nobody else** reaches the hub or the store. The hub's identity resolver, `header`, trusts whatever `Armature-User` a request claims (ADR-0032), so a hub reachable from beyond the server would let anyone write as anyone. The loopback binding is the gate until an authenticating resolver (`oidc`, named and not built) or an authenticating proxy exists. Anything else placed on the private network can write to the hub; keep that network to these containers.

Set `TERMINUSDB_ADMIN_PASS` on any server that is not a laptop, in `docker/.env` (step 1). The compose default, `admin`, is for development only, and the hub and the operator scripts take the same value for their own connections.

## The steps

The server needs Docker with the Compose plugin and a checkout of this repository, nothing else: no Node.js, since the images and the operator scripts bring their own.

1. **Prepare the server.** On Ubuntu 24.04: `sudo apt-get install -y docker.io docker-compose-v2`. Run the instance as an ordinary user in the `docker` group rather than as root (a fresh Droplet logs you in as root: `adduser --disabled-password --gecos "" armature`, `usermod -aG docker armature`, and copy `/root/.ssh/authorized_keys` into `/home/armature/.ssh/`); a user added to the group must log in again before it applies. As that user, clone the repository and write the instance's settings to `docker/.env`, readable by that user only:
   ```
   cd armature/docker
   (umask 077; printf 'TERMINUSDB_ADMIN_PASS=%s\nARMATURE_SITE=%s\n' "$(openssl rand -hex 16)" armature.example.org > .env)
   ```
   Compose reads `docker/.env` on every command run in `docker/`, and Git ignores it (`.env*`). Keep the settings there rather than on the command line: a later `up` without them would recreate the hub with the development password, which the store refuses, and Caddy with the site `localhost`.
2. **Bring up the containers.** In `docker/`: `docker compose --profile public up -d --build` (or `--profile hub` for an instance only the server itself reads, or before the domain resolves; see "The address" below). The hub and the viewer start before the store is ready; every request opens its own connection, so the hub answers 500 until the store is up and the viewer shows an error page until then.
3. **Load the schema and the data** through the `operator` service, which runs the scripts in a throwaway Node 22 container on the private network, so the store keeps its loopback binding. In `docker/` (the password comes from `docker/.env`):
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
5. **Point clients at it.** The viewer already is. A writing client such as CoQui needs the hub's address, which today means running it on the server or widening `ARMATURE_HUB_BIND` behind a proxy that authenticates and sets `Armature-User` itself.

Optional: `ARMATURE_HUB_PUBLIC_URL` gives the viewer an address a reader's browser can follow for the raw-data links in page footers; unset, the links are omitted and the hub stays private. `ARMATURE_EXPORT_KEY` makes pseudonymous exports stable across runs (ADR-0031).

## Repair

A few states can be reached through the API and not left through it: an identifier written under the wrong type, a user with a typo, a record that predates a rule, a branch a crashed test left behind (ADR-0062). The operator tools repair them from the hub's container, where the store's credentials already are, and every repair is a new commit with an author and a reason; history is never rewritten. In `docker/`:

- `docker compose exec hub node operator.mjs check` reports every rule the data on `main` breaks, in the shape the API's 422 uses. `--branch <name>` or `--commit <id>` checks another state, `--json` prints it for a program. It writes nothing and exits 1 when it finds something. Run it after every repair.
- `docker compose exec hub node operator.mjs delete <id> --branch <name> --as <externalId> --reason "<why>"` deletes one document as a commit by that registered user. The store refuses to delete a document another one references; the deleted document stays readable at the commit before, which the tool prints.
- `docker compose exec -T hub node operator.mjs put - --branch <name> --as <externalId> --reason "<why>" < fix.json` writes one document, or an array of them, through the same pipeline and rules as the API. A user's email is corrected this way on `main`. `--unchecked` skips the hub's rules, never the store's, for a repair that needs an intermediate state the rules refuse; the commit message says the rules were skipped, and `check` should run straight after.
- `docker compose exec hub node operator.mjs delete --scratch-branch <name>` deletes a branch whose name starts with `test-`, `warmup-`, `anon-` or `future-`. A branch holding design work is never deleted; give it a name that marks it as abandoned instead.

`--as` names the operator's own `User`, registered like anyone else (step 4); the same person may be a designer on one commit and an operator on the next, and the message says which. On a laptop, `npm run operator --workspace app -- check` builds and runs the same tools with `app/.env.local`.

## A hosted instance

What a server on the internet adds to the steps above, and what was measured on 2026-10-21: first in a rehearsal on a local Ubuntu 24.04 VM (Lima, 2 virtual CPUs, 4 GB), then on a DigitalOcean Droplet (`s-2vcpu-4gb`, region `nyc3`) serving `armature.amosglenn.com`, which was verified from outside and then destroyed by choice (§ "The DigitalOcean run").

**The machine.** Two shared virtual CPUs, 4 GB of memory, 40 GB of disk, a public IPv4 address, either architecture (the TerminusDB and Node images are published for amd64 and arm64). Running, the three Armature containers used about 375 MiB with the seed (the store 292 MiB, the hub 38, the viewer 43). Building the images on the server is the peak: 1.65 GB for the whole machine in the rehearsal (39 seconds on an Apple-silicon VM) and 1.67 GB on the Droplet (104 seconds on its shared x86 CPUs). A 2 GB machine therefore needs a swap file or images built elsewhere; 4 GB builds in place.

**The address.** `ARMATURE_SITE` is the domain Caddy answers for. Give it an `A` record (not a `CNAME`, which names another name; a Droplet has only an address) pointing at the server, and keep ports 80 and 443 open, because Let's Encrypt checks the domain through them before issuing the certificate. Start Caddy only once the record answers at the domain's own nameserver (`dig +short <the domain> @<one of its NS records>`): until then run step 2 with `--profile hub` and do step 3, then run step 2 with `--profile public`. A request for a certificate made before the name resolves fails, and repeated failures are rate-limited. Avoid querying a public resolver (1.1.1.1, 8.8.8.8) for the name before the record exists: it caches the "no such name" for the zone's negative-caching time, which delays your own checks, though not Let's Encrypt's. On the Droplet, whose domain's DNS is at GoDaddy, the certificate came on the first attempt. Caddy keeps the certificate in the `caddy-data` volume and renews it itself; a `CAA` record on the domain, if there is one, must allow Let's Encrypt. `ARMATURE_SITE=:80` serves plain HTTP on any address, for a rehearsal without a domain.

**The firewall.** Use the provider's firewall, which sits outside the machine, allowing 22, 80 and 443 only. A firewall on the machine (Ubuntu's `ufw`) does not cover containers: Docker writes its own packet-filter rules for every published port ahead of `ufw`'s, so a port published on every interface is reachable whatever `ufw` says (verified in the rehearsal with a probe container on 8080). This is why the compose file binds every port but Caddy's to loopback; widening one of the `*_BIND` variables on a hosted server publishes it to the internet. On the Droplet both layers held: from outside, 3000, 3100 and 6363 timed out (the provider's firewall drops them before the machine sees them), `http://` answered 308 to `https://`, and `/api/v1/discover` at the public address was the viewer's 404.

**Reboots and updates.** The restart policy brings all four containers back after a reboot (verified: on the VM a user registered before the reboot was still there; on the Droplet the coverage page answered over HTTPS about 26 seconds after the reboot command, with the stored certificate and no new request to Let's Encrypt). To update: `git pull`, then step 2 again; Docker rebuilds what changed and replaces those containers, with the settings from `docker/.env` (on the Droplet, an `up` with the file and no variables recreated nothing). A schema change also needs step 3's `load_schema.js` (with `--clear-instances` only for a breaking change, which empties the data first).

**Backups.** The store's data is the `terminusdb-data` volume. Back it up as a volume or a provider snapshot of the machine, or as an export at a commit (`GET /api/v1/export` on loopback), which reloads with step 3.

**Showing a laptop or a rehearsal instance without a server.** `cloudflared tunnel --url http://<the viewer or Caddy's address>` prints a temporary public HTTPS address under `trycloudflare.com`, with no account, for as long as the command runs. It forwards one port outward, so pointing it at the viewer or at Caddy publishes nothing else. Such tunnels carry no uptime guarantee; in the rehearsal one attempt failed to register over QUIC and `--protocol http2 --edge-ip-version 4` worked.

### The DigitalOcean run

How the Droplet of 2026-10-21 was made, for whoever stands one up again. It was driven from a laptop with `doctl`, DigitalOcean's command-line tool, and an API token that never touched a file:

- **The token** was scoped to what the run needs (`droplet:create`, `droplet:read`, `droplet:delete`, `actions:read`, `image:read`, `sizes:read`, `regions:read`, `ssh_key:read`, `firewall:create`, `firewall:read`, `firewall:update`, `firewall:delete`, `account:read`), with the shortest expiry offered, and kept in the macOS Keychain (`security add-generic-password -a "$USER" -s digitalocean-armature -w`, which prompts for the value). Each command read it inline: `DIGITALOCEAN_ACCESS_TOKEN="$(security find-generic-password -s digitalocean-armature -w)" doctl …`. `doctl auth init` was not used, since it saves the token in doctl's configuration file. The token cannot upload an SSH key (`ssh_key:read` only), so the key is added in the control panel.
- **The Droplet:** `doctl compute droplet create armature-demo --region nyc3 --size s-2vcpu-4gb --image ubuntu-24-04-x64 --ssh-keys <key id> --tag-name armature --wait`. It is billed per second from creation to deletion, $0.0357 an hour at this size; a powered-off Droplet still bills.
- **The firewall,** attached by tag: `doctl compute firewall create --name armature-demo --tag-names armature --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:80,… protocol:tcp,ports:443,… protocol:udp,ports:443,…" --outbound-rules "protocol:tcp,ports:all,… protocol:udp,ports:all,… protocol:icmp,…"` (UDP 443 is HTTP/3).
- **Then** steps 1 to 3 over SSH, as root for the packages and the user, as `armature` for the rest; "The address" for the record; the checks from outside as listed above. Ubuntu's DigitalOcean image already refuses password logins and runs unattended security upgrades.
- **Removal:** `doctl compute droplet delete <id>`, `doctl compute firewall delete <id>`, the `A` record at the registrar, and the address's entry in `~/.ssh/known_hosts` (`ssh-keygen -R <address>`), since the address goes to someone else.

## Several projects

Decide what a project must keep separate (`docs/schema-guide.md` Part I says the same from a tool's side):

- **Projects that share people and history** can be `Course` documents in one store: one hub, one `User` registry, branches named per project. The coverage read takes `?course=`. Export slices are by class, not by course, so an export of such a store carries every course in it.
- **Projects that must not see each other**, and a study that wants a clean export per course (`research-path.md` §1), are separate stores. The one TerminusDB container holds them all; each needs its own hub, which is the `hub` service again with a different `TERMINUS_DB` and port. A second compose project gives a project its own store server as well. Whether one store should hold a course, a program or an institution is an open question of the plan (§6, "Project boundaries"); the mechanics above are the same whichever way it is answered.

A hub that serves several stores from one process is not built; until a deployment has more than a few, one hub container per store is simpler to reason about and to secure.

## Development on a laptop

`docker compose up -d` without a profile runs the store only. The hub then runs on the machine (`npm run build:hub && npm run start:hub` in `app/`, reading `app/.env.local`) and the viewer with `npm run dev`, pointed at it by `ARMATURE_HUB_URL` (default `http://localhost:3100`). The contract suite runs the API in-process against the store and never needs the hub or the viewer containers. `docker compose --profile hub up -d --build` runs the whole instance on loopback (the viewer at `http://localhost:3000`); `docker compose --profile hub rm -sf hub viewer` removes those two and leaves the store.

## What is not there yet

- **Authentication.** The `header` resolver trusts the caller; `oidc` is the named next resolver (ADR-0032). Until it exists, writes happen on the server or behind an authenticating proxy. Caddy is where such a proxy would sit (it can ask an identity provider before forwarding and set the header itself); that is not configured.
- **An administrator's page.** Loading, repair and user edits are terminal commands with the store's password: the scripts, and the three operator tools of ADR-0062 in the hub's container (see "Repair"). A page over them would need authentication first and evidence of what administrators actually do, which the first deployment off a laptop is expected to provide (plan §6).
- **A standing hosted instance.** One ran on a DigitalOcean Droplet on 2026-10-21, was verified from outside and was destroyed by choice; none is running. Standing one up again is the steps above; at the size used it costs $24 a month.
- **Images built elsewhere.** The server builds its own images from the checkout. CI builds both images on every push but does not publish them; publishing them to a registry would let a 2 GB server pull rather than build.
