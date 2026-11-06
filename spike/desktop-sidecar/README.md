# The desktop program's sidecar spike

Throwaway, on the branch `spike/desktop-sidecar` only: step 1 of `docs/desktop-program-plan.md` §14. It answers the plan's §5 questions about the shape decided on 2026-11-05 (a Tauri 2 shell over the hub on a Node sidecar, a channel of JSON lines over the sidecar's pipes): the installer's size, the time to a listening hub, whether the folder's lock is released on quit and on a kill, and on macOS whether Tauri signs the sidecar. Nothing here is kept but the numbers, which go into the plan's §5 and §15 and ADR-0069; this folder and `.github/workflows/desktop-spike.yml` are removed before the branch merges.

## The pieces

- `core.ts`: the hub's host, as `app/server.ts` is, driven by `start`, `ping` and `stop` on standard input; standard input closing is a stop too.
- `src-tauri/`: the shell. Starts `armature-node` (Node v22.23.4) with `core/core.mjs`, sends `start` when the core says `ready`, records each timing, and on quit sends `stop` and waits up to five seconds for the core to exit. `SPIKE_AUTOQUIT=1`, `SPIKE_PORT`, `SPIKE_LOG`.
- `prepare.mjs`: bundles the core with esbuild and fetches Node for the host's target triple, checksum-verified against nodejs.org.
- `spike-check.mjs`: the measurements on one machine, against a built shell.

```
node spike/desktop-sidecar/prepare.mjs
cd spike/desktop-sidecar && npx -y @tauri-apps/cli@2.12.4 build --bundles app,dmg
node spike-check.mjs "src-tauri/target/release/bundle/macos/Armature Spike.app/Contents/MacOS/armature-desktop-spike"
```

## Findings

### macOS (the M2 Mac, macOS arm64, 2026-11-05)

| What | Measured |
|---|---|
| The `.app` | 120 MiB: Node 108, the shell 12, the core's bundle 0.9 |
| The `.dmg` | 38 MiB |
| Launch to a listening hub | 0.59 s cold (first run after the build), 0.32 to 0.39 s warm |
| Of which: Node's start and the bundle's load | 60 to 80 ms in the core, 70 to 100 ms from the shell's spawn |
| Of which: `start` to listening (the lock, the file-backed store, the server) | 11 to 23 ms |
| `stop` to the core's exit | 7 to 15 ms |
| Memory, idle | the core 80 MiB resident, the shell 109 MiB (WebKit's helper processes are shared with every other app and not counted) |

- **Quit:** every graceful quit stopped the hub, removed the lock and left no process.
- **The shell killed outright, or sent SIGTERM:** the core saw its standard input close, stopped the hub and removed the lock itself; nothing was left. With SIGKILL the shell can do nothing, so this is the core's rule working, and the program must keep it. The shell does not handle SIGTERM itself; on macOS a logout quits programs with an Apple event, so this matters on Linux, where the program should.
- **The core killed with the shell running:** the shell lived and saw an unexpected exit (signal 9); the lock was left, and the next start took it over (`lockFolder`) and listened in 0.34 s.
- **Signing.** With no signing identity Tauri leaves the bundle with the linker's ad-hoc signature, which fails a strict verify, and the Node binary as nodejs.org signed it: the Node.js Foundation's Developer ID, the hardened runtime, and `com.apple.security.get-task-allow`, a debugging entitlement Apple's notary service rejects. With `signingIdentity` set (`-`, ad hoc, here), `hardenedRuntime` and an entitlements file, Tauri re-signs the sidecar, the shell and the bundle with that identity, the runtime flag and the file's entitlements, and the bundle passes `codesign --verify --deep --strict`. Node under the hardened runtime needs only `com.apple.security.cs.allow-jit`: the hub ran, and `fetch` to nodejs.org, a WebAssembly compile and `node:crypto` all worked. So Developer ID signing and notarization are a configuration change (an identity and the notary's credentials), not a build change; the notarization itself is untested until there is an identity.
- **The sidecar's name.** `node` would be installed as `/usr/bin/node` by a Linux package, beside the system's; the spike names it `armature-node`.
- **A universal macOS build** would carry both Nodes, about 216 MiB of the bundle; per-architecture disk images are the smaller choice.

### GitHub's runners (`.github/workflows/desktop-spike.yml`, run 42148533557, 2026-11-06)

Each runner builds the bundles, installs them as a person would (the macOS app as built, the Windows installer silently, the `.deb` with `dpkg`), and runs `spike-check.mjs` against the installed shell. Every case passed on all three.

| | macOS 15 arm64 | Windows Server x64 | Ubuntu 22.04 x64, under Xvfb |
|---|---|---|---|
| What a person downloads | `.dmg` 38 MiB | NSIS installer 24 MiB | `.deb` 47 MiB; AppImage 117 MiB |
| Launch to a listening hub, first (cold machine) | 6.1 s | 9.8 s | 0.50 s |
| Launch to a listening hub, after | 0.76 to 0.80 s | 0.92 to 0.98 s | 0.24 to 0.25 s |
| `stop` to the core's exit | 13 to 30 ms | 16 to 17 ms | 7 to 9 ms |
| The core, resident | 79 MiB | 60 MiB | 84 MiB |
| The shell killed outright | the core stopped itself, no lock left | the same | the same |
| The shell closed by the system | SIGTERM: the shell does nothing; the core stopped itself | `taskkill` (a WM_CLOSE): the shell's own graceful stop, 70 ms | SIGTERM: as macOS |
| The core killed, the shell running | the shell lived; the lock left and taken over next start | the same (exit code 1, no signal) | the same |

- **The cold first launch** is the one slow start: on macOS most of it is the first spawn of Node (2.8 s), which looks like the system checking a 108 MiB binary it has not run before; on Windows the shell took 8.5 s to reach its setup hook, before Node was started, so it is the webview's first start (WebView2). Neither recurs; a person sees it once after installing.
- **Windows' verbatim paths.** Tauri resolves a resource as `\\?\C:\...`; Node cannot load its entry script from such a path (`EISDIR` on `C:`), so the shell drops the prefix (the program would use the `dunce` crate). Found on the second run.
- **Windows' release build** has no console, but a parent that gives it pipes receives its output.
- **WebKitGTK under Xvfb** hung creating the webview until `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `WEBKIT_DISABLE_COMPOSITING_MODE=1`; a runner's display only, to be checked on a Linux desktop before it is said of one.
- **Linux packages** put the sidecar at `/usr/bin/armature-node` and the core at `/usr/lib/Armature Spike/core/core.mjs`.

### The Windows laptop

By `RUNBOOK-windows.md`, for what a runner cannot show (SmartScreen on an unsigned installer, a console window flashing, closing the window with its X): to come.
