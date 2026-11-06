# ADR-0069: The Desktop Program Is a Tauri Shell Over the Hub on a Node Sidecar

> **In brief.** This decision answers: what is the program a designer installs to run a workspace
> hub (ADR-0065) on their own machine? It is two pieces. A small native shell, built with Tauri,
> does what needs the operating system: the windows, the tray icon, the keychain, the
> `armature://` link and updates. Beside it runs the hub itself, the same code the shared server
> runs, on Node.js, which the program carries with it. The two talk over a private channel that
> nothing else on the machine can reach. It was decided on 5 November 2026 and checked by a spike
> on four machines on 5 and 6 November; nothing of the program is built yet.

## Status

Accepted (2026-11-05, Amos, on `docs/desktop-program-plan.md` §15 questions 1 and 13; verified by
the spike of 2026-11-05 and 06, Verification). Not built: the program is the plan's §14 steps 2 to
5. Decisions 4 and 6 are the spike's findings, written as rules here because the program cannot
work without them; the names in them (`armature-node`) are chosen without a separate decision and
open to overrule.

It answers `docs/workspace-hub-plan.md` §16 question 1 (the first release candidate is a desktop
program, decided 2026-10-30) in the form the desktop program's plan recommends. It depends on
ADR-0065 (the workspace hub, which this program hosts), ADR-0066 (its folder, the one local store),
ADR-0067 decision 2 (the native sign-in the program performs) and ADR-0054 (the API as a
host-neutral Hono application, which is what lets a third host exist). It amends none of them;
ADR-0065 decision 7 carries a dated note of the same day for the local token kept across starts
(the plan's §15 question 4), a separate decision.

## Context

A workspace hub is the API in a second role on a person's machine (ADR-0065). Until now its hosts
are `app/server.ts`, run by hand, and the `workspace` compose profile, which needs a container
runtime; both are for developers and researchers (`docs/deployment.md`, "A workspace hub on this
machine"). A designer's install needs more than a process: the owner's refresh token kept in the
operating system's keychain (ADR-0067 decision 2), the per-launch secret held and shown on a
pairing screen (ADR-0065 decision 7), push, bring in and deliver as the program's own actions
rather than routes a tool may call (the same decision), a link from the viewer that opens the
program (plan §16 question 12), a visible program that keeps running when its window closes, and
signed updates.

Three facts bear on the shape:

1. **The hub is TypeScript on Node.** Its suites run on Node 22 (CI); `npm run build:hub` bundles it
   into one file with esbuild. A host that runs the hub on another runtime runs a hub the tests do
   not cover.
2. **What needs the operating system is small and native.** The keychain (Keychain Services, the
   Credential Manager, the Secret Service), a URL scheme registered at install, a tray icon,
   installers and a signed updater. Node offers none of them without a native addon per platform.
3. **Quiver, the first local client, is already a Tauri 2 program** (`~/Dev/quiver`, its plan's
   §5.1), with Tauri's updater and a release workflow.

## Decision

1. **A Tauri 2 shell for what needs the operating system.** The shell owns the windows and the
   tray, the keychain (the Rust `keyring` crate), the `armature://` scheme
   (`tauri-plugin-deep-link` with `tauri-plugin-single-instance`), opening the browser, the
   updater, and starting and stopping the core. It holds no logic about workspaces, tokens or the
   hub beyond relaying. Its pages run in the system's webview.

2. **The core is the hub's host, on the Node executable the program carries.** One esbuild bundle,
   `app/desktop.ts`, does what `app/server.ts` does (the folder's lock, the file-backed store,
   `startHub` in the workspace role under `header` on loopback) and what the program adds (the
   sign-in flow and the token source behind `hub.remoteToken`, the actions in-process, the local
   token). It runs on Node's official build for each target, shipped as a Tauri sidecar named
   `armature-node`, with the bundle as a resource; the Node line is the one CI runs (22 at
   writing). Nothing under `app/lib/api/` learns about the program.

3. **The channel is JSON lines over the sidecar's standard input and output.** The shell asks
   (`start` with the settings and the credentials the keychain held, the workspace actions,
   `stop`); the core answers with what the routes would have answered, an `ApiError` as the route
   would send it, and sends events (a rotated refresh token for the shell to keep, log lines). A
   child's pipes are readable by its parent alone, so nothing crosses the network or a file, and
   no secret is put in the sidecar's arguments or environment.

4. **The core's life is bound to the shell's.** The core treats its standard input closing as a
   `stop`: it closes the listener and releases the folder's lock, so a shell killed outright leaves
   neither a process nor a lock. The shell's quit sends `stop` and waits for the core to exit, up
   to a few seconds, then kills it; on macOS and Linux the shell also treats SIGTERM as a quit. A
   core killed outright leaves its lock, which the next start takes over (`lockFolder`, ADR-0066
   decision 2).

5. **The hub inside is unchanged.** `actionRoutes` is never set on the program's hub, so its
   `GET /discover` says `actions: program` and the action routes are refused; the core calls
   `pushWorkspace`, `bringIn` and `deliver` as the routes do.

6. **Platform rules the spike found.** On Windows the shell gives Node the core's path without the
   extended-length prefix Tauri resolves resources with (`\\?\C:\...`), which Node cannot load as
   its entry script (the `dunce` crate). On macOS the program is signed with the hardened runtime
   and Tauri re-signs the sidecar with the program's identity and entitlements, of which Node needs
   only `com.apple.security.cs.allow-jit`; Node's own signature carries a debugging entitlement
   Apple's notary service refuses, so the sidecar is always re-signed. macOS builds are one per
   architecture rather than universal, since a universal build carries two copies of Node. The
   program runs in a person's signed-in session: without a desktop, as over SSH, the webview has no
   window and the shell stops at setup.

## Alternatives considered

- **Electron.** Node is built in, so the hub would run in the main process and the core would be a
  module, with no channel and no sidecar; the keychain through `safeStorage`. Simpler to build, and
  said so in the plan. Declined for the shell's memory and size (Chromium beside a program that
  mostly sits in the tray), and for a second toolchain beside Quiver's. The core is written to move
  across unchanged if the sidecar path fails on a platform.
- **No shell: the core alone as a background service, its pages served on loopback** (Syncthing's
  shape). One language, one process, no Rust. Declined because it loses the keychain, a visible
  program, installers and signed updates, each with a worse substitute (a native addon, a launchd,
  Task Scheduler and systemd unit apiece, hand-rolled updates), and because a designer installs a
  program, not a service. The core still runs without a shell in development (the plan's step 3).
- **Node's single-executable feature.** One file per target with the bundle injected; marked
  active development (stability 1.1) and adding a build and signing step per platform. Kept as the
  later choice if one file is wanted.
- **Bun, Deno or `pkg`.** Runtimes or loaders the suites do not run on. Declined.
- **The sign-in and the token source in Rust**, the access token pushed to the core. Puts the most
  logic where the fewest tests are; the flow lives in the core beside `app/lib/viewerToken.ts`.

## Verification

The spike (`spike/desktop-sidecar`, on that branch's history up to commit `fd50f8c`, removed before
it merged): a throwaway Tauri shell starting Node 22.23.4 as the sidecar with a core that hosted
the real hub over the file-backed store, measured by one script on each machine against the
installed program.

| | The Mac (M2, macOS, arm64) | GitHub's macOS runner | GitHub's Windows runner | The Windows laptop (Windows 11 Pro, i7-8700) | GitHub's Ubuntu 22.04 runner, Xvfb |
|---|---|---|---|---|---|
| What a person downloads | `.dmg` 38 MiB | `.dmg` 38 MiB | installer 24 MiB | installer 24 MiB | `.deb` 47 MiB, AppImage 117 MiB |
| Launch to a listening hub, first | 0.59 s | 6.1 s | 9.8 s | 1.4 s | 0.50 s |
| Launch to a listening hub, after | 0.32 to 0.39 s | 0.76 to 0.80 s | 0.92 to 0.98 s | 0.60 to 0.68 s | 0.24 to 0.25 s |
| `stop` to the core's exit | 7 to 15 ms | 13 to 30 ms | 16 to 17 ms | 14 to 15 ms | 7 to 9 ms |
| The core, resident | 80 MiB | 79 MiB | 60 MiB | 61 MiB | 84 MiB |

- **Every exit case on every machine:** a graceful quit stopped the hub and removed the lock; the
  shell killed outright left neither process nor lock (decision 4's rule, since a killed shell can
  do nothing); the shell closed as the system closes it (SIGTERM on macOS and Linux, where the
  spike's shell did nothing and the core's rule acted; a `taskkill` WM_CLOSE on Windows, which went
  through the shell's own stop in 18 to 70 ms); the core killed with the shell running left its
  lock, which the next start took over.
- **A fresh machine's first launch** is the one slow start: the first spawn of a 108 MiB Node the
  system has not run (macOS), or the webview's first start before Node runs (Windows).
- **Signing on macOS:** unconfigured, Tauri leaves the linker's ad-hoc signature, which fails
  `codesign --verify --deep --strict`, and Node as nodejs.org signed it, with
  `com.apple.security.get-task-allow`; with an identity (ad hoc in the spike), the hardened runtime
  and an entitlements file of `allow-jit` alone, Tauri re-signed the sidecar, the shell and the
  bundle, which verified, and the hub, `fetch`, a WebAssembly compile and `node:crypto` worked.
  Notarization itself is untested until there is a Developer ID.
- **Windows:** the extended-length path failed the core at once on the first Windows run (decision
  6); the laptop's install and collection ran over SSH, the checks at its desktop.
- Not observed: SmartScreen on a double-clicked unsigned installer, a console window beside the
  shell, closing the window with its X on Windows. WebKitGTK under Xvfb needed its GPU paths off; a
  Linux desktop is unrehearsed.

## Consequences

- **A Rust toolchain** on the build machines and in CI, and Tauri's configuration and permissions
  to keep; the shell's code is small by decision 1, and the tests stay in the core (the plan's §12).
- **Two processes** with a lifecycle between them; decision 4 is what keeps a crash from leaving
  a hub on the port or a lock in the folder, and the core's tests cover it.
- **The program carries Node** (83 to 108 MiB of the install), so a Node security release is a
  program release, and the program moves to the next Node line with CI's, before Node 22's end of
  life in April 2027.
- **About 190 MiB resident** for the shell and the core together on the Mac (the shell 109, the
  core 80), the webview's shared processes not counted; the core alone 60 MiB on Windows.
- **The core's protocol is a second interface to the hub's workspace actions,** shaped as the
  routes' answers so the suites' expectations apply; a change to an action's answer changes both.
- **Quiver** can be built on the same shell pattern, and its own plan decides whether it is.
