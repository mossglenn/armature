# The Armature desktop program

For the person who installs it: a designer, a reviewer, anyone whose tools work on their own machine against their institution's Armature. How it is built is in [the plan](desktop-program-plan.md) and ADR-0069; the administrator's side is in [`deployment.md`](deployment.md) § "An instance under `oidc`".

## What it does

Your instance of Armature keeps the design graph on a server. The desktop program keeps your own copy of the part you are working on, a **workspace**, on your machine, so your tools (an item editor, an AI assistant, a course builder) read and write it quickly and keep working when you are offline. When you are ready, the program sends your work to the instance: you **push** it, **bring in** what others have put on `main` since, and **deliver** it to `main` for a maintainer to see.

Each workspace is a branch of the instance's graph with your name on it. Nothing you do in a workspace reaches anyone else until you push.

## Installing it

Download the program from your instance's "Work from your own machine" page, or from [the releases](https://github.com/mossglenn/armature/releases): the newest `Armature desktop` release, the file for your system.

| System | File | Notes |
|---|---|---|
| macOS on Apple silicon (M1 and later) | `Armature_<version>_aarch64.dmg` | Open it and drag Armature into Applications |
| macOS on Intel | `Armature_<version>_x64.dmg` | The same |
| Windows 10 or 11 | `Armature_<version>_x64-setup.exe` | Installs for you alone; no administrator needed |
| Linux | `Armature_<version>_amd64.AppImage`, or the `.deb` | The AppImage updates itself; a `.deb` is updated by installing the next one |

**The first time you open it,** your system warns that it does not know who made the program, since these builds are not yet signed by Apple or Microsoft. The program's updates are signed and checked before they install; only the first install asks you to vouch for it.

- **macOS:** open Armature from Applications. When macOS says it cannot verify the program, choose **Done**, then open **System Settings → Privacy & Security**, scroll to the line about Armature, and choose **Open Anyway**. If macOS instead says the program "is damaged", it was quarantined by the browser that downloaded it: run `xattr -dr com.apple.quarantine /Applications/Armature.app` in Terminal, then open it again. Once it is open, macOS may ask for your login password so that Armature can use the items it keeps in your keychain (your sign-in and the pairing value): enter it and choose **Always Allow**. Until the program is signed by Apple, macOS may ask this again after an update, since it ties those items to the exact build that made them.
- **Windows:** when SmartScreen says "Windows protected your PC", choose **More info**, then **Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x Armature_*.AppImage`) and run it; or `sudo apt install ./Armature_*.deb`.

## Connecting to your instance

The program opens on **Connect**. The easiest way in is the link on your instance's "Work from your own machine" page, which opens the program with the address filled in; or paste the address your administrator gave you (it usually begins `https://api.`) and choose **Read**.

The program shows what it found: the instance's name, the address you gave, and who signs you in. Check them before you choose **Connect**: a link can come from anywhere, and the program connects to nothing until you confirm. The address shown is always the one you typed or the link brought; if the instance says its address is a different one, the program warns you, and you should connect only if the address you gave is the one your administrator gave you. Changing the address withdraws what was shown, and the program connects only to exactly what it showed you: an instance that answers differently when you connect is refused (`profile_changed`), so read it again.

An instance that says **"No sign-in: you say who you are"** is a development or rehearsal arrangement, not one for real work; the program then asks for your identifier instead of signing you in.

## Signing in

**Sign in** opens your browser at your institution's sign-in page. Once you have signed in there, the browser says you can return to the program, and the program shows who the instance says you are. You stay signed in across restarts: the program keeps its credential in your system's keychain (the macOS Keychain, the Windows Credential Manager, or the Secret Service on Linux), never in a file. **Settings → Sign out** removes it.

## Your workspaces

**Workspaces** lists yours, each with what is waiting: how many commits are not yet pushed, and whether `main` has moved on the instance.

- **Make a workspace** from `main` (or from another branch): give it a short name, such as `unit-3`. The branch on the instance is named after you and it, for example `jdoe_unit-3`.
- **Clone a branch** the instance already has, a colleague's for instance. If you may not write to it, the program says so and makes the workspace anyway, for reading.

Open a workspace to work with it:

- **Push** sends your commits to the instance. Your tools commit as you work; nothing leaves your machine until you push.
- **Bring in `main`** merges what others have delivered into your workspace, so you deliver against the current design. If your work and theirs changed the same thing, the program lists each conflict, field by field, and says which tool to open to resolve it.
- **Deliver** merges your workspace into `main`, with a message saying what it holds. Only a maintainer of `main` can deliver; anyone else is told whom to ask.
- **Remove** deletes the workspace from your machine, once everything is pushed. Its branch on the instance is deleted too when `main` already holds all of it, and kept otherwise.

## Your tools and the pairing value

Your tools find the program's hub at `http://127.0.0.1:3101` while the program runs. A tool that writes needs the **pairing value**: open **Pairing**, choose **Copy**, and paste it where the tool asks for its Armature pairing value. The value stays the same across restarts. **Reset** draws a new one, after which every paired tool needs the new value; use it if the value was shared by mistake.

Under **Pairing** too is the identifier your tools send to say who they work for, which the instance resolves to you.

## Where things are kept

Your workspaces are in the workspaces folder: by default inside the program's data folder, or wherever **Settings** names. Keep it out of a folder that Dropbox, OneDrive, iCloud Drive or Google Drive keeps in sync: two machines writing one workspace through a sync client can damage it, and the program warns when the folder looks like such a folder.

| | macOS | Windows | Linux |
|---|---|---|---|
| Data (settings, workspaces) | `~/Library/Application Support/com.mossglenn.armature` | `%LOCALAPPDATA%\com.mossglenn.armature` | `~/.local/share/com.mossglenn.armature` |
| Logs (one file a day, seven kept) | `~/Library/Logs/com.mossglenn.armature` | `%LOCALAPPDATA%\com.mossglenn.armature\logs` | `~/.local/share/com.mossglenn.armature/logs` |

**Log** shows the latest lines and opens the log folder; the files are what to send with a report of a problem.

## In the background

Closing the window does not stop the program: it stays in the tray (the menu bar on macOS), so your tools keep their hub. The tray icon opens the window, pauses or resumes the hub, and quits. Quitting stops the hub cleanly first.

**Settings → Start at login** starts the program when you sign in to your computer, in the tray without a window. It is off until you turn it on.

## Updates

The program checks for a new version when it starts and once a day. When there is one, a notice at the top of the window says which version, with its notes; choose **Install and restart** when it suits you. The hub stops while the update installs, which takes a few seconds, and your tools reach it again once the program is back. **Settings → Check for updates** checks at once.

On macOS, the first start after an update may ask for your login password for the keychain again; enter it and choose **Always Allow** (§ "Installing it" says why). An update is installed only if its signature verifies. If an install fails, or a download goes a minute without receiving anything, the program keeps running the version you have, says why, and offers to try again. If the release channel cannot be reached, or answers without a release, the program says so rather than calling your version the latest, and tries again within the hour.

## When something is refused

Every refusal shows the message, a code and whether your instance or this machine gave it. The ones you are most likely to meet:

| Code | What it means | What to do |
|---|---|---|
| `remote_unreachable` | The instance did not answer | Check your connection; offline, everything but push, bring in, deliver and remove still works |
| `insecure_remote` | An instance that signs people in was given as `http://` | Use its `https://` address |
| `profile_changed` | The instance answered differently when you connected than when you read it | Choose **Read** again and check what it shows before connecting |
| `not_registered` | You signed in, but the instance does not know you | Ask your administrator to register you |
| `sign_in_refused`, `sign_in_timeout` | The sign-in did not complete in the browser | Sign in again |
| `signed_out` | The instance no longer accepts your sign-in | Sign in again |
| `unsupported_version` | The instance is older than this program | Ask your administrator to update it |
| `unpushed_commits` | Something waits to be pushed | Push first |
| `bring_in_first` | `main` has moved since you last brought it in | Bring in `main`, then deliver |
| `forbidden` | You may not do this on that branch; its reason says why | The message names who may |
| `workspaces_exist` | You asked to connect elsewhere while workspaces exist | Deliver or remove them first |
| `port_in_use` | Another program holds the port | Choose another port in **Settings** and restart the hub |
| `folder_locked` | Another copy of the program, or another hub, holds the workspaces folder | Quit the other one |

## Removing the program

Deliver or push what you want to keep, then quit the program and delete it as you would any other (drag it to the Trash on macOS; **Settings → Apps** on Windows; delete the AppImage or `sudo apt remove armature` on Linux). Its data and logs stay in the folders above until you delete them, and its keychain items (service `com.mossglenn.armature`) until you remove them in your system's keychain.
