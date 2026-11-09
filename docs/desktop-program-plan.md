# The desktop program: plan

*Status: draft 2026-11-05, for review; the questions in §15 each have a recommendation the plan is written to, and five are decided the same day (Amos): the shell is Tauri 2 over the hub on a Node sidecar (question 1), the program lives in this repository (3), the local token is kept across starts (4), the first builds carry the updater's signature only (12), and the shell and its channel get ADR-0069 after the spike (13). Step 1, the spike, is done (2026-11-05 and 06, on four machines; §5); ADR-0069 is accepted with it, and ADR-0065 decision 7 carries the note on the kept token. Step 2, the hub's side, is built (2026-11-06), step 3, the core, on 2026-11-07, and step 4's two parts, the shell and its pages, that evening and night, rehearsed on the Mac against officepi (§14). Step 5's program side and workflow are built (2026-11-08), the Droplet run their acceptance. The program is step 7 of `docs/workspace-hub-plan.md` §14, the first release candidate of the workspace hub (its §16, question 1, decided 2026-10-30), and the last piece of ADR-0067 (decision 2, the program's own sign-in). When the program exists, this document becomes its description here.*

Abbreviations: ADR (Architecture Decision Record, `schema/docs/adr/`), API (application programming interface), CI (continuous integration), HTTP (Hypertext Transfer Protocol), JSON (JavaScript Object Notation), OIDC (OpenID Connect), PKCE (Proof Key for Code Exchange), URL (Uniform Resource Locator).

---

## 1. Purpose

The desktop program is the host of a workspace hub on a person's machine: the thing a designer installs so that Quiver, the MCP server, the Storyline bridge and any other local tool share one workspace hub on loopback, with workspaces cloned from one remote and pushed back through its API (ADR-0065). Today that host is `app/server.ts` run by hand, or the `workspace` compose profile, which needs a container runtime and a terminal; both are for developers and researchers (`docs/deployment.md`, "A workspace hub on this machine"). The program replaces neither; it is the third path of the workspace hub plan's §10, the only one in which installing Armature is the whole install, and the only one at all on Windows without a container.

What it must do, all of it already decided and waiting for the program (SESSION.md item 17; ADR-0065 decision 7, ADR-0067 decision 2, the plan's §16 questions 1 and 12, item 23):

1. **Run the workspace hub** over the file-backed store (ADR-0066), on a known loopback port, for as long as the program runs, and stop it cleanly.
2. **Sign the person in** to the remote with the authorization code flow with PKCE and a loopback redirect, keep the refresh token in the operating system's keychain, and supply the hub's `remoteToken` with a current access token on every call, so a push after a week offline needs no new sign-in (ADR-0067 decision 2).
3. **Push, bring in and deliver as its own actions**, calling the hub's modules in-process, so that no tool, launched or paired, can move work to the remote (ADR-0065 decision 7, note of 2026-10-30). The routes that stand in for them today (`ARMATURE_WORKSPACE_ACTIONS=routes`) are not served by the program's hub.
4. **Hold the local secret** every write to the hub carries as `Armature-Local-Token`, hand it to the tools it launches as `ARMATURE_LOCAL_TOKEN`, and show it on a pairing screen for a tool it did not launch (the same note; `app/lib/api/localToken.ts`).
5. **Connect to the right remote** from a connection profile the remote publishes in `GET /discover` or from an `armature://connect` link, confirming the instance's name and issuer with the person before signing in (plan §16 question 12; item 23).
6. **Choose the folder** the workspaces live in, outside synced directories by default, and warn when a chosen folder is inside one (ADR-0066, the notes of 2026-11-03).
7. **Update itself** from a signed release channel the profile names, and say when the remote is ahead of the hub it carries (the `unsupported_version` refusal seen on 2026-11-03).

Constraints from the rest of the project, which hold throughout:

- **The hub stays host-neutral.** Nothing under `app/lib/api/` learns about the program. The program is a host like `app/server.ts`: it gives the hub a `HubConfig` (`config.ts`), a folder (`lib/workspaceFolder.ts`), a token source (`hub.remoteToken`) and a local token, and calls the workspace modules the routes call (`workspace/push.ts`, `bringIn.ts`). Anything the program seems to need from the API is a hub change in its own pull request, with a contract revision when a client would see it (ADR-0059).
- **The program is not a tool.** It holds no item editor, no bank, no review; those are Quiver's, CoQui's and the MCP server's (Development Principle 5). Its screens are the workspace cycle and the machine's settings, nothing a plugin would build.
- **The workspace hub authorizes nothing** (ADR-0068 decision 9). The program shows the remote's refusals and warnings; it does not decide who may write.
- **The clone's slice stays `full`** until plan §16 question 4 is decided.

---

## 2. What comparable programs settled

Four patterns the plan borrows and one it declines.

**A daemon with a thin interface over a local channel.** Tailscale runs a background service that holds the state and the credentials, and a menu bar or tray program that only talks to it over a local socket. Adopted in shape: the hub and the program's logic run in one Node process (§5, "the core"), and the shell that draws the windows talks to it over a private channel, so the logic is testable without a window and the shell holds little.

**A secret printed at start, carried on every request.** Jupyter prints a token when its server starts and requires it in the URL or a header; a notebook the server opened has it, anyone else pastes it. The hub already does this (ADR-0065 decision 7, note of 2026-11-03); the program moves the printing to a pairing screen (§7).

**Sign-in through the system browser with a loopback redirect.** Git Credential Manager and GitHub's command-line tool open the browser to the provider, receive the code on a loopback port, and keep what they are given in the operating system's keychain; RFC 8252 is the standard for native programs and ADR-0067 decision 2 chose it. Adopted as written (§6).

**A service that keeps running when its window is closed.** Syncthing's tray wrappers and Tailscale both stay in the tray or menu bar, since the service is the point and the window is occasional. Adopted (§9): closing the window hides it; quitting stops the hub.

**Declined: a program that bundles a database server.** Docker Desktop's shape, a virtual machine beside the program, is what the file-backed store was built to avoid (ADR-0066 decision 4; plan §10). The program bundles one runtime and nothing else.

---

## 3. Shape

```
                 a person's machine
┌──────────────────────────────────────────────────────────────────┐
│  the shell (Tauri 2)                                             │
│    windows, tray, the keychain, the armature:// link, updates    │
│        │  JSON lines over the sidecar's stdin and stdout         │
│        ▼                                                         │
│  the core (Node, one bundle: app/desktop.ts)                     │
│    the host of the hub, as app/server.ts is; the sign-in flow;   │
│    push, bring in and deliver in-process; the local token        │
│        │  startHub(config)                                       │
│        ▼                                                         │
│  the workspace hub  /api/v1 on 127.0.0.1:3101  ◀── Quiver, the MCP server,
│    the file-backed store in the program's folder     the Storyline bridge
└──────────────────────────────────────────────────────────────────┘
                 │  HTTPS, the owner's bearer token
                 ▼
     the remote hub  https://api.<site>/api/v1   (ADR-0067 decision 7)
```

Three pieces, each with one job:

- **The shell** is a Tauri 2 program, as Quiver is (its `docs/plan.md` §5.1): a small Rust side and a web interface in the system's webview. It owns what needs the operating system: the windows and the tray, the keychain (the Rust `keyring` crate: Keychain Services on macOS, the Credential Manager on Windows, the Secret Service on Linux), the `armature://` scheme (`tauri-plugin-deep-link` with `tauri-plugin-single-instance`), opening the browser (`tauri-plugin-opener`), the updater (`tauri-plugin-updater`, which Quiver already runs), and starting and stopping the core as a sidecar (`tauri-plugin-shell`). It holds no logic about workspaces, tokens or the hub beyond relaying.
- **The core** is one Node bundle, `app/desktop.ts` built by esbuild as `app/server.ts` and `app/operator.ts` are, run by a Node executable the shell ships beside it (§5). It is the host of the hub, with everything `app/server.ts` does and three things more: the sign-in flow and the token source (§6), the actions in-process (§5), and a control protocol over its standard input and output by which the shell asks and tells (§5). It reads no environment variable the shell does not pass it; its settings come over the channel.
- **The hub** is the API as built, in workspace mode, untouched.

Why a shell at all, rather than the core alone with a web page on loopback (Syncthing's shape): a designer installs a program, not a service with a browser tab; the keychain, the URL scheme, the tray and signed updates are what a shell gives and a Node process cannot without native modules; and Quiver's toolchain is already Tauri. Why not Electron, which has Node built in and would make the core a function call away: §15 question 1 weighs it; the short answer is that the shell's job is small, the core's is where the work is, and the channel between them costs a few hundred lines once.

---

## 4. What the program does

The screens, in the order a person meets them. Each is a page in the shell's webview, calling the shell's commands, which relay to the core.

1. **Connect.** The first screen, and the one an `armature://connect?remote=https://api.<site>` link opens. It takes the remote's address, reads `GET /discover` over HTTPS, and shows the instance's name, its address and its identity provider's issuer for the person to confirm (§8). A remote under `header` is a development arrangement: the screen then asks for the person's identifier instead of signing in, and says so.
2. **Sign in.** Opens the system browser to the provider; the program receives the code on a loopback port, exchanges it, and shows who the remote says the person is (`GET /users/me`), the check the hub already makes before any workspace work (`remote_identity`; ADR-0067 decision 2, note). A person the remote does not know sees the remote's `not_registered` refusal and whom to ask.
3. **Workspaces.** The list from `GET /workspace`, each with its status: local commits, unpushed, snapshots held, the remote's head and whether it moved, reachable or not. Create a workspace (a name, from `main` or another branch) or clone an existing branch; the remote's warning that the owner may not write the branch is shown and the workspace made anyway (ADR-0068 decision 9).
4. **Push, bring in, deliver.** One workspace's page: the unpushed commits with their messages; push; bring in `main` with an optional message; deliver with a required message and the option to delete the workspace; and (*since 2026-11-07, which the first rehearsal found missing*) remove the workspace, confirmed on the page, with nothing left to push, its branch deleted on the remote too when `main` holds its head (ADR-0065 decision 2, later change). Every refusal the remote or the hub gives (`unpushed_commits`, `bring_in_first`, 403 `forbidden` with its reason, a merge's 422 with the violations, 412 when the remote moved) is shown as the hub says it, with the commit. The review itself, what a conflict means for an item, is the tool's (plan §6); the program shows the report and says which tool to open.
5. **Pairing.** The local token, with a copy button, and the sentence a tool's own documentation will repeat: "paste this where the tool asks for its Armature pairing value" (§7). The tools the program launched need nothing.
6. **Settings.** The remote (changeable only when no workspace exists, §9); the folder, with the synced-folder warning; the port; the snapshot budget (`ARMATURE_SNAPSHOTS`); sign out; and the program's version with the hub's contract revision it carries and the remote's.
7. **Log.** The core's output, the last few hundred lines, and where the log file is.

A day's flow: the program is in the tray; Quiver opens and finds the hub on port 3101; the person works; they open the program, see "3 unpushed", push, and later bring in and deliver. Offline, everything but the four remote actions and a forwarded read works, and the status says the remote is unreachable rather than failing.

---

## 5. The hub inside

**The core as a host.** `app/desktop.ts` does what `app/server.ts` does (`configFromEnv` replaced by settings from the channel; `lockFolder`, `openFileStore`, `folderRecords`, `startHub`) and keeps the role `workspace`, the resolver `header` (ADR-0067 decision 8: the owner's identifier is the owner's, and the person is the only one on the machine's loopback), the bind `127.0.0.1`, and `actionRoutes: false` always. The modules under `app/lib/desktop/` hold the rest: the protocol, the sign-in flow, the token source, the settings file, the folder rules. They import from `app/lib/api/` as `server.ts` does and never the other way.

**The actions in-process.** Push is `pushWorkspace(hub, records, record)`, bring in `bringIn(...)` and deliver `deliver(...)`, exactly what `routes/workspace.ts` calls after its own checks; the core calls them when the shell asks, as the workspace's owner (the record's owner is the program's one person). The route-side checks the core must repeat are two: the workspace exists, and the caller is its owner, which on the program is always true. `ARMATURE_WORKSPACE_ACTIONS` stays for the compose profile and the suites, which have no program in front of them (ADR-0065 decision 7, note of 2026-11-03, choice 3); the program never sets it, so its hub says `actions: program` and refuses the routes (§15 question 5).

**The control protocol.** JSON, one object per line, over the sidecar's standard input (shell to core) and standard output (core to shell); a child's pipes are readable by its parent alone, so nothing crosses the network or a file. Every request from the shell carries an `id` the reply repeats; the core also sends events without one (a log line, a token rotated, the hub's state).

| Shell to core | Core to shell |
|---|---|
| `start` with the settings (folder, port, remote, snapshot budget, the identifier under `header`) and the credentials the keychain held (the refresh token; the local token, §7) | `started` with the hub's URL and revision, or `failed` with the message `server.ts` would have printed |
| `profile` with a remote's address | `profile` with what `GET /discover` said, or `unreachable` |
| `signIn` | `open` with the browser URL; then `signedIn` with the person the remote resolved, or `refused` with the hub's code |
| `signOut` | `signedOut` |
| `workspaces`, `status`, `create`, `clone`, `push`, `bringIn`, `deliver` with their bodies | the route's answer, or the `ApiError` as the route would have sent it (status, code, message, fields) |
| `stop` | `stopped`, after the listener closes and the lock is released |
| | `credential` with the new refresh token when the provider rotates it, for the shell to keep (§6); `log` lines |

The shape is deliberately the routes' own: a reply is what `app.request()` would answer, so the suites' expectations apply, and a future tool of the program's own (a command line, a test driver) speaks the same lines.

*As built (2026-11-07, `app/lib/desktop/`; ADR-0069, note of that day):* a request is `{ id, type, ...fields }`, a reply `{ id, status, body }` with the status and body a route would answer (a refusal `{ error, message, ...details }`), an event `{ event, ...fields }`. The table's reply names are carried in the body (`started: true`, `signedIn: true`, `stopped: true`) or are the error codes (`failed` is the refusal with its code: `folder_locked`, `port_in_use`; `unreachable` is 502 `remote_unreachable`; `refused` is 403 `sign_in_refused` or the remote's own). Beside the table's requests: `connect` (the profile read again and recorded in the settings), `settings` (read, or `set`), `resetPairing`, and with the pages `commits` (a workspace's log, for the unpushed commits' messages) and `remove` (`DELETE /workspace/:name`, revision 2026-11-07). `start` also opens the data folder, so a first start before a remote is chosen answers `needs: connect`; `stop` stops the hub and leaves the core running, and the input's end stops both. The events are `log`, `hub` (its state), `open`, `credential` and `signedOut`. *Later the same day, with the shell:* `credential { remote, refreshToken }` is a request too, the shell's alone, sent after `start` (§6). *2026-11-08, after the Keycloak rehearsal (§12):* `toolIdentity` answers `{ user }`, what a paired tool sends as `Armature-User`, for the pairing page (ADR-0069, note of that day).

**The Node executable as the sidecar.** Tauri ships an external binary per target triple and starts it with arguments (`tauri-plugin-shell`'s sidecar). The recommendation (§15 question 2) is the Node binary itself as the sidecar, named `armature-node` (a Linux package installs a sidecar under its own name in `/usr/bin`, where `node` would sit beside the system's), the bundle `desktop.mjs` as a resource beside it, the sidecar started as `armature-node <resources>/desktop.mjs`: the runtime the contract suite runs on, no packaging step beyond esbuild, nothing experimental. Node's single-executable feature (one file, `mainFormat: module` now supported; stability 1.1, active development) is the alternative when one file is wanted. Bun, Deno and `pkg` are runtimes or loaders the suites do not run on, so a hub under them is a hub the tests do not cover; declined. What the shell must not do is put a token in the sidecar's arguments or environment: arguments are readable by other processes on most systems, and the environment by any process of the same user; the channel carries them. On Windows the resource's path reaches Node without the extended-length prefix (`\\?\C:\...`) Tauri resolves it with, which Node cannot load as its entry script (the spike's first Windows run; the `dunce` crate).

**The spike** (done 2026-11-05 and 06; ADR-0069, Verification, holds the full table). A throwaway Tauri shell started Node 22.23.4 as the sidecar with a core hosting the real hub over the file-backed store, and one script measured the installed program on the Mac, GitHub's macOS, Windows and Ubuntu runners, and the Windows laptop. The code is in `main`'s history from `6be705f` to `81014e7` (PR #111), removed by `aa6035d`.

| | macOS | Windows | Linux |
|---|---|---|---|
| What a person downloads | `.dmg` 38 MiB (Node 108 of the 120 MiB app) | installer 24 MiB | `.deb` 47 MiB |
| Launch to a listening hub | 0.3 to 0.8 s; 6.1 s on a fresh machine's first launch | 0.6 to 1.0 s; 1.4 to 9.8 s the first time | 0.25 s |
| `stop` to the core's exit | 7 to 30 ms | 14 to 17 ms | 7 to 9 ms |
| The core, resident | 80 MiB (the shell 109) | 60 MiB | 84 MiB |

What it settled, besides the numbers: the core must stop itself when its standard input closes, since a shell killed outright can do nothing, and with that rule no exit on any machine left a process or a lock (§9); the shell handles SIGTERM itself on macOS and Linux, which the spike's did not; Tauri re-signs the sidecar when the program is signed, and Node needs only the JIT entitlement under the hardened runtime (§10); the program runs only in a signed-in session, since over SSH the webview has no window (§12); and the two path rules above. Not observed: SmartScreen on a double-clicked unsigned installer, a console window beside the shell, closing a Windows window with its X, a Linux desktop outside Xvfb, notarization. *Observed 2026-11-08 on the laptop (§12): a debug build's console window beside the shell, as expected, and the X hiding the window to the tray; SmartScreen did not show, but the installer came by `scp`, which leaves no mark of the web, so a browser's download is still to be seen, at the release.*

---

## 6. Sign-in and the credential

ADR-0067 decision 2 as built on the hub's side (its note of 2026-11-05) leaves the program three things: the flow, the keychain and the token source.

**The flow**, in the core, in TypeScript, with `app/lib/viewerToken.ts` as the model (it already reads the issuer's metadata and asks the token endpoint): read `<issuer>/.well-known/openid-configuration` for the authorization and token endpoints; draw a `code_verifier` and its S256 challenge and a `state`; listen on `127.0.0.1` at an ephemeral port for one request to `/callback`; ask the shell to open the browser at the authorization endpoint with `response_type=code`, the client id from the profile (`identity.clientId`, ADR-0067 decision 9), the redirect `http://127.0.0.1:<port>/callback`, `scope=openid profile email offline_access` and the challenge; on the callback, check `state`, exchange the code with the verifier at the token endpoint, and answer the browser with a page saying to return to the program. The client is a public one (no secret, RFC 8252 §8.5); the provider registers the redirect as `http://127.0.0.1/callback` without a port, which Keycloak and the standard treat as any loopback port (`RedirectUtils` in Keycloak drops the port for loopback hosts; RFC 8252 §7.3), and the rehearsal realm (`docker/rehearsal/`) has such a client, `armature-desktop`, with the audience mapper the viewer's client has (since 2026-11-05, as `http://127.0.0.1/*`; a port verified 2026-11-06). `offline_access` asks for a refresh token where the provider needs asking; a provider that issues none makes the program sign in again when the access token expires, which the flow handles the same way. *Note (2026-11-06, the rehearsal in `docs/deployment.md`):* a provider may instead refuse the whole request. Keycloak answers `invalid_scope` when the client does not offer the scope, and `not_allowed` at the token exchange when the person lacks the role, so step 3's flow treats either as a reason to sign in again without `offline_access`, or says what the administrator must offer; it does not assume the scope is ignored. The rehearsal realm offers it, and the deployment guide tells an administrator to.

**The keychain**, in the shell. The refresh token is the only durable secret, stored under the program's identifier and the remote's address (`keyring::Entry::new("com.mossglenn.armature", "<remote>")`; *as built, 2026-11-07:* the account `refresh:<remote>`, beside `local-token` for §7's value, with the `keyring` crate's 3.6 line, since 4 splits the stores into separate crates), read at start and sent to the core on the channel (*as built:* the `credential` request after `start`, since the shell learns the remote only from `start`'s reply, the settings being the core's), written when the core reports a rotated one, deleted on sign out. The access token lives in the core's memory only. Why the shell and not the core: the Rust crate is the well-trodden path on all three systems, and the core then needs no native addon, which would be a second binary to sign per platform (`@napi-rs/keyring` would be the alternative; §15 question 6). The webview never sees either token: the shell's commands return the person's name, not the credential.

**The token source** is `hub.remoteToken`: a function returning the current access token, refreshing at the token endpoint when it is within thirty seconds of expiry (the viewer's margin) with the refresh token, and reporting a rotated refresh token to the shell. A refresh the provider refuses (the person was removed, the token expired) clears the source; the next remote action answers `signed_out` and the shell shows the sign-in screen. The hub's own check stays as built: before a workspace is made, pushed, brought in or delivered, `GET /users/me` on the remote must resolve to the owner, else 403 `remote_identity`, so a token left from someone else's sign-in never writes as them.

**A remote under `header`** (the Mac's rehearsal remote on the tailnet; CI) is reached as `app/server.ts` reaches it today: the owner's identifier in `Armature-User`, no token, nothing in the keychain. The connect screen offers it only when the profile says `resolver: header`, and says it is a development arrangement, since such a remote trusts whoever reaches it (ADR-0067 decision 8).

**What the program never does:** pass the person's token to a tool (a tool reaches the remote only through the hub's forwarding, and the forwarding uses the owner's token for reads alone, plan §8); keep a token in a file; send `Armature-User` beside a token (a relay's claim, ADR-0067 decision 5).

---

## 7. The local secret and pairing

As decided (ADR-0065 decision 7, note of 2026-10-30, built on the hub's side 2026-11-03): every write to the hub carries `Armature-Local-Token`; a tool the program launches receives the value as `ARMATURE_LOCAL_TOKEN`; a tool started elsewhere pairs once by pasting the value the program shows; reads need nothing; the check answers "are you a tool I started" and nothing more.

**One change this plan proposes, on evidence** (§15 question 4): the decision says the value is drawn at each start of the program. Built that way, a tool the program did not launch pairs again at every start, and the MCP server's configuration, which is a static file an assistant reads (`claude_desktop_config.json` with `ARMATURE_LOCAL_TOKEN` in it; `docs/mcp-server-plan.md` §3), would be edited by hand each morning. The threat the secret answers, other accounts on the machine and processes the owner did not start, is answered as well by a value kept in the keychain across starts and drawn anew only on request ("reset pairing" in Settings, which every paired tool then repeats) or when none is kept. The keychain is per user, as the threat model is. The recommendation is the kept value, recorded as a dated note on ADR-0065 decision 7 and a line in `docs/api.md`'s workspace section; `ARMATURE_LOCAL_TOKEN` and the header keep their names, and `app/server.ts` keeps drawing one per start, which is right for a process with no keychain.

**Launched tools.** The program's first release launches none: Quiver is paused and the MCP server unbuilt, and the pairing screen is enough for both when they arrive, since each keeps the value in its own settings. A "Tools" list, with the commands the program starts with `ARMATURE_HUB_URL`, `ARMATURE_USER` and `ARMATURE_LOCAL_TOKEN` in their environment, comes with the first tool that wants to be launched rather than paired (§13).

---

## 8. The connection profile and the link

Plan §16 question 12's recommendation, written down as a hub change and a viewer change, both small.

**The profile** is a new entry in `GET /discover` beside `role`, `versions`, `identity`, `capabilities` and `schema`:

```json
"instance": {
  "name": "Armature at Example University",
  "api": "https://api.armature.example.edu",
  "program": { "releases": "https://github.com/mossglenn/armature/releases" }
}
```

`name` from `ARMATURE_INSTANCE_NAME` (the host name when unset: the host of the public address, else the host the request called the hub by, so the viewer, which calls it `hub` inside the network, sees the name a person would); `api` from `ARMATURE_PUBLIC_URL`, which the compose file derives from `ARMATURE_API_SCHEME` and `ARMATURE_API_HOST` (absent on a hub with no public name, where the program uses the address it was given; the hub reads it only under `oidc`, since compose cannot branch on the resolver and a hub under `header` is never published, 2026-11-06); `program.releases` a constant of the hub's own, since the program and the hub come from one repository and a fork changes the constant. The issuer, the audience and the client id are already in `identity` (ADR-0067 decision 9). The profile holds no secret and is read before sign-in, which is why `GET /discover` is open without a token. A client would act on the entry, so it is a dated contract revision in `docs/client-changes.md` and `REVISIONS`, with a type in `@armature/client`; the discovery test and the compose rehearsal cover it. On a workspace hub the entry describes the remote, copied at the clone into the workspace's record, the newest clone from that remote answering, so a tool on the machine learns the instance's name too.

**The link.** The viewer offers `armature://connect?remote=<instance.api>` on one page ("Work from your own machine", `/connect`), reading the address from the hub's own profile, so the link is right wherever the viewer runs; on a hub with none it offers the address a browser could reach the hub at (`ARMATURE_HUB_PUBLIC_URL`, or the hub's own on loopback), and says to ask the administrator when there is neither. The program registers the `armature` scheme at install (macOS requires it static; Windows and Linux also at runtime, which a development build uses), and the single-instance plugin routes a second launch's link to the running program. The program treats the link's `remote` as untrusted input: it reads the profile over HTTPS from that address and shows what it found; nothing is connected or signed in without the person's confirmation on the connect screen, and the scheme carries nothing else. *Since 2026-11-09 (the review's C1 and C2, D5 decided as "the card now"): the hub's account of itself is data, not the address. The card shows the address dialed, never `instance.api`; an `instance.api` on another origin is a warning naming both, since a hostile hub can declare the real instance's name, address and provider; the card is withdrawn when the field changes; `connect` carries the identity and instance confirmed and the core answers 409 `profile_changed` when its own re-read differs, so a hub cannot show one provider and store another; and the Sign in page names the issuer the browser will open at. Binding a token to the hub it was issued for (a resource indicator per hub, RFC 8707, where the provider supports it) is the direction when a second instance shares a provider; the audience check alone would not help, since a hostile hub can declare the real audience.*

**Versions.** The profile's `versions` list is what the program checks: when the remote does not serve the contract revision the program's hub speaks, the connect screen says so and names the release channel; a remote ahead of the program is the case seen on 2026-11-03 (`unsupported_version` on a push), a remote behind it is served by the hub's negotiation as for any client (ADR-0059). The program's own version names the hub revision it carries (`0.<n>`, "hub revision 2026-11-05", shown in Settings).

---

## 9. The machine

**The folder.** The workspaces, their records and the file-backed store live in the program's local data folder by default: `~/Library/Application Support/com.mossglenn.armature/workspaces` on macOS, `%LOCALAPPDATA%\com.mossglenn.armature\workspaces` on Windows (local, not roaming, since a roaming profile is a synced folder), `~/.local/share/com.mossglenn.armature/workspaces` on Linux, which is what Tauri's `app_local_data_dir` names. A person may choose another in Settings; the program warns, without refusing, when the chosen path lies under a synced directory it recognizes (`~/Library/Mobile Documents` and `~/Library/CloudStorage` on macOS; a path segment `OneDrive`, `Dropbox`, `Google Drive` or `GoogleDrive`; the Windows `OneDrive` environment variable's folder) and says what the Windows rehearsal found there (ADR-0066 Verification, 2026-11-03: a file made cloud-only is 503 `store_unreadable` until it is back; a rename the sync client refuses is tried for 2.5 seconds). Changing the folder with workspaces in it moves nothing; the program says to deliver or delete them first, or to move the folder and point at it.

**The port** is 3101 by default, the number the compose profile uses, so a tool finds the hub where the documentation says; changeable in Settings. A port in use is reported at start with the message `server.ts` would print, and the single-instance plugin keeps a second copy of the program from starting at all.

**One remote per program** (plan §16 question 5, decided 2026-10-29). The remote is set on the connect screen and changeable in Settings only while no workspace exists, since a workspace's record names its remote and a push elsewhere would be meaningless. A person with two instances waits for the question to reopen (§13).

**Running.** The program starts the core when it starts, and the hub answers within the second (ADR-0066 Verification: a large workspace opens from disk in half a second). Closing the window hides it; the tray or menu bar icon shows it, with "Open", "Pause the hub" and "Quit"; quitting sends `stop`, waits for `stopped` (the listener closed, the lock released), then exits (*found 2026-11-07 on the Mac's debug bundle:* macOS's quit, the Apple Event Cmd-Q sends, ends the event loop with no request to exit, so the shell then closes the core's input instead and waits for it to end, ADR-0069 decision 4, note); a core that does not answer in a few seconds is killed and the next start takes over its lock and sweeps its temporary files (`lockFolder`). The core treats its standard input closing as `stop`, so a shell killed outright, or ended by the system, leaves neither a process nor a lock (ADR-0069 decision 4); the shell treats SIGTERM as a quit on macOS and Linux, and Windows' WM_CLOSE already reaches its quit. The program runs in the person's signed-in session; it does not start without a desktop. Starting at login is a setting, off by default, until use shows it should be on.

**The log** is the core's output, kept by the shell in the log screen and written to the program's log folder, one file per day, seven kept. Nothing in it is a token: the core prints the local token nowhere (the pairing screen shows it), unlike `server.ts`, which prints the value it drew because it has no screen.

**Settings** are a JSON file in the data folder: the remote, the instance's name and `api`, the remote's identity (`header`, or `oidc` with its issuer and client id, so the program starts offline), the folder, the port, the snapshot budget, the identifier under `header`, start at login. No credential is in it, and a key the program does not know is refused rather than ignored. The core reads and writes it; the shell names the data folder (decided 2026-11-07; `app/lib/desktop/settings.ts`).

---

## 10. Release

**Builds.** Tauri's bundler produces a `.dmg` and `.app` for macOS (one per architecture, not universal as Quiver builds, since a universal build carries two copies of Node; the spike's arm64 disk image is 38 MiB), an `.msi` or `.exe` installer for Windows, and an AppImage and `.deb` for Linux, with the Node executable for each target beside the core's bundle. A GitHub Actions workflow on a `desktop-v*` tag builds all three on their own runners, as Quiver's `release.yml` does for two, and publishes them to this repository's releases with the updater's manifest. On a pull request that touches `desktop/`, CI builds a debug bundle on one runner and runs the shell's checks (`cargo check`, the webview's tests); the core's modules run in the contract suite on every push.

**Signing.** The updater's own signature (minisign, `createUpdaterArtifacts`) from the first build, as Quiver has, so an update is never installed unsigned. On macOS the sidecar is always re-signed, since Node's own signature carries `get-task-allow`, a debugging entitlement the notary service refuses: with the program's identity set, the hardened runtime and an entitlements file of `com.apple.security.cs.allow-jit` alone, Tauri re-signs the sidecar, the shell and the bundle, and the hub, `fetch` and WebAssembly run (the spike, with an ad-hoc identity; ADR-0069 decision 6). Operating-system signing is a cost Amos decides (§15 question 12): an Apple Developer ID and notarization for macOS, without which a person right-clicks to open the first time; a Windows certificate or Azure Trusted Signing, without which SmartScreen warns. The first builds are unsigned beyond the updater's signature, with the two workarounds documented, as Quiver's are; signing comes with the first audience that is not Amos and the rehearsal machines.

**Updates.** The program checks the release channel at start and daily, shows an available update on the workspaces screen, and installs it when asked; the updater restarts the program, which stops the hub cleanly first. The remote's `versions` is the other half (§8). *Changed 2026-11-09 (the review's R2): a channel that answers without a release is not "the latest version". The plugin reports every status but 2xx as `ReleaseNotFound`, a 404 for an empty channel and a 503 alike, so on that answer the program changes nothing: an update already found stays offered, the check is not recorded and the watcher tries again within the hour, and Settings says the channel answered without a release.*

**Versions and the hub.** The program's version is its own (`0.1.0` first), its About naming the hub's contract revision it carries; the hub inside is the one at the tagged commit, bundled from `app/` at build time, so a program release is a commit of this repository and the deployment rehearsal rule applies to it as to the images (CLAUDE.md, Branches item 5).

---

## 11. What runs where

| Concern | The shell (Tauri, Rust) | The core (Node) | The hub (`app/lib/api/`) | The remote |
|---|---|---|---|---|
| Windows, tray, the pages | Yes | No | No | No |
| The keychain (refresh token, local token) | Yes | Holds both in memory | Checks the local token | Verifies the access token |
| The `armature://` link, the browser | Yes (register, open) | Builds the sign-in URL | No | No |
| The sign-in flow, the token source | No | Yes (`lib/desktop/`) | `hub.remoteToken` | `/users/me` |
| The hub, the file-backed store, the lock | No | Yes, as `server.ts` | Yes | No |
| Push, bring in, deliver | Asks | Calls the modules | The modules; the routes refused | Replays, merges, refuses |
| Authorization | No | No | No (ADR-0068 decision 9) | Yes |
| The connection profile | Shows | Reads `GET /discover` | Publishes `instance` | Publishes `instance` |
| Updates | Yes | No | No | `versions` |
| The settings file | Names its folder | Reads and writes it (decided 2026-11-07) | No | No |
| The log file | Yes | Reports | No | No |

---

## 12. Testing and rehearsals

- **The core's modules** are tested in the contract suite as the hub's are: the protocol over a pair of streams (a request in, the reply out, an `ApiError` as the route would send it), the sign-in flow against a fake issuer in the test (the metadata, the authorization endpoint's redirect, the token endpoint, a rotated refresh token, a refused refresh), the token source's refresh timing with a fake clock (as `viewerToken.ts` is tested), the folder rules on example paths, the settings file. `workspaceToken.test.ts` already runs a remote under `oidc` with the suite's own key; the core's push through the token source runs against it. The rule applies: a test is included unless it is very unlikely to show a real problem or very costly.
- **The shell** is tested by building: CI's debug bundle, and the webview's pages in a browser against a fake core (the shell's commands stubbed), as Quiver tests its interface without Tauri's WebDriver, which has no macOS build.
- **Rehearsals**, in order: the spike (§5; done). A rehearsal on a machine reached over SSH installs and collects from the Mac but runs the program at the machine's desktop, since a session without one gives the webview no window (the laptop, 2026-11-06); the Mac against a remote under `header` on the tailnet and the Windows laptop against the same (memory `tailnet-pc-rehearsal`; the runbook of `docs/windows-rehearsal-2026-11-03.md` repeated with the program in place of the hub's bundle); the Keycloak realm (`--profile rehearsal-oidc`) for the sign-in on the Mac; then a Droplet under `oidc`, which workflow rule 5 asks for on an authentication change, with the program on the Mac and the laptop signing in from outside through TLS, pushing, and bringing in: the acceptance of the plan, recorded in `docs/deployment.md` as the earlier runs are. The seed's two people are the two signers.
  - *Run 2026-11-08, the Windows laptop* against officepi (`header`, revision 2026-11-07), from a debug NSIS installer `desktop.yml` built by hand and copied by `scp`, installed per user to `%LOCALAPPDATA%\Armature\`, its data in `%LOCALAPPDATA%\com.mossglenn.armature\`. The `armature://connect` link from Win+R reached the program, registered at run time; the identifier asked for; create, a tool's write over loopback from the Mac by SSH (403 without the pairing value, 200 with it), push, bring in, deliver and remove, the document on officepi's `main` with the designer as `createdBy` and the branch gone. The X hid the window to the tray; the tray's Quit left no process, no lock, no temporary file.
  - *Run 2026-11-08, the Keycloak realm on the Mac:* Keycloak 26.7.5 by `--profile rehearsal-oidc` on loopback; a remote hub on the Mac under `oidc` over a scratch database (`armature_oidc`, the seed, then the designer's `User` with the realm's issuer and `sub`, Administrator and Maintainer, by the operator's `put` as `deployment.md`'s step 3 says); the program's debug bundle rebuilt from `main`. The link, the profile, the browser's sign-in as `designer` through PKCE on loopback, Signed in with the remote's record; create, a tool's write (403, then 200 with the `sub` as `Armature-User`; the email `unknown_user`), push with the token, bring in, deliver as `User/kc-designer`, remove; then quit and relaunch, still signed in from the keychain's refresh token, the hub listening in the second the core started (the first launch of the rebuilt bundle took 14 s, as §5's first launches did). **What it found**, fixed the same day: the branch was `fcf303f1-4194-485e-b8e7-4e4ca72ca809_Kc-rehearsal`, the `sub` as its handle, now the email's (ADR-0065, note of 2026-11-08); a tool's `Armature-User` under `oidc` was shown only as Signed in's grey line, now on Pairing (`toolIdentity`); the identifier kept from the `header` remote stayed in the settings, now dropped on connecting to `oidc`; and macOS capitalized the name typed (`Kc-`), the name, address and identifier fields now opt out. A rerun on the bundle rebuilt with the fixes held all four: `designer_kc-rehearsal` as typed, the `sub` on Pairing (the tool's write sent it, 200), push, deliver and remove, and the identifier gone from the settings when the person connected again.

---

## 13. What this plan declines to do

- **A local merge preview** and the merge engine scoped to the changed documents: deferred with their triggers (SESSION.md item 17; a cost shown in use, a large branch).
- **Launching tools** from the program (§7): with the first tool that asks to be launched rather than paired.
- **Scoped local tokens** with expiry, per tool: with a tool that needs a narrower grant than the owner's own (ADR-0065 decision 7, note).
- **Several remotes** in one program: with a person who has two instances (plan §16 question 5).
- **A pseudonymous clone** (plan §16 question 8): with a study.
- **The operator tools** on the machine: a workspace that needs repair is repaired on the remote and cloned again (plan §9).
- **An item's review, a conflict's resolution, a bank, an editor**: the tools' (§1).
- **Mobile builds**: Tauri allows them; nothing here asks for one.
- **TerminusDB beside the program**: closed by ADR-0066 decision 4 unless its triggers return.

---

## 14. Implementation plan

Each step a pull request on its own branch, the commit sequence proposed first, in this repository (§15 question 3).

1. *Done 2026-11-05 and 06 (§5; ADR-0069, Verification).* **The spike** (`spike/desktop-sidecar`): the throwaway Tauri program of §5 on the Mac and the Windows laptop; its measurements written into this plan's §5 and §15; ADR-0069 drafted from them (§15 question 13) and the per-launch note on ADR-0065 decision 7 (§15 question 4). Nothing of the spike is kept but the numbers.
2. *Built 2026-11-06 (`phase-8/connection-profile`; rehearsed on a fresh VM, `docs/deployment.md`). The realm's client and the rehearsal's `ARMATURE_OIDC_CLIENT_ID` had landed with PR #108; what the realm lacked was `offline_access`, which the rehearsal found.* **The hub's side** (`phase-8/connection-profile`): `instance` in `GET /discover` with `ARMATURE_INSTANCE_NAME` and `ARMATURE_PUBLIC_URL` (the compose file deriving the latter), the client's type, the contract revision and its `client-changes.md` entry, the viewer's link page, the rehearsal realm's public client `armature-desktop` with the loopback redirect, `ARMATURE_OIDC_CLIENT_ID` set in the rehearsal's `.env`; `docs/api.md`, `deployment.md`. A compose change, so a fresh-VM rehearsal. With it, the local token kept rather than drawn when the host supplies one is already how `config.ts` reads `ARMATURE_LOCAL_TOKEN`; nothing changes on the hub for §7.
3. *Built 2026-11-07 (`phase-8/desktop-core`): as below, with the choices of ADR-0069's note of that day; the core is its own command-line driver (`desktop.ts`'s header); `core.test.ts` is the acceptance, `bundle.test.ts` the built core over real pipes, on Windows too in CI's `files` job.* **The core** (`phase-8/desktop-core`): `app/desktop.ts` and `app/lib/desktop/` (the protocol, the settings, the folder rules, the sign-in flow, the token source, the actions), `npm run build:desktop`, the tests of §12, and a command-line driver (`node dist/desktop.mjs` reading lines from a terminal) that stands in for the shell in development and CI. Acceptance: the cycle test's remote driven through the protocol over the file-backed store, and a push through the token source against the suite's `oidc` remote.
4. **The shell** (`phase-8/desktop-shell`): `desktop/` with Tauri 2, the sidecar and resources, the keychain commands, the deep link and single instance, the tray, and the seven pages of §4 in the shell's webview (React and Tailwind as Quiver and CoQui, so components travel); CI's debug build. Acceptance: the tailnet rehearsals of §12 against a `header` remote, then the Keycloak realm. *Decided 2026-11-07 (Amos): two pull requests, (4a) the shell, built that evening (`desktop/src-tauri/`, a first page, `desktop.yml`; run on the Mac's debug bundle against a `header` hub), and (4b) the seven pages with their browser tests against a fake core, the rehearsals its acceptance, built the same night (`desktop/src/pages/`, `desktop/e2e/`, fifteen paths in Chromium) and rehearsed on the Mac against officepi: connect, create, a tool's write with the pairing value, push, bring in, deliver, all as expected; the rehearsal found that a workspace delivered without deleting could not be removed, so Remove was built in the same pull request (revision 2026-11-07, officepi updated to it) and rehearsed there too. The Windows laptop and the Keycloak realm remain of §12's rehearsals (*2026-11-08 (Amos): the laptop's installer is a debug NSIS build from `desktop.yml` started by hand, `workflow_dispatch`, not built on every pull request. Both run that day (§12's record): the laptop's as expected, the Keycloak run's four findings fixed the same day, with the branch handle taken from the email by Amos's choice*); the updater moves to step 5, where its key and manifest are made and it can be tried; `desktop/` is installed on its own with its own lockfile, outside the npm workspace, so the images and the other jobs install nothing new.*
5. **The release and the Droplet** (`phase-8/desktop-release`): the release workflow, the updater (`tauri-plugin-updater`, its minisign key, the private half a repository secret, moved here from step 4 on 2026-11-07) and its manifest, the unsigned first builds with their workarounds documented, `docs/desktop-program.md` for the person who installs it (what it does, the pairing value, the folder, signing in, what each refusal means) and the administrator's lines in `deployment.md` (the public client, the redirect, `ARMATURE_INSTANCE_NAME`); the Droplet run under `oidc` as the acceptance. This plan's status line then changes. *Built 2026-11-08 (`phase-8/desktop-release`): the updater (`src-tauri/src/update.rs`: checked ten seconds after start and whenever a day has passed by the wall clock, since a sleeping Mac's monotonic clock stands still; installed only when asked, downloaded while the hub serves, then the core ended as quitting ends it, since Windows refuses to replace a running executable, then installed and restarted; `requireSignedVersion` on from the first release), rehearsed on the Mac from 0.1.0 to 0.1.1 over a loopback feed with a scratch key, the restart found to need `exiting` set first since a restart off the main thread arrives as the request to exit the shell otherwise takes for a quit; starting at login (`login.rs`: the system's entry follows the core's `startAtLogin`, a start at login hidden in the tray); a placeholder icon; the release workflow (`desktop-release.yml`: four runners, the Intel build cross-built with Intel Node through `TAURI_ENV_TARGET_TRIPLE`, NSIS alone on Windows, the updater's artifacts only in `tauri.release.conf.json` so the pull requests' debug builds need no key); `docs/desktop-program.md`; `deployment.md`'s lines. Two choices beside the text above: the update notice is above every page rather than on the workspaces page alone, since a person not yet connected never reaches that page (§10's "Updates"); and a branch is rehearsed by a tag `desktop-rehearsal-<n>`, since a workflow started by hand must first be on `main`. The Droplet run remains.*
6. **Quiver resumed on it** (plan §14 step 7's second half; quiver#9): its own repository, its §3 and §5 rewritten as a client of the workspace hub, pairing by the kept value.

Beside the steps, the small item SESSION.md item 17 keeps: the registration retry test PR #85 narrowed (nothing registers on first encounter under `header`), which rides step 2. *Done 2026-11-06, and it found a defect: concurrent first encounters made one person several `User`s (ADR-0032 decision 3, note; check AO).*

At the pace Phase 8 has run, a session for the spike and the hub's side together, one or two for the core, two for the shell, one for the release and the Droplet.

---

## 15. Questions to settle

Each with the options and the recommendation the plan above is written to.

1. **The shell.**
   - (a) Tauri 2 with the core as a Node sidecar and a control channel over its pipes (§3, §5).
   - (b) Electron: Node built in, the hub in the main process, the core a module rather than a process, the keychain through `safeStorage`.
   - (c) No shell: the core alone, installed as a service, with its pages served on loopback and opened in the browser (Syncthing's shape).

   *Recommendation: (a).* (b) is simpler to build, with no channel and no sidecar, and the honest comparison says so; it costs an installer of 100 MB or more and Chromium's memory for a program that mostly sits in the tray, and a second toolchain beside Quiver's. (a) keeps the shell small and the logic in TypeScript where the tests run, and the Node sidecar makes its installer about the size of (b)'s, so its gains are memory and one toolchain, not download. (c) has no keychain, no scheme and no signed update without native modules, and is not a thing a designer installs. If the spike finds the sidecar path blocked on one platform, (b) is the fallback and the core moves across unchanged. *Decided 2026-11-05 (Amos): (a), on the comparison of the two forms' costs: no shell loses the keychain, running in the background, installers with updates and a visible program, each with a worse substitute; the core is built to run with no shell first (step 3), and the shell is added for the designer release.*

2. **The sidecar's form.**
   - (a) The Node executable for each target as the sidecar, the bundle as a resource (§5).
   - (b) Node's single-executable feature: one file per target, the bundle injected; `mainFormat: module` supported; stability 1.1.
   - (c) Bun or Deno compiled, or `pkg`.

   *Recommendation: (a), (b) later if one file is wanted.* (a) is the runtime the suites run on with no packaging step; (b) is the same runtime with a build step that is still marked active development and a signing step per platform; (c) is a runtime the suites do not run on. *Confirmed by the spike (2026-11-06): (a) ran on every machine, the core's bundle under 1 MiB beside Node; recorded in ADR-0069 decision 2.*

3. **Where it lives.**
   - (a) `desktop/` in this repository, beside `app/` and `docker/`, built from the same commit as the hub it carries.
   - (b) Its own repository, taking the hub's bundle from a release.
   - (c) Inside Quiver, as plan §16 question 1 first recommended.

   *Recommendation: (a).* The program is a host of the hub, as `app/server.ts` and the images are, not a client; its version is the hub's revision; and the deployment rehearsal rule already applies to a change in how the hub runs. (b) would split one release into two. (c) was right when Quiver was the only local tool; the MCP server and the Storyline bridge now share the hub, and a program Quiver bundles is a program the MCP server cannot find. *Decided 2026-11-05 (Amos): (a).*

4. **The local token across starts** (§7).
   - (a) Drawn at each start, as decided (ADR-0065 decision 7, note of 2026-10-30).
   - (b) Kept in the keychain across starts; drawn anew on "reset pairing" or when none is kept.
   - (c) Per-tool tokens issued at pairing (the deferred scoped design).

   *Recommendation: (b), as a dated note on the decision.* The threat model is per user and the keychain is per user; (a) makes a paired tool, and the MCP server's static configuration, pair again each morning; (c) is the design the decision deferred until a tool needs a narrower grant. `server.ts` keeps (a). *Decided 2026-11-05 (Amos): (b); the dated note on ADR-0065 decision 7 comes with step 1.*

5. **How the shell drives the actions, and the fate of `ARMATURE_WORKSPACE_ACTIONS`.**
   - (a) The control channel over the sidecar's pipes; the routes refused on the program's hub; the setting kept for the compose profile and the suites.
   - (b) A second secret only the shell holds, `Armature-Program-Token`, gating the action routes; the setting retired.

   *Recommendation: (a).* Nothing new on the network, no new header, no route a paired tool could reach; the compose profile keeps its push entry as decided on 2026-11-03 (choice 3), which (b) would take away. The note's sentence that the setting "is retired with the program" is amended: the program does not set it.

6. **Where the credential logic runs.**
   - (a) The flow and the token source in the core (TypeScript), the keychain in the shell (Rust `keyring`), the refresh token crossing the channel (§6).
   - (b) Everything in the shell with the Rust `openidconnect` crate, the access token pushed to the core.
   - (c) Everything in the core, with `@napi-rs/keyring` as a native addon.

   *Recommendation: (a).* The flow's tests live beside `viewerToken.ts`'s; (b) puts the most logic where the fewest tests are; (c) adds a native binary per platform to ship and sign for one call.

7. **The redirect and the client.**
   - (a) `http://127.0.0.1:<ephemeral port>/callback`, the client registered without a port, a public client, `offline_access` requested.
   - (b) A fixed port, registered exactly.

   *Recommendation: (a).* It is RFC 8252's pattern and Keycloak's documented one; (b) fails when the port is taken. A provider that rejects a portless loopback registration is handled by registering a few fixed ports as well, decided when such a provider appears.

8. **The profile's shape and names** (§8): `instance` with `name`, `api` and `program.releases`; `ARMATURE_INSTANCE_NAME`; `ARMATURE_PUBLIC_URL`; the scheme `armature` and the path `connect` with one parameter, `remote`.

   *Recommendation:* as stated, open to overrule. The alternative, a top-level `connection` entry repeating the issuer and audience, duplicates `identity`. *Decided 2026-11-06 (Amos): as stated.*

9. **The program's name and identifiers.** Product name "Armature", the window "Armature", the identifier `com.mossglenn.armature` beside Quiver's `com.mossglenn.quiver`, the binary `armature`, the tag `desktop-v*`, the documents saying "the desktop program" as they do today.

   *Recommendation:* as stated. "Armature Workspace" and "Armature Desktop" each say less than the one word: the hub's server has no program of its own to be confused with.

10. **The window and the tray** (§9).
    - (a) Closing the window hides it; the tray or menu bar icon shows it; quitting stops the hub.
    - (b) A window only; closing it stops the hub.

    *Recommendation: (a).* A tool needs the hub while the person is not looking at the program; (b) makes Quiver fail when the window is closed.

11. **Launched tools in the first release** (§7).
    - (a) None; pairing by the kept value.
    - (b) A "Tools" list with commands and their environment.

    *Recommendation: (a).* No tool asks yet; (b) is a session's work the first launched tool will shape.

12. **Signing** (§10).
    - (a) The updater's signature only, the two workarounds documented, until an audience beyond Amos and the rehearsal machines.
    - (b) An Apple Developer ID and a Windows certificate or Azure Trusted Signing from the first release.

    *Recommendation: (a).* The certificates are Amos's to obtain and cost money; the updater's signature keeps updates safe meanwhile. The spike checks that Tauri signs the sidecar so (b) is a configuration change, not a build change, when it comes. *Decided 2026-11-05 (Amos): (a).* *The spike checked the premise (2026-11-05): with an identity set, Tauri re-signs the sidecar under the hardened runtime, so (b) is a configuration change; notarization itself waits for an identity.* *Evidence for the decision (2026-11-08, the first release build installed on the Mac from a rehearsal draft): Gatekeeper's "cannot verify" with Open Anyway in Privacy & Security, as the workaround says, and then the keychain asking for the login password, since macOS ties a keychain item to the designated requirement of the program that made it, which for an ad-hoc signature is that build's own hash: the items the debug build made did not recognize the release build. The same is expected between any two ad-hoc builds, so under (a) a Mac would ask for the password after every update, to be seen when 0.1.1 installs over 0.1.0; a Developer ID's requirement is stable across versions and would end it. Recorded for the decision, which stays (a) until Amos reopens it; docs/desktop-program.md tells the person.*

13. **An ADR.**
    - (a) ADR-0069, "The desktop program: a Tauri shell over the hub on Node", short, in the Nygard form with In brief, Alternatives and Verification (the spike), written after the spike; the other choices as dated notes on ADR-0065 decision 7 (the kept token, the actions over the channel), ADR-0066 (the folder and the warning) and ADR-0067 decisions 2 and 9 (the flow, the profile).
    - (b) Dated notes only.

    *Recommendation: (a).* The shell and the channel are an architecture the hub's later readers will ask "why" of, as ADR-0054 answers for Hono; the notes alone would scatter the answer across three records. *Decided 2026-11-05 (Amos): (a).*

14. **Where this plan lives.** Here, as the workspace hub plan does, since the program is in this repository (question 3); when the program exists, this document becomes its description, and `docs/desktop-program.md` is the person's guide.

    *Recommendation:* as stated.
