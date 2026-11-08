# The Armature desktop program's shell

The program a designer installs to work on their own machine (ADR-0069; [the plan](../docs/desktop-program-plan.md)). It is a [Tauri 2](https://tauri.app) shell over the **core**, `app/desktop.ts`, which hosts a workspace hub on `127.0.0.1:3101` over the file-backed store in the program's data folder. The shell owns what needs the operating system: the window and the tray, the keychain, the `armature://` link, opening the browser for the sign-in, and starting and stopping the core. It holds no logic about workspaces, tokens or the hub beyond relaying: the core decides, and answers as the hub's routes would.

Status: the shell is built (the plan's step 4, its first part); the seven pages of the plan's §4 come next, and the updater and the release builds with step 5. Until then the window shows one page: the hub's state, a link's remote and the log.

## How it fits together

```
the page (src/, React)  ──invoke core_request──▶  the shell (src-tauri/, Rust)  ──JSON lines──▶  the core (Node, armature-node desktop.mjs)
                        ◀──── core-event ───────                                ◀──────────────
```

- **The core** runs as a sidecar: Node itself, named `armature-node`, with the core's bundle as its one argument. It reads requests on its standard input and writes replies and events on its standard output (`app/lib/desktop/protocol.ts`). Nothing secret goes in its arguments or environment.
- **The shell** (`src-tauri/src/`) starts the core and sends it `start` with the data folder and the keychain's local token, then `credential` with the refresh token the keychain keeps for the remote. It keeps what the core hands back in the keychain: a drawn local token and a rotated refresh token. A page reaches the core only through `core_request`, which refuses the shell's own requests (`start`, `stop`, `credential`; `relay.rs`). The core's `credential` events never reach the page.
- **The page** (`src/`) calls the core only through `src/lib/backend.ts`: Tauri's `invoke` in the shell, a fake core in a plain browser, so the pages run and are tested without the shell, as Quiver's are.

| Module | What it does |
|---|---|
| `src-tauri/src/core.rs` | The core's life: spawn, `start`, `credential`, `stop`, quit (stop, wait five seconds, end it), and the exit macOS sends without asking |
| `src-tauri/src/relay.rs` | The rules: what a page may ask, what happens to each core event, the `armature://connect` link's remote, whole lines from the pipe |
| `src-tauri/src/keychain.rs` | The refresh token under `refresh:<remote>` and the local token under `local-token`, service `com.mossglenn.armature` |
| `src-tauri/src/logs.rs` | The core's log, one file per day, seven kept |
| `src-tauri/src/tray.rs` | The tray: Open, Pause or Resume the hub, Quit |
| `scripts/prepare.mjs` | `npm run sidecar`: bundles the core with app's `build:desktop` and fetches Node 22.23.4 for the target, checked against nodejs.org's checksums |

## Running it

It is installed on its own, outside the repository's npm workspace (decided 2026-11-07), and the core is bundled from the workspace, so both are installed:

```sh
npm ci                      # at the repository root: the core is built there
cd desktop && npm ci        # the shell's own packages
npm run tauri dev           # prepares the sidecar, starts Vite on port 1430 and opens the program
```

Rust (stable) is required, and on Linux Tauri's prerequisites (WebKitGTK 4.1 and the packages in `../.github/workflows/desktop.yml`). `npm run dev` alone serves the page in a browser against the fake core.

**The data and where it lives.** The program's data folder holds `settings.json` (the core's; `app/lib/desktop/settings.ts`) and `workspaces/`; its log folder the daily logs. On macOS these are `~/Library/Application Support/com.mossglenn.armature` and `~/Library/Logs/com.mossglenn.armature`. Until the connect page exists, a development run is pointed at a remote by writing the settings file by hand, for example a hub under `header` on this machine:

```json
{ "remote": "http://127.0.0.1:3100", "identity": { "resolver": "header" }, "user": "demo-designer@example.edu", "port": 3101 }
```

To start from nothing, quit the program, remove the data folder, and remove the keychain's items for the service `com.mossglenn.armature` (on macOS, `security delete-generic-password -s com.mossglenn.armature -a local-token`, and the same with `-a refresh:<remote>`).

**A link** (`armature://connect?remote=https://api.<site>`) reaches the program on macOS only from a bundle, since the scheme is registered from its `Info.plist`: `npm run tauri build -- --debug --bundles app`, open the `.app` under `src-tauri/target/debug/bundle/macos/`, then `open "armature://connect?remote=..."`. Windows and Linux register it at run time.

## Checks

| Command | What |
|---|---|
| `npm run typecheck` | The pages |
| `cargo clippy --all-targets -- -D warnings` (in `src-tauri/`) | The Rust side, warnings as errors |
| `cargo test` (in `src-tauri/`) | The relay's rules, the link, the keychain's naming, the log files |
| `npm run tauri build -- --debug` | A debug bundle |

CI runs all four on Ubuntu (`../.github/workflows/desktop.yml`) when the shell or the core changes; the core's own suites run in `ci.yml`.
