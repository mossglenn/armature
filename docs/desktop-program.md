# Armature Desktop

For the person who installs it: a designer, a reviewer, anyone whose tools work on their own computer against their institution's Armature. How it is built is in [the plan](desktop-program-plan.md) and ADR-0069; the side of whoever runs the instance is in [`deployment.md`](deployment.md) § "An instance under `oidc`".

> **The names here are the ones the app uses since 0.1.5** (`@armature/vocabulary`; the reasoning is [`naming-vocabulary.md`](naming-vocabulary.md)). Version 0.1.4 and earlier show older labels for the same things:
>
> | Since 0.1.5 | In 0.1.4 and earlier |
> |---|---|
> | Update from main | Bring in main |
> | Merge into main; Preview merge | Deliver; Ask what a delivery would find |
> | Create workspace | Make the workspace |
> | 3 to push; Changed elsewhere; Offline | 3 unpushed; The remote moved; Remote unreachable |
> | your instance, or its own name | the remote |
> | this computer | this machine |
> | Look up | Read |
> | pairing key; New pairing key | pairing value; Reset the pairing |
> | your ID | your identifier |
> | Personal checks; On | Checks of your own; In force |
> | override, overridden | set aside |
> | Diagnostics | Log |
> | Look for a new version; Try again | Check for updates; Check again |

> **Versions after 0.1.5 link each workspace to one computer and send its work by a merge request** (ADR-0072, built 2026-11-20 and in no released version yet). Where this guide says so, 0.1.5 and earlier differ:
>
> | In versions after 0.1.5 | In 0.1.5 and earlier |
> |---|---|
> | Open merge request into main; Merge; Close | Merge into main |
> | the merge request's health, kept current | Preview merge |
> | Link to this computer; Your unlinked workspaces | Clone a branch |
> | Unlink from this computer; Unlink from the other computer | (nothing: a workspace could be written from two computers, and then be unable to push) |

## What it does

Your instance of Armature keeps the design graph on a server. Armature Desktop, the desktop app, keeps your own copy of the part you are working on, a **workspace**, on your computer, so your tools (an item editor, an AI assistant, a course builder) read and write it quickly and keep working when you are offline. A tool records each change you make as a **commit**: a recorded change, with who made it, when and why. When you are ready, the app sends your work to the instance: you **push** your commits, **update from `main`** to take in what others have merged since, and open a **merge request** into `main`, the instance's shared design, which whoever may merge into `main` then merges.

Each workspace is a branch on the instance with your name on it, linked to this computer: only the app here writes it. Nothing you do in a workspace reaches anyone else until you push.

## Installing it

Download the app from your instance's "Work from your own computer" page, or from [the releases](https://github.com/mossglenn/armature/releases): the newest `Armature Desktop` release (`Armature desktop` up to 0.1.4), the file for your system.

| System | File | Notes |
|---|---|---|
| macOS on Apple silicon (M1 and later) | `Armature_<version>_aarch64.dmg` | Open it and drag Armature into Applications |
| macOS on Intel | `Armature_<version>_x64.dmg` | The same |
| Windows 10 or 11 | `Armature_<version>_x64-setup.exe` | Installs for you alone; needs no administrator of the computer |
| Linux | `Armature_<version>_amd64.AppImage`, or the `.deb` | The AppImage installs new versions itself; a `.deb` is replaced by installing the next one |

**The first time you open it,** your system warns that it does not know who made the app, since these builds are not yet signed by Apple or Microsoft. The app's new versions are signed and verified before they install; only the first install asks you to vouch for it.

- **macOS:** open Armature from Applications. When macOS says it cannot verify the app, choose **Done**, then open **System Settings → Privacy & Security**, scroll to the line about Armature, and choose **Open Anyway**. If macOS instead says the app "is damaged", it was quarantined by the browser that downloaded it: run `xattr -dr com.apple.quarantine /Applications/Armature.app` in Terminal, then open it again. Once it is open, macOS may ask for your login password so that Armature can use the items it keeps in your keychain (your sign-in and the pairing key): enter it and choose **Always Allow**. Until the app is signed by Apple, macOS may ask this again after a new version installs, since it ties those items to the exact build that made them.
- **Windows:** when SmartScreen says "Windows protected your PC", choose **More info**, then **Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x Armature_*.AppImage`) and run it; or `sudo apt install ./Armature_*.deb`.

## Connecting to your instance

The app opens on **Connect**. The easiest way in is the link on your instance's "Work from your own computer" page, which opens the app with the address filled in; or paste the address you were given (it usually begins `https://api.`) and choose **Look up**.

The app shows the **instance details**: the instance's name, the address you gave, and who signs you in. Read them before you choose **Connect**: a link can come from anywhere, and the app connects to nothing until you confirm. The address shown is always the one you typed or the link brought; if the instance says its address is a different one, the app warns you, and you should connect only if the address you gave is the one you were given. Changing the address withdraws what was shown, and the app connects only to exactly what it showed you: an instance whose details have changed by the time you connect is refused (`profile_changed`), so look it up again.

An instance that says **"No sign-in (for testing only)"** is for development or rehearsal, not for real work; the app then asks for your ID on that instance instead of signing you in. Since version 0.1.4 it asks the instance whether it knows that ID and tells you when it does not, there and under **Settings**, where the ID can be corrected: nothing can be created, pushed or merged as an ID the instance does not know, so either correct it or ask an administrator of the instance to register you. The ID is kept as you typed it either way.

## Signing in

**Sign in** opens your browser at your institution's sign-in page. While the app waits for you there, **Cancel the sign-in** ends the wait, for when you closed the tab or changed your mind; if you leave the page and come back, it tells you a sign-in is still waiting. Once you have signed in there, the browser says you can return to the app, and the app shows who the instance knows you as. You stay signed in across restarts: the app keeps your sign-in in your system's keychain (the macOS Keychain, the Windows Credential Manager, or the Secret Service on Linux), never in a file. **Settings → Sign out** removes it; if the keychain refuses to give it up, the app says so, since you would otherwise be signed in again at the next start. Signing out also asks your sign-in provider to end the kept sign-in, where the provider offers that (since 0.1.5); a provider that does not, or cannot be reached, changes nothing about the sign-out here. Your sign-in is kept for your instance and its sign-in provider together, so if your instance changes its provider you sign in again. After moving up from version 0.1.2 or earlier you sign in once, for the same reason. The app signs in only at a provider reached over `https`.

## Your workspaces

**Workspaces** lists yours, each with what is waiting: how many commits there are **to push**, and whether its branch was **changed elsewhere**. "Changed elsewhere" means the workspace's own branch on the instance has commits this computer did not push. It does not say whether `main` has new work; **Update from main** finds that out.

- **New workspace** creates one from `main` (or from another branch, its *parent*): give it a short name, such as `unit-3`, and choose **Create workspace**. The branch on the instance is named after you and it, for example `jdoe_unit-3`. A workspace takes updates from its parent and sends its merge requests there, and the page names it: "Update from main" for a workspace made from `main`. Nothing is made from another workspace.

**A workspace is linked to one computer** (versions after 0.1.5). The instance takes writes to it only from the app on that computer, so the same workspace is never written from two places, which until then could leave commits that could never be pushed. A colleague's workspace is not copied to your computer: read it on the instance, and to work alongside them, each of you works in your own workspace and opens merge requests into the same branch. To work on your own workspace from another computer, move it, in two steps:

- **Unlink from this computer**, on the workspace's page, once everything is pushed. The copy here goes, since everything in it is on the instance, where the workspace stays, linked to no computer.
- **Link to this computer**, on the other computer, under **Your unlinked workspaces** on the Workspaces page, which lists yours that are on the instance and on no computer.

Linking never takes a workspace away from the computer it is on. If that computer is lost, broken or out of reach, the Workspaces page lists the workspace under **Linked to another computer**, with the name you gave that computer and the date, and offers **Unlink from the other computer**. It asks you to confirm, because commits on that computer that were not pushed can no longer be pushed: if you get it back, the workspace's page there says so, and **Discard and remove** is the way on. So that you can tell your computers apart in that list, **Settings** has **A name for this computer**; it is kept on your instance, where everyone it serves can read it, so nothing is sent unless you give one.

Open a workspace to work with it:

- **Push** sends your commits to the instance. Your tools commit as you work; nothing leaves your computer until you push.
- **Update from main** merges what others have merged into `main` into your workspace, so you merge against the current design. If your work and theirs changed the same thing, the app lists each conflict, field by field, with the starting point, your workspace's value and `main`'s, and says which tool to open to resolve it.
- **Open merge request into main** asks for what you have pushed to be merged into `main`, with a message saying what it holds, which becomes the merge's own. Anyone may ask for their own workspace. While the request is open the page shows its **health**, what a merge would meet right now: **Ready to merge**, **Has conflicts**, **Breaks rules**, **Waiting for checks** or **Checks failed** (the required checks of your instance, below). The instance works it out each time, and the page reads it again whenever your workspace, `main` or the request changes there, so it is current without your asking. A conflict is resolved in your workspace: update from `main`, resolve it in your tool, and push. **Merge** merges it, if you may merge into `main`; if you may not, whoever may does so on the instance, and the page shows when they have. **Close** ends the request without merging. In 0.1.5 and earlier this was **Merge into main**, which only a maintainer could use, and **Preview merge**.
- **Remove from this computer** takes the workspace off your computer, once everything is pushed. Its branch on the instance is deleted too when its parent already has all of it, as after a merge; otherwise it stays there, linked to no computer, and can be linked again. The app says which happened.
- **Discard and remove** is for a workspace with commits that can never be pushed: the instance is gone, your role on the branch was removed, the workspace was unlinked from this computer while it was away, or a push keeps being refused. It appears under the removal whenever there are commits to push, says how many you would give up, and asks you to confirm that number. It works offline and signed out; the instance keeps whatever you had pushed, and when it can be reached the app also clears this computer's link there, so the workspace can be linked again. Nothing is erased outright: the workspace's files are moved to the discarded folder, `_discarded` inside your workspaces folder, first (the message says where). The app never reads that folder again, so empty it when you are sure you no longer want what is in it. If you can still push, push instead.

## Your tools and the pairing key

Your tools find the app's hub, the desktop hub, at `http://127.0.0.1:3101` while the app runs. A tool that writes needs the **pairing key**: open **Pairing**, choose **Copy**, and paste it where the tool asks for its Armature pairing key. The key is covered on the page until you choose **Show**, and **Copy** works either way (since 0.1.5; before, it was always shown). The key stays the same across restarts. **New pairing key** makes a new one, after which every paired tool needs it; use it if the key was shared by mistake.

Under **Pairing** too is your ID on the instance, which your tools send to say who they work for and the instance resolves to you; when the app cannot show it yet, the page says what is missing (a sign-in, or your ID in the settings).

## Where things are kept

Your workspaces are in the workspaces folder: by default inside the app's data folder, or wherever **Settings** names. Keep it out of a folder that Dropbox, OneDrive, iCloud Drive or Google Drive copies to the cloud: two computers writing one workspace through such a service can damage it, and the app warns when the folder looks like one of theirs. Since 0.1.5 the warning also follows a link into such a folder, and knows a Mac's Desktop and Documents folders when iCloud keeps them (the "Desktop & Documents Folders" setting).

The folder you name in **Settings** must be empty, or one that already holds this app's workspaces: the app clears leftover temporary files from its folder at every start, and in a folder of other things it could remove some that are not its own, so a folder with other files in it is refused (`folder_in_use`; since 0.1.5). Naming another folder does not move your workspaces. They stay where they were, with any commits to push, and the app will find none in the new folder; the settings page says so when you save. Merge or remove them first, or move the old folder's contents to the new place before the hub starts again.

| | macOS | Windows | Linux |
|---|---|---|---|
| Data (settings, workspaces) | `~/Library/Application Support/com.mossglenn.armature` | `%LOCALAPPDATA%\com.mossglenn.armature` | `~/.local/share/com.mossglenn.armature` |
| The diagnostic log (one file a day, seven kept) | `~/Library/Logs/com.mossglenn.armature` | `%LOCALAPPDATA%\com.mossglenn.armature\logs` | `~/.local/share/com.mossglenn.armature/logs` |

**Diagnostics** shows the latest lines of the diagnostic log and opens its folder; the files are what to send with a report of a problem. A day's file stops at 16 MB and says so on its last line (since 0.1.5); the page goes on showing the lines that follow.

If the settings file (`settings.json` in the data folder) cannot be read, the app still starts (since 0.1.5; before, it refused to until the file was corrected or removed). A setting it does not know or cannot use is left out and named in the diagnostic log, and the rest stand. A file that is not readable at all is moved aside, kept beside it as `settings.json.unreadable-<time>`, and the app starts as new: connect again, and name your workspaces folder again if you had chosen one. Your workspaces are untouched either way.


## Checks

*In the app since version 0.1.3.*

A *check* is a tool that examines your work and reports on it, a design linter for one. The app runs no checks itself and knows no design rules; it waits for each check's report and shows its **result**: Passed, Failed, Neutral (it reported without passing or failing) or Could not run.

**Required checks.** Your instance may require checks before work is merged into `main`. The instance enforces those. An open merge request shows each in its health (versions after 0.1.5), and a merge the instance stops lists each check under the refusal: whether it has reported yet, its result, and its own summary and the address of its details. `checks_pending` means a check is waiting for a report on your latest commit, so wait and merge again. `checks_failed` means one failed. Whoever may merge may **override** a check by giving a reason beside it and choosing **Merge anyway**; the reason is recorded on the merge into `main`, with your name. A check marked *locked* can be overridden only by an administrator.

**Personal checks.** You can also require checks of your own pushes. Open **Settings**, and under **Personal checks** choose **Add a check**:

- **Check** is the name the tool reports under, such as `lint/mine`.
- **Workspace** binds it to one workspace, or to every workspace.
- **When it has not passed** either stops the push or lets it go on and says so.
- **The tool's settings** are whatever that tool reads, as JSON; write `{}` for none. The app stores them and never reads them.

Choose **Save checks**. Nothing restarts: the next push reads them. While a check is on, a push waits until that tool has reported on your latest commit, and is refused if the check failed. Since the checks are yours, you may always override one: give a reason beside it and choose **Push anyway**. The reason travels with the push as your own statement on its first commit. To stop a check for a while, clear **On** and save. To take one away, choose **Remove** on it and then **Save checks**: nothing here is written until you save, a removal included, and until then the check still stops your pushes. Since version 0.1.4 the page says what you have removed, added or changed and not yet saved; leaving the page without saving drops those changes.

The checks are kept in a file named `checks.json` in the workspaces folder, which you may also edit by hand:

```
{ "requirements": [ { "check": "lint/mine", "params": { } } ] }
```

Only the app and you can change that file. No tool can change it through the hub, so no tool can relax what you asked. If the file is edited into something the app cannot read, nothing is pushed until it is put right: the push says where the problem is, and saving on the Settings page replaces the file.

## In the background

Closing the window does not stop the app: it stays in the tray (the menu bar on macOS), so your tools keep their hub. The tray icon opens the window, pauses or resumes the hub, and quits. Quitting stops the hub cleanly first. If the hub's own process ends unexpectedly, the window says so and **Start the hub** starts it again (since 0.1.5; before, the way back was to quit and open the app again).

**Settings → Start at login** starts the app when you sign in to your computer, in the tray without a window. It is off until you turn it on. If your system refuses the entry, the settings page says so beside the box, and the box still shows what you chose; the app tries again at its next start. The app makes the entry again each time it starts, so it follows the app if you move it. *In versions up to 0.1.3* it did not: if you moved the app after turning this on, the entry kept pointing at the old place and the app did not start when you signed in; turning the box off and on again puts it right there, and version 0.1.4 does it itself. A new version you install in such a session brings the window back when the app starts again.

## New versions

The app looks for a new version when it starts and once a day. When there is one, a notice at the top of the window says which version, with its notes; choose **Install and restart** when it suits you. The hub stops while the new version installs, which takes a few seconds, and your tools reach it again once the app is back. While a push, an update from `main`, a merge, a clone or a removal is running, the button waits for it, and so does quitting (up to half a minute), so nothing is cut off under it. **Settings → Look for a new version** looks at once.

Version 0.1.3 asks you to sign in once more after it installs: the sign-in the app keeps is now tied to the sign-in provider that issued it, and the one an earlier version kept is removed rather than trusted. Your workspaces and your commits to push are untouched.

On macOS, the first start after a new version installs may ask for your login password for the keychain again; enter it and choose **Always Allow** (§ "Installing it" says why). A new version is installed only if its signature verifies. If an install fails, or a download goes a minute without receiving anything, the app keeps running the version you have, says why, and offers to try again. If the release channel cannot be reached, or answers without a release, the app says so rather than calling your version the latest, and tries again within the hour. A `.deb` install does not look at the channel at all: install the next package when one is released, as the table above says.

## When something is refused

Every refusal shows its words first, then a code and who refused it: your instance, by its name, or this computer. The ones you are most likely to meet:

| Code | What it means | What to do |
|---|---|---|
| `remote_unreachable` | Your instance cannot be reached | Look at your connection; offline, everything but pushing, updating from `main`, merging and removing still works. Behind an institution's TLS inspection the app trusts the certificate authorities your system trusts, as your browser does (since 0.1.1); if your browser reaches the instance and the app does not, ask whoever runs your instance for the authority's certificate and set `NODE_EXTRA_CA_CERTS` to its file |
| `insecure_remote` | An instance that signs people in was given as `http://` | Use its `https://` address |
| `profile_changed` | The instance's details changed since you looked them up | Choose **Look up** again and read what it shows before connecting |
| `not_registered` | You signed in, but the instance does not know you | Ask an administrator of your instance to register you. Your sign-in is kept (since 0.1.5): once you are registered, choose **Try again** on the sign-in page, with no need to sign in again |
| `sign_in_refused`, `sign_in_timeout` | The sign-in did not complete in the browser | Sign in again |
| `issuer_unreachable` | Your institution's sign-in provider did not answer, or answered that it is busy or restarting | Try again shortly. You stay signed in: nothing is removed |
| `insecure_issuer` | The instance names a sign-in provider that is not reached over `https` | Tell whoever runs your instance; the app will not sign in there |
| `signed_out` | The instance no longer accepts your sign-in | Sign in again |
| `unsupported_version` | Your instance is too old for this version of the app | Ask whoever runs your instance to bring it up to date |
| `unpushed_commits` | There are commits to push | Push first. If the message says an earlier update from `main` was not finished and names records changed on both sides, pushing will not clear it, and the app has no way on from there yet; the work stays in the workspace's folder |
| `bring_in_first` | Update from `main` first: `main` has work your workspace has not taken in | Choose **Update from main**, then merge |
| `held_elsewhere` | Linked to another computer: the instance takes this workspace's commits only from the computer it is linked to (versions after 0.1.5) | Work on it there. Or unlink it from that computer, there or from the Workspaces page here, and link it to this one. Commits here that were not pushed can no longer be pushed: **Discard and remove**, then link it again |
| `not_linked` | Not linked to this computer: the workspace was unlinked, here or from another computer, and is linked to none | **Remove from this computer** (or **Discard and remove**, with commits that were not pushed), then **Link to this computer** on the Workspaces page |
| `request_open` | The workspace already has an open merge request into that branch | Its page shows it: merge it, close it, or leave it for whoever may merge |
| `nothing_to_merge` | The branch already has everything pushed from this workspace | Push more work, or close the request |
| `parent_is_workspace` | A new workspace was asked from a workspace | Create it from a branch, `main` for one |
| `forbidden` | You may not do this on that branch; its reason says why | The message names who can |
| `checks_pending` | A check is waiting for a report: a required check of your instance before a merge, or a personal check before a push | Wait for the check to run, then try again; or override it with a reason beside the check (see "Checks") |
| `checks_failed` | A required check failed | Read what the check found, at the address it gives, and fix it; or override it with a reason beside the check (see "Checks") |
| `personal_checks_invalid` | The app cannot read your `checks.json` | Open **Settings**, which lists the problems, and save your checks again; or correct or remove the file by hand |
| `discard_mismatch` | The number of commits to push changed after the app showed it to you, usually because a tool wrote meanwhile | Read the new number and confirm again, or push |
| `workspaces_exist` | You asked to connect elsewhere while workspaces exist | Merge or remove them first |
| `other_remote` | The workspace was created from another instance than the one the app is connected to now, which can happen after the workspaces folder was changed and changed back | Connect to the instance the message names to push or merge it; or remove it from this computer, which touches nothing on either instance |
| `folder_in_use` | The folder named for the workspaces holds other files | Choose an empty folder, or the folder your workspaces are already in |
| `port_in_use` | Something else on this computer holds the port | The app opens on **Settings**: choose another port, save, and choose **Start the hub** |
| `folder_locked` | Another copy of the app, or another hub, holds the workspaces folder | Quit the other one |

## Removing the app

Merge or push what you want to keep, turn off **Settings → Start at login** if you turned it on (on macOS and Linux the system's entry would otherwise outlive the app), then quit the app and remove it as you would any other (drag it to the Trash on macOS; **Settings → Apps** on Windows; delete the AppImage or `sudo apt remove armature` on Linux). Its data and its diagnostic log stay in the folders above until you delete them, and its keychain items (service `com.mossglenn.armature`) until you remove them in your system's keychain.
