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

### Windows and Linux

From `.github/workflows/desktop-spike.yml` on GitHub's runners, then the Windows laptop by `RUNBOOK-windows.md`: to come.
