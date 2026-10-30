# ADR-0067: Authentication: Signed Tokens, Agents Acting for People, and the Loopback Boundary

> **In brief.** This decision answers: how does a hub know a request really comes from the person
> or tool it names, once tools write from other machines? A person signs in with their
> institution or another standard identity provider and sends a signed token; the hub checks the
> signature and resolves the token to a `User`, as it already resolves today's trusted header. An
> AI tool working for someone writes under its own name, and the hub records whom it acted for. A
> service that delivers someone's earlier work, such as CoQui's outbox, may do so only if an
> administrator has allowed it, and the hub records the service as the carrier. A hub running on
> someone's own computer also refuses web pages the person has not allowed. Accepted on
> 2026-10-30; of its ten decisions only the last part, the refusal of unexpected host names and
> web pages, is built.

## Status

Accepted (2026-10-30, with ADR-0065 and ADR-0068; Amos's decision after the alignment review of
that day). Proposed 2026-10-29. Built so far: decision 7 only (the note below); the rest follows
`docs/workspace-hub-plan.md` §14 (decisions 3, 6 and 8 before the workspace hub's push, the others
before its release), each part with the verification §Verification names. The open questions
below stand with their recommendations. The dated notes this Status promised are on ADR-0015,
ADR-0025, ADR-0032, ADR-0059 and ADR-0065 (2026-10-30).

**Note 2026-10-30, built:** decision 7 is built, ahead of the rest as recommended:
`app/lib/api/boundary.ts`, the first middleware on every request, with `boundary.test.ts` and a
raw-socket case in `hub.test.ts`; the compose file sets `ARMATURE_ALLOWED_HOSTS=hub`; contract
revision 2026-10-30. Building it corrected the Context and refined the decision (the notes
beside each).

**Note 2026-10-30:** a prerequisite of the workspace hub (ADR-0065). Decision 7 is built first;
decisions 3, 6 and 8, with the client's `agent` option, before the workspace hub's push; the rest
(decisions 1, 2, 4, 5 and 9) before its release (`docs/workspace-hub-plan.md` §14).

**Note 2026-10-30, decided:** an agent's own work reaches a remote only through a workspace hub's
push, acting for the workspace's owner; a service credential alone grants reads (decision 10, with
the reasons and what would reopen it). The MCP server's remote mode is therefore read-only
(`docs/mcp-server-plan.md` §13, question 13). A relay (decision 5) is unaffected: it writes a
person's own earlier work with the person as author.

Written with ADR-0068 (authorization), which says what a resolved identity may do; this record
says how the identity is established and what the hub records about it. The trigger is What's
Next item 3 in `.claude/SESSION.md`: a writing client that runs somewhere other than the hub's
server (Quiver on a second machine, the MCP server's remote mode, the Storyline bridge on a
designer's Windows machine, and a workspace hub's push, ADR-0065). Adopts the delegation half of
research candidate 0025 (`docs/research/adr-candidates.md`: an `On-behalf-of:` trailer, after W3C
PROV-O's `actedOnBehalfOf`). On acceptance it would amend or annotate:

- **ADR-0032 decision 1**, whose `oidc` resolver it specifies, and whose `header` resolver it
  bounds (decisions 6 and 7 below).
- **ADR-0032 decision 7**, where "acting on someone's behalf is not modelled": it becomes
  modelled (decision 3).
- **ADR-0025 decision 2**, which reserves trailers and defines none: decision 5 defines the first
  ones the hub writes itself.
- **ADR-0059 decisions 4 and 6**, whose discovery document gains the issuer and the headers a
  client sends (decision 9).
- *Added 2026-10-30 by the alignment review:* **ADR-0015**, whose "Armature does not manage
  passwords, sessions, or tokens" becomes "issues none and verifies tokens" (decision 1).
- **ADR-0065 decision 7**, whose refusal of agent writes this replaces, with ADR-0068.

**Recommended ahead of acceptance (2026-10-29):** decision 7, the `Host` and `Origin` checks,
built on its own before the rest of this record. It closes an exposure that exists today on any
machine running a hub beside a browser, it changes nothing a client sends (Quiver, the viewer and
the scripts send no `Origin`, and call the hub by a name the check allows), and it depends on no
other decision here. Because it adds `ARMATURE_ALLOWED_HOSTS` to the compose file, its pull
request gets the fresh-VM rehearsal CLAUDE.md requires of a change to how an instance runs.

## Context

The hub resolves identity and never authenticates (ADR-0032 decision 1). Its one built resolver,
`header`, trusts whatever `Armature-User` a caller sends, so every deployment keeps the hub on
loopback or on a private network (`docs/deployment.md`, "Who can do what"). That holds while
every writing client runs beside the hub. It stops holding with the first writing client
elsewhere, and four are now planned.

**Agents.** An agent is an ordinary `User` whose `externalId` begins with `agent:`, registered by
a person, writing under its own id (ADR-0032 decision 7). Quiver built two (2026-10-28): its
drafter, `agent:quiver/drafter`, proposes items and parts, and its lint agent,
`agent:quiver/lint-1`, can record findings. Quiver pushes their commits by sending the agent's id
in `Armature-User` (`src/lib/sync/push.ts`), which works only because the header is trusted.
Nothing records which person the agent worked for, so two people's drafters are one `User` and
their work is indistinguishable. The MCP server plan writes notes and findings as an agent too
(`docs/mcp-server-plan.md`).

**Work delivered later.** CoQui queues a reviewer's decisions in an outbox that drains when no
reviewer is present. The decision is the reviewer's, and an `Attestation`'s `attestedBy` must be
the resolved identity (constraint 15), so the drain must write as the reviewer, not as a service.

**Who may name whom.** On any write the hub can verify only the caller's credential; whatever a
request says about anyone else is a claim. If any registered `User` could be named as a commit's
author, one credential could put a verdict or a finding in another person's name, which constraint
15 and ADR-0032 decision 4 exist to prevent. For an agent the risk is different: an agent has no
consent to violate, and naming the person it worked for is enough to keep the record honest
(discussed 2026-10-29).

**Browsers.** A hub on someone's own machine (a developer's `npm run start:hub`, a workspace hub)
shares the machine with a web browser, and a web page can send requests to `localhost`. The hub
has no CORS (cross-origin resource sharing) code, and every write carries the custom
`Armature-User` header, so a browser asks the hub's permission first and is refused: ordinary
cross-site writes are blocked today. DNS (Domain Name System) rebinding is not: a hostile page
points its own domain at `127.0.0.1`, the browser treats the hub as the page's own site, and no
permission is asked. The defense is to refuse requests whose `Host` header names anything the hub
does not expect. The hub does not check it. Inside the compose network the viewer and a client
beside the instance call the hub as `http://hub:3100` (`docker/docker-compose.yml`), so the names
it expects are configurable, not only `localhost`. Quiver calls the hub through Tauri's HTTP
plugin, outside the browser engine, so an origin rule does not touch it.

> **Later change (2026-10-30):** the last sentence is wrong. Tauri's HTTP plugin adds an `Origin`
> header to every request, its webview's origin (`tauri://localhost` on macOS and Linux, a
> loopback URL in development; `tauri-plugin-http` 2.8.3, `src/commands.rs`), unless built with
> its `unsafe-headers` feature, which Quiver does not use. Decision 7 therefore serves such
> origins (the note there).

## Decision

1. **The `oidc` resolver verifies a signed token.** A request carries `Authorization: Bearer
   <token>`, a JSON Web Token (JWT) the hub verifies with the `jose` library against the issuer's
   published keys (its JWKS, JSON Web Key Set), checking `iss`, `aud`, `exp` and `nbf` against
   `ARMATURE_OIDC_ISSUER` and `ARMATURE_OIDC_AUDIENCE`, and the algorithm against an allow-list
   (`RS256`, `ES256`, `EdDSA`). A person's token resolves by `sub` as the `externalId`; first
   encounter registers a `User` when the token carries `name` (ADR-0032 decision 3, already
   built). One issuer per instance. Under `oidc` every request needs a token, reads included; a
   service that only reads, such as the viewer, holds its own (decision 4). The one exception is
   `GET /discover`, which stays open as it is today (ADR-0059): it says how to authenticate, so a
   client must be able to read it before it can sign in.

2. **A native client signs in as the person.** The workspace hub, Quiver and the Storyline bridge
   use the authorization code flow with PKCE (Proof Key for Code Exchange) and a loopback redirect,
   the standard for native applications (RFC 8252), and keep the refresh token in the operating
   system's keychain, so a push after a week offline needs no new sign-in.

3. **An agent acting for a person writes under its own name, and the hub records the person.** A
   request carries the person's credential and `Armature-Agent: <agent externalId>`. The hub
   resolves the person, then the agent, which must be a registered agent `User` (any agent,
   whoever registered it); the agent is the commit's author and the `createdBy` of what it
   creates, and the hub appends `Armature-On-Behalf-Of: <person externalId>` to the commit
   message. Whether the person may do the write is decided for the person (ADR-0068). This is
   what tells two people's drafters apart: one agent `User` per tool is enough, since the trailer
   names the person.

   > **Later change (2026-10-30):** on a remote hub this request is made by a workspace hub's
   > push, which holds the owner's credential and replays the agent's local commits with
   > `Armature-Agent` (ADR-0065 decisions 5 and 7). A tool on a person's machine makes it to the
   > workspace hub, under `header`. Decision 10 says why a remote takes an agent's own work no
   > other way.

4. **A service authenticates as itself.** A program running with no person present, such as an
   importer or the viewer, holds its own credentials from the identity provider (the OAuth client
   credentials grant). The resolver maps such a token, which names a client rather than a person,
   to the agent `User` whose `externalId` is `agent:` followed by the token's client id; that
   `User` is registered by a person as any agent is.

   > **Later change (2026-10-30):** a service credential grants reads. A write under it alone,
   > the service's own work with no person present, is refused with 403 `forbidden` (ADR-0068);
   > a service writes a person's earlier work only under a `Relay` grant (decision 5), and an
   > agent's own work reaches a remote only through a workspace hub (decision 10).

5. **A service may relay a person's earlier work only if it holds a relay grant.** A service whose
   agent `User` holds an active `Relay` grant (ADR-0068) may send `Armature-User: <person>` with
   its own token; the person is the author, `createdBy` and, for an attestation, `attestedBy`,
   and the hub appends `Armature-Relayed-By: <agent externalId>`. It is the one case in which a
   name other than the caller's is written as an author, and it needs an administrator's grant,
   recorded on `main` with a reason. This replaces stored refresh tokens, which would put every
   reviewer's long-lived credential in a queue.

6. **The hub writes some trailers itself and refuses them from clients.** `Armature-On-Behalf-Of`
   and `Armature-Relayed-By` are written only by the hub; a request whose message already has a
   line beginning with either is refused with 400 `reserved_trailer`. Every other trailer is the
   caller's claim, recorded as sent: the workspace trailers of ADR-0065 decision 5, and
   `Co-Authored-By: <name>` for someone who contributed without signing in, such as a
   subject-matter expert dictating beside the designer. `docs/api.md` and `docs/research-path.md`
   will say which trailers the hub vouches for and which are claims, when the first trailer is
   built (the alignment review of 2026-10-30 found neither mentions trailers yet).

7. **Every hub checks `Host` and `Origin`.** A request whose `Host` is not `localhost`,
   `127.0.0.1` or `[::1]` (any port), or a name in `ARMATURE_ALLOWED_HOSTS`, is refused with 403
   `host_not_allowed`; the compose file sets `hub`. A request carrying an `Origin` header, which
   browsers send and other tools do not, is refused with 403 `origin_not_allowed` unless the
   origin is in `ARMATURE_ALLOWED_ORIGINS`, empty by default; the hub answers CORS only for
   origins on that list. Refusing on the server stops the write itself, not only the browser
   reading the answer. On a workspace hub the workspace manager edits the list, so a person can
   allow a web tool they use ("coqui.example.org wants to use your workspaces") and a page they
   did not allow cannot write as them. The checks run first, before identity is resolved, as
   middleware beside `negotiate` (ADR-0059), so a refused request reaches no route. This decision
   stands alone and is recommended to be built first (Status).

   > **Later change (2026-10-30, as built):** the origin rule refuses `null` and remote web
   > origins (`http` or `https` on a name that is not a loopback one) unless listed, and serves
   > the rest without CORS answers: loopback origins, which are pages served from this machine,
   > and non-web schemes such as `tauri://localhost`, a desktop shell, both local programs the
   > `header` resolver already trusts and neither forgeable by a web page. Names under
   > `.localhost` count as loopback for both checks (RFC 6761). A listed origin's responses carry
   > `Access-Control-Allow-Origin` and expose `ETag` and `Armature-Version`, refusals included;
   > its preflights answer 204. The setting is read on each request.

8. **`header` stays, bounded.** The `header` resolver remains the default for development, tests,
   a workspace hub's loopback and a private compose network, and reads `Armature-Agent` as
   `oidc` does. A hub under `header` refuses to start on an address other than loopback unless
   `ARMATURE_TRUST_NETWORK=1` says the network is the gate, as the compose file's private network
   is. A request naming an agent directly in `Armature-User`, Quiver's form today, is accepted
   under `header` with no `Armature-On-Behalf-Of`, until clients move; `docs/client-changes.md`
   records the move.

   > **Note (2026-10-30):** the hub image binds `0.0.0.0` by default (`docker/hub.Dockerfile`),
   > and CI's images job runs it with no environment, so when this decision is built the compose
   > file's `hub` service and that CI step set `ARMATURE_TRUST_NETWORK=1`, not the Dockerfile, so
   > that an image run anywhere else still refuses; the change to the compose file gets the
   > fresh-VM rehearsal (CLAUDE.md, Branches item 5).

9. **Discovery says how to authenticate.** `GET /discover` names the resolver, the issuer and
   audience under `oidc`, and the headers a client may send (`Armature-Agent`, and
   `Armature-User` for a relay), in a top-level `identity` entry beside `versions`, `capabilities`
   and `schema` (ADR-0059 decision 6; the entry's name added 2026-10-30). `@armature/client` gains a `token` option and an `agent` option,
   and the change is a dated contract revision (ADR-0059). For native programs it also names the
   client id they sign in with, which with the issuer and audience is what the workspace hub's
   connection profile carries (`docs/workspace-hub-plan.md` §16, question 12).

10. **An agent's own work reaches a remote only through a workspace hub** (added 2026-10-30). A
    remote hub refuses a write whose author would be an agent unless it arrives as a workspace
    hub's push acting for the workspace's owner (decision 3's form, with the owner's credential),
    answering 403 `forbidden` otherwise; a service's own credential (decision 4) reads. Agents
    therefore write on a person's workspace hub, in that person's workspace, and their work
    enters shared history by that person's push and a maintainer's merge (ADR-0068 decision 4).

    *Why.* Three reasons, in order of weight. First, the record: a remote can write
    `Armature-On-Behalf-Of` only when the person's credential is on the request, and a program
    running with no person present cannot carry one (the MCP specification forbids a server
    passing the assistant user's token through to another service; a scheduled job has no
    person at all), so an agent writing directly would be work with no one answerable for it.
    Second, the boundary: the workspace hub is where a person's work is made and reviewed before
    it is shared, and an agent's proposals belong beside the person's own drafts, visible to
    every tool on that machine and delivered by the person's push, not by a second path into the
    remote. Third, authority: ADR-0068 keeps `main` behind a maintainer's merge; an agent that
    could write straight to a remote would be one grant away from writing to `main`, where an
    agent confined to workspace hubs can never be.

    *What would reopen it.* A client that demonstrates a need for an agent to write to a remote
    with no workspace hub in its path, **and** a way for the hub to know whom the agent works for
    that it can verify rather than take as a claim. Two forms are imaginable: a token the
    identity provider issues to the agent that carries the person's identity as a verified claim
    (OAuth's token exchange, RFC 8693, is the standard shape), or a grant from the person naming
    the agent as acting for them, recorded on `main` like a `Relay` grant but with the agent as
    author and the person in the trailer. Either would be an amendment here and a new row in
    ADR-0068's table; the two-client test applies (Development Principle 6). A hosted assistant
    that only reads needs none of this and is served today under decision 4.

## Alternatives considered

- **An authenticating proxy in front of the hub** (for example oauth2-proxy setting
  `Armature-User`). Usable as a deployment of the `header` resolver behind a trusted network, and
  not excluded. Not chosen as the mechanism: agents, relays and the on-behalf-of record need
  claims the hub itself sees and checks.
- **Static API keys per person.** Simpler for scripts. Rejected: the hub would issue and store
  secrets, which ADR-0015 leaves to the identity provider.
- **Stored refresh tokens for CoQui's outbox.** Rejected (sketched 2026-10-25): every reviewer's
  long-lived credential in a queue, where a relay grant names one service and can be revoked.
- **Any registered `User` may be named as an author.** Rejected: one credential could write
  verdicts and findings in another person's name, which constraint 15 prevents.
- **Only agents the caller registered may act for the caller.** Rejected (2026-10-29): it ties an
  agent's use to who happened to register it, an administrator's shared registration or a
  colleague's, and adds nothing the on-behalf-of record does not already give.
- **One agent `User` per person and tool** (`agent:quiver/drafter` for each person). Not needed:
  the trailer names the person, so one agent per tool keeps the registry small.
- **Mutual TLS (Transport Layer Security) between tools and the hub.** Rejected for now: a
  certificate per tool is heavier than a token, and no client has asked.
- **An agent writing to a remote directly, as the agent alone** (the MCP server plan's remote
  mode as first drafted). Rejected 2026-10-30 (decision 10): the remote cannot record whom the
  agent worked for, since no person's credential is on the request; the work would enter shared
  history outside any person's workspace; and an agent with a remote write path is one grant from
  `main`. A hosted assistant reads under decision 4 instead.

## Open questions

1. **Several issuers on one instance**, for a study that spans institutions: `externalId` as
   `sub` qualified by `iss`, which would need existing `User`s migrated. *Recommendation:* one
   issuer until a study needs two; CILogon, which federates research institutions behind one
   issuer, may make that rare.
2. **The provider for a hosted demonstration.** *Recommendation:* CILogon for institutional
   research logins; a hosted provider otherwise; the ADR names none, since any standard issuer
   works.
3. **Revocation.** A token is valid until it expires; short lifetimes (minutes) with refresh are
   the usual answer, and a revoked person's refresh fails at the provider. *Recommendation:*
   rely on the provider; no hub-side deny list until one is needed.

## Verification

None yet. Before acceptance: a contract test with a signing key and a JWKS fixture served
in-process (a valid token, a wrong audience, an expired token, a disallowed algorithm); a test
that a request with `Host: attacker.example` and one with an unlisted `Origin` are refused before
any route runs; a test that `Armature-On-Behalf-Of` in a client's message is refused and the
hub's own trailer is returned byte for byte by the history route; and a rehearsal of the compose
file with `ARMATURE_ALLOWED_HOSTS` on a fresh VM (CLAUDE.md, Branches item 5), since it changes
how an instance runs.

## Consequences

- A writing client can run anywhere, and the hub can be reached beyond its server once
  authorization (ADR-0068) is in place.
- Agent work records the person it was done for, so a study reading process data
  (`docs/research-path.md`) gains the distinction PROV-O draws between who did something and on
  whose behalf. The hub itself offers no list of commits filtered by author or by the trailer:
  ADR-0021's refusal of person-scoped enumeration holds for commit messages as for documents, and
  the trailer is read in an export or a history the reader already holds (reworded 2026-10-30;
  it first said "a read of commit messages").
- A relayed write is visible as relayed, and only services an administrator named can make one.
- Quiver changes how it pushes agent commits (`Armature-Agent` with the person's credential); the
  old form keeps working under `header` until it moves.
- Every hub refuses unexpected `Host` and `Origin` values, which also closes the DNS rebinding
  route on a developer's machine running the hub today.
- The viewer needs its own credentials once its hub runs under `oidc`; its readers still sign in
  to nothing.
