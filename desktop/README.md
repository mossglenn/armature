# The Armature desktop program's shell

The program a designer installs to work on their own machine (ADR-0069; [the plan](../docs/desktop-program-plan.md)). It is a [Tauri 2](https://tauri.app) shell over the **core**, `app/desktop.ts`, which hosts a workspace hub on `127.0.0.1:3101` over the file-backed store in the program's data folder. The shell owns what needs the operating system: the window and the tray, the keychain, the `armature://` link, opening the browser for the sign-in, and starting and stopping the core. It holds no logic about workspaces, tokens or the hub beyond relaying: the core decides, and answers as the hub's routes would.

Status: the shell and its seven pages are built (the plan's step 4), rehearsed on the Mac and a Windows laptop against a remote on the tailnet and under the Keycloak realm; the updater, starting at login and the release workflow are built (step 5, 2026-11-08), the Droplet run their acceptance. [`docs/desktop-program.md`](../docs/desktop-program.md) is the guide for the person who installs it.

## How it fits together

```
the page (src/, React)  ──invoke core_request──▶  the shell (src-tauri/, Rust)  ──JSON lines──▶  the core (Node, armature-node desktop.mjs)
                        ◀──── core-event ───────                                ◀──────────────
```

- **The core** runs as a sidecar: Node itself, named `armature-node`, with the core's bundle as its one argument. It reads requests on its standard input and writes replies and events on its standard output (`app/lib/desktop/protocol.ts`). Nothing secret goes in its arguments or environment.
- **The shell** (`src-tauri/src/`) starts the core and sends it `start` with the data folder and the keychain's local token, then `credential` with the refresh token the keychain keeps for the remote. It keeps what the core hands back in the keychain: a drawn local token and a rotated refresh token. A page reaches the core only through `core_request`, which refuses the shell's own requests (`start`, `stop`, `credential`; `relay.rs`). The core's `credential` events never reach the page.
- **The pages** (`src/pages/`: Connect, Sign in, Workspaces, a workspace, Pairing, Settings, Log) call the core only through `src/lib/backend.ts`: Tauri's `invoke` in the shell, a fake core in a plain browser (`src/lib/fakeCore.ts`, a small model of the core with its replies' shapes and refusal codes), so the pages run and are tested without the shell, as Quiver's are. `?scenario=fresh|header|oidc|oidc-scope|oidc-unregistered` in the address picks where the fake core starts, and `?update=available|fails` adds an update on offer.

| Module | What it does |
|---|---|
| `src-tauri/src/core.rs` | The core's life: spawn, `start`, `credential`, `stop`, quit (stop, wait five seconds, end it), and the exit macOS sends without asking |
| `src-tauri/src/relay.rs` | The rules: what a page may ask, what happens to each core event, the `armature://connect` link's remote, whole lines from the pipe |
| `src-tauri/src/keychain.rs` | The refresh token under `refresh:<remote>` and the local token under `local-token`, service `com.mossglenn.armature` |
| `src-tauri/src/logs.rs` | The core's log, one file per day, seven kept |
| `src-tauri/src/tray.rs` | The tray: Open, Pause or Resume the hub, Quit |
| `src-tauri/src/update.rs` | The updater: the release channel checked at start and daily, an update installed when asked (downloaded, the core ended, installed, restarted) |
| `src-tauri/src/login.rs` | Starting at login: the system's entry follows the core's `startAtLogin`; a start at login passes `--hidden` and stays in the tray |
| `scripts/prepare.mjs` | `npm run sidecar`: bundles the core with app's `build:desktop` and fetches Node 22.23.4 for the target, checked against nodejs.org's checksums |

## Running it

It is installed on its own, outside the repository's npm workspace (decided 2026-11-07), and the core is bundled from the workspace, so both are installed:

```sh
npm ci                      # at the repository root: the core is built there
cd desktop && npm ci        # the shell's own packages
npm run tauri dev           # prepares the sidecar, starts Vite on port 1430 and opens the program
```

Rust (stable) is required, and on Linux Tauri's prerequisites (WebKitGTK 4.1 and the packages in `../.github/workflows/desktop.yml`). `npm run dev` alone serves the pages in a browser against the fake core, at <http://localhost:1430/?scenario=header>.

**The data and where it lives.** The program's data folder holds `settings.json` (the core's; `app/lib/desktop/settings.ts`) and `workspaces/`; its log folder the daily logs. On macOS these are `~/Library/Application Support/com.mossglenn.armature` and `~/Library/Logs/com.mossglenn.armature`. The connect page points the program at a remote, for example a hub under `header` on this machine at `http://127.0.0.1:3100`; the program then needs a remote at its own contract revision or later (the connect page says when it is not).

To start from nothing, quit the program, remove the data folder, and remove the keychain's items for the service `com.mossglenn.armature` (on macOS, `security delete-generic-password -s com.mossglenn.armature -a local-token`, and the same with `-a refresh:<remote>`).

**A link** (`armature://connect?remote=https://api.<site>`) reaches the program on macOS only from a bundle, since the scheme is registered from its `Info.plist`: `npm run tauri build -- --debug --bundles app`, open the `.app` under `src-tauri/target/debug/bundle/macos/`, then `open "armature://connect?remote=..."`. Windows and Linux register it at run time.

## Checks

| Command | What |
|---|---|
| `npm run typecheck` | The pages |
| `npm run test:e2e` | The pages in Chromium against the fake core (`e2e/`; `npx playwright install chromium` once) |
| `cargo clippy --all-targets -- -D warnings` (in `src-tauri/`) | The Rust side, warnings as errors |
| `cargo test` (in `src-tauri/`) | The relay's rules, the link, the keychain's naming, the log files, the update check's timing, the start at login's argument |
| `npm run tauri build -- --debug` | A debug bundle |

CI runs all five on Ubuntu (`../.github/workflows/desktop.yml`) when the shell or the core changes; the core's own suites run in `ci.yml`. A Windows debug installer (NSIS, per user) is built only when the workflow is started by hand, `gh workflow run desktop.yml --ref <branch>`, and kept as the run's artifact `armature-desktop-debug-windows` for a week.

## Releasing

A release is a commit of this repository: the shell and the hub it carries come from the same tag (plan §10).

1. Set the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json` (the workflow refuses a tag when they differ), merge, then on `main`: `git tag desktop-v<version> && git push origin desktop-v<version>`.
2. `../.github/workflows/desktop-release.yml` builds macOS for Apple silicon and Intel, the Windows NSIS installer and the Linux AppImage and `.deb` on their own runners with no secret in reach (`contents: read`, no key), then one job under the `release` environment, which Amos approves in the Actions tab, signs the updater's artifacts (`tauri signer sign`, bound to the version), writes `latest.json` from the signatures (`scripts/latest-json.mjs`, which refuses a manifest missing a platform) and attaches everything to a **draft** release. Try the installers, then publish the draft: publishing copies its `latest.json` onto the `desktop-channel` release (`desktop-channel.yml`), the fixed feed every installed program reads (`releases/download/desktop-channel/latest.json`), so a draft, a prerelease or a release of anything else never reaches a program (since 2026-11-09; the review's R1 and R3).
3. A branch is rehearsed before it merges by a tag `desktop-rehearsal-<n>` on its head, which builds the same into a prerelease draft of that name, signed under the `rehearsal` environment with a scratch key (`~/.tauri/armature-rehearsal.key`; its public half and the rehearsal channel in `src-tauri/tauri.rehearsal.conf.json`, applied as a `--config` overlay), so a rehearsal build updates only from `desktop-rehearsal-channel`, which publishing the rehearsal draft moves; delete the draft and the tag afterwards, `gh release delete desktop-rehearsal-<n> --cleanup-tag`.

The updater's key is `~/.tauri/armature.key` on Amos's Mac, its public half in `tauri.conf.json`, the private half and its password the `release` environment's secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (an environment's secrets reach only a job that names the environment, and the environment admits only `desktop-v*` tags and waits for Amos's approval; the key was a repository secret, readable by every job, until 2026-11-09). A lost key means every installed program must be reinstalled by hand, since it accepts only updates signed by it. `requireSignedVersion` is on: the signature names the version it was made for, so a feed cannot offer an older genuine build as a newer one.

The updater can be tried without a release: build an older version with a `--config` overlay pointing `plugins.updater` at a feed on loopback (`dangerousInsecureTransportProtocol`, a scratch key's `pubkey`), build a newer one signed with that key (`TAURI_SIGNING_PRIVATE_KEY`, the overlay with `createUpdaterArtifacts`), serve its `.app.tar.gz` and a `latest.json` naming it, and open the older one (rehearsed on the Mac 2026-11-08).

The icon is a placeholder (`src-tauri/icons/source.svg`, which says how every size is made from it).
