# Browser extensions (unpacked)

The app can load an unpacked Chrome extension from a directory the user chooses,
into the **shared browser partition** (`persist:local-operator-browser`, the same
one every browser tab uses). `src/main/browser/extensions.ts` owns the registry
and the rules; `src/main/browser/extension-ui.ts` builds it against the real
session and the two native dialogs; `src/main/browser/ipc.ts` exposes five
operations to the renderer's Extensions sheet.

## What the model is, and what it is not

- **The user chooses a directory; no IPC operation can.** Every channel on
  this surface takes a key or a boolean and never a path, so the native directory
  chooser is the only way a path gets in. That is a claim about the IPC surface
  and not about the file — see *What the registry actually trusts* below, which
  is the half a reader could otherwise take as stronger than it is.
- **Approval covers a directory *and* the manifest read from it.** The canonical
  path and the manifest's SHA-256 are recorded at approval. A manifest edited
  afterwards stops loading until the user reviews the new permissions, and the
  canonical path is preserved because Chromium derives an unpacked extension's ID
  from it.
- **Code in an approved directory is trusted code.** This is not a signed-store
  updater: there is no signature check, no update channel, and no sandbox beyond
  Chromium's own extension sandbox. An extension runs with the profile's cookies
  and can read or change matching pages — including signed-in ones —
  independently of the agent's own site approvals.
- **Enable, disable and remove only ever touch registration metadata.** The
  registry is `<userData>/browser/extensions.json` (0600 inside a 0700
  directory). No code path deletes a source directory or clears extension
  storage.
- **Load failures fail closed.** A missing directory, an unreadable manifest, a
  changed manifest and a conflicting extension ID all leave the registration
  unloaded with a message, rather than falling back to something permissive.
## What the registry actually trusts

The bullet above describes the IPC surface, and the approval itself lives in a
place that is worth stating as plainly as the rest of this page: in
`<userData>/browser/extensions.json`, which is trusted *as the record of the
approval*, with nothing signing it and nothing re-asking. A row written by hand
— a `path`, any UUID, and the SHA-256 of that directory's own `manifest.json` —
is loaded at the next launch **with no dialog**, into the partition that holds
the user's authenticated sessions, where its code runs with that profile's
cookies. The digest is not a secret, so it is no obstacle to whoever wrote the
row; it exists to notice a manifest that *changed*, not to prove one was
approved. Both halves are reproduced in the committed runs:
`scripts/browser-extensions.test.mjs` ("the registry file IS the approval record:
a row written outside the app loads, with no dialog") and the `unbound.*`
observations in `scripts/browser-extensions-proof.mjs` — native, against the real
session, zero dialogs and `loadedInChromium: true`.

What that access is, is access **as this user**. The file is 0600 inside a 0700
directory, and anything able to write it can already write `approvals.json`
beside it — the site grants of #177, which have exactly the same property and no
authentication either — along with the browser profile, the app's settings and
the rest of the user-data directory. This directory is the app's trust boundary;
this surface sits inside it rather than being exempt from it.

The alternative, considered and deliberately not taken: seal each row with a key
held in the OS keychain (`safeStorage`) and refuse a row that does not open,
which is what review round 1 (R1) proposed. It is not here because the keychain
read has no failure mode this app can use. Measured on macOS: with the real home
directory the call returns in milliseconds, but with `HOME` redirected — which
`browser-extensions-proof.mjs` must do to isolate itself, and which is the same
shape as a locked keychain or a Linux session with no keyring —
`safeStorage.isEncryptionAvailable()` never returns at all: it raises a Keychain
authorization prompt on the machine's screen and waits for a human. A launch that
had to decrypt its registry before it knew what to load would therefore hang
where it should have failed closed, and the binding would trade the boundary
stated above for "same user with keychain access". The reproduction and the full
reasoning are on #192, recorded there as a deferred item rather than a fixed one.

## The capability matrix

Electron implements a **subset** of the Chrome extension APIs. The table below
separates what was measured from what was argued; every "supported" and
"not available" cell was produced by
`node scripts/browser-extensions-proof.mjs`, which bundles
`src/main/browser/extension-ui.ts` from the working tree, boots it in a real
Electron main process (Electron 44.3.0 / Chrome 152.0.7977.78, macOS 25.6.0),
and prints the observations quoted here. The run's transcript is the evidence;
the command is re-runnable.

The harness isolates itself the way this repository's other proof harnesses do:
a scratch `HOME`, config dir and `--user-data-dir`, every `CMUX_*`/`LOP_*`
variable stripped, and no window ever shown — each phase asserts at exit that no
window was visible, because the one thing an agent run must not do on this
machine is take the operator's focus. The two native dialogs (directory chooser,
approval) are the only stubbed surfaces, and each call is recorded with the text
it was shown, so the approval copy is inspected rather than assumed.

| Capability | State | Evidence |
| --- | --- | --- |
| Load an unpacked MV2/MV3 extension | supported | Chromium returned an ID (`/^[a-p]{32}$/`), `session.extensions.getExtension(id)` is truthy, and the ID is stable across disable/enable and across a process restart |
| MV3 service worker executes | supported | the fixture's `background.service_worker` wrote `chrome.storage.local` on boot; an extension page messaged it and got a reply |
| Content scripts (`content_scripts` with `matches`) | supported | ran in a page served over loopback and both set a DOM flag and wrote storage |
| `chrome.storage.local` | supported | a value written before the restart was read in a fresh process |
| `chrome.alarms` | partial | `create`/`getAll` work and a ~30 s alarm was delivered sub-millisecond after its scheduled time in both recorded runs — `alarms.firedDeltaVsScheduleMs` was 0.536 ms and 1.0 ms, so the number belongs to a run and not to the platform. The service-worker listener recorded nothing in the same window, so delivery to a **suspended** worker is unverified — do not rely on an alarm waking a worker |
| `chrome.action` default popup | partial | the app opens the declared popup as a sandboxed, hidden `BrowserWindow` on the extension's own origin; toolbar integration, active-tab grants and action-click dispatch do not exist |
| `chrome.tabs`, `chrome.i18n`, `chrome.runtime` messaging | present | `typeof` measured `object`/`function`; only `runtime` messaging was exercised (round trip above) |
| `chrome.scripting` | not available | `typeof chrome.scripting` is `undefined` — no programmatic injection |
| `chrome.declarativeNetRequest` | not available | `undefined` — no network-level request blocking |
| `chrome.cookies`, `webNavigation`, `commands`, `identity`, `notifications`, `contextMenus`, `bookmarks`, `history`, `downloads`, `webRequest`, `permissions`, `offscreen` | not available | each measured `undefined` in a loaded extension's own page; the full list is the `chromeApis` record in the run's transcript |
| Permission-gated APIs follow the manifest | supported | `chrome.storage` and `chrome.alarms` read `undefined` in a page whose manifest does not declare them and are present once it does; the same gate governs `nativeMessaging` above |
| Native messaging | **refused by the platform** | the API *is* exposed once `nativeMessaging` is declared (`connectNative` returns a port object), but `sendNativeMessage` calls back with `lastError`: *"Access to the native messaging host was disabled by the system administrator."* |
| Chrome Web Store install and updates | not available | unpacked directories only; there is no store client and no update path |
| File access | not granted | the loader is called with `allowFileAccess: false` |
| Sign in once, reuse across conversations and restarts | supported (shared profile) | a cookie with an expiry, written in one process, was read in the next; so was the extension's own storage |

## The 1Password-class limitation, plainly

**A password manager that talks to its desktop app over native messaging cannot
work here.** 1Password's browser extension requires that channel for unlock
state, autofill data and its companion-service handoff; Electron refuses every
native messaging host connection (measured above), and there is no override.

What *is* true, and should not be overstated in either direction:

- **The extension was never actually tested.** The real 1Password extension was
  not loaded in this environment, so its standalone behaviour — popup rendering,
  vault browsing, anything it does without the desktop app — is **unknown**, not
  refused. Some of it may well render; none of it was measured.
- **The login path that does work is the shared profile.** Sign in on a site once
  in the app's browser and the session survives restarts and is visible to every
  tab, which covers a password manager's *purpose* for simple logins even though
  its desktop integration cannot work.
- **Capabilities MV3 needs are mixed, and the split matters.** A worker,
  declarative content scripts, storage and messaging are supported; alarms are
  partial (above); `chrome.scripting` and `declarativeNetRequest` are absent.
  Anything built on programmatic injection or request blocking — uBlock-class
  content blockers, most "click to fill" flows — is out of reach rather than
  untested.

The app's own copy says this in the sheet: *"Chrome extension support is
partial"*, plus the specific warnings for a popup-less action and for popup
semantics that differ from Chrome. Those strings are built in
`src/main/browser/extensions.ts` and shown in the approval dialog before anything
loads.

## What is still unverified

- Delivery of an alarm to a suspended service worker (above).
- Any extension other than the fixtures in the proof harness — in particular the
  real 1Password extension and any content blocker.
- `chrome.tabs` and `chrome.i18n` beyond their presence.
- MV2 (the manifest shape is accepted; only MV3 was exercised end to end).
- The visible browser flow's own UX review: the sheet's rendered states are in
  `docs/evidence/browser-extensions-sheet/`, but driving the *live* flow (chooser
  → approval → load) needs a dev harness that another workstream is building.

## One rough edge, measured and left alone

A `manifest.json` that is not JSON at all reaches the user as the parser's own
message — `Expected double-quoted property name in JSON at position 43 (line 1
column 44)` — because `inspectExtension` runs `JSON.parse` before the shape check
that produces the manager's own sentence. A manifest that *is* JSON but carries
an unsupported `manifest_version` gets the friendly message. The raw parse error
is not a security problem (the extension does not load either way), it is copy a
user cannot act on, and it is recorded here rather than fixed inside the
verification change because the two paths are the manager's error surface and
changing it belongs with a review of that surface. **It is now the only Node
message left on this surface**: review round 1's R2 was the `statSync(ENOENT)`
one beside it, and that now reports "This directory has no manifest.json", with
the missing-directory case above it saying "The extension directory is missing."
