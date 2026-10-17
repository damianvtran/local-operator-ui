# The account-policy row (`retry.accountSelectionPolicy`), the row this slice classifies

**Claim.** The row this change classifies has frames and readings a reviewer can
check: it is NOT in the Basic surface, search reaches it by its canonical key
while the tier is still off, the deep link then reveals the tier, opens its
section, scrolls and focuses the row — and a change driven through the row's own
enum is SAVED and read back from the daemon that owns the copy.

## Why a live-app set rather than a Storybook cell

The row's whole point in this slice is that the BACKEND owns it: the tier map
classifies a key the daemon serves, its label, help and choices are the
daemon's answer, and the write it accepts is the daemon's YAML. The story sweep
renders the fixture registry offline, so it can draw the row but cannot show any
of that — and there is no offline way to show a save reaching a real daemon and
coming back. This set is the supported way: the BUILT app from this branch's
tree, booted `headless` against an ISOLATED `local-operator serve` this lane
started on its own scratch port, photographed by the app itself with
`webContents.capturePage()`, with every reading on the page compared against the
daemon's own `GET /v1/settings` answer.

## What produced these frames

One scene run, after the app was built from this branch's tree — FIRST captured at
this branch's pre-rebase tip (`6d071ae02`), then RE-CAPTURED on the rebased head
(`3a7a4bd58`, the tree that ships) — the app's `src/` is that tree's; the scene
itself is `scripts/`-only:

```sh
# 1. the app, built for the port this run owns (never 1111)
#    pnpm 10.29.2 (PATH's 12.6.0 breaks packaging); four synthetic VITE_* OAuth
#    values, which scripts/vite-plugins/replace-backend-config.ts refuses to
#    compile without and which no frame is a function of (a driver run never
#    signs in)
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18437 pnpm build

# 2. the isolated daemon: the FROZEN core v0.73.10 clone this lane serves, its
#    own scratch HOME/config/logs, loopback only, `values: {hosting: test,
#    model_name: mock-model}` written to <config>/config.yml BEFORE the boot (a
#    fresh root the flags do not teach its hosting dies on every turn), and a
#    token generated for this lane:
mkdir -p "$S/config" "$S/home" "$S/logs"
cat >"$S/config/config.yml" <<'YAML'
values:
  hosting: test
  model_name: mock-model
YAML
# <config>/run/serve is where the daemon's own record lands (--backend-records)
env -u XPC_FLAGS HOME="$S/home" LOCAL_OPERATOR_HOME="$S/home" \
  LOCAL_OPERATOR_CONFIG_DIR="$S/config" LOCAL_OPERATOR_LOG_DIR="$S/logs" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  <core-v0.73.10>/.venv/bin/local-operator serve --host 127.0.0.1 --port 18437 --hosting test --model mock-model

# 3. the run (`--scene settings-account-policy`, added by this change)
LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" node scripts/renderer-driver.mjs \
  --scene settings-account-policy --backend http://127.0.0.1:18437 \
  --backend-records "$S/config/run/serve" --seed-onboarding-complete \
  --out <dir>
```

The run reported **ALL CHECKS PASSED** (0 FAIL; 10.5s on the first capture,
10.2s on the re-capture) at the default 1380x900,
with the harness's own isolation readings: `the app holds a connection to this
run's backend (http://127.0.0.1:18437)`, `the app holds NO connection to the
operator's own backend (http://localhost:1111)`, `window mode is headless and
the window is never shown`, `no process from this run outlived its boot`, and a
closing facts survey from MAIN (`visible=false focused=false minimized=false`).
The daemon was started and reaped by this lane, by exact pid.

## Rebase provenance (and why the frames were re-captured)

The branch was rebased onto `6eb518c7d` (main at the time: #1137
skill-invocation-seal, plus #1096's Vietnamese settings/console/onboarding
catalogues), its six commits replayed, and the ONE conflict — the `--scene`
list line in `scripts/renderer-driver.mjs`, where both sides registered a
scene — resolved as the union: main's `skill-seal` work and this set's
`settings-account-policy` scene both stand. The scene was then RE-RUN from the
rebased tree (`3a7a4bd58`) with the recipe above, on the same frozen core:
**ALL CHECKS PASSED** (0 FAIL, 10.2s), the same readings.

The four frames were re-captured from that run because a byte comparison
against the first capture showed the pixels had moved, and the deltas are
these (full-frame pixel diff, both captures 2760x1800):

- **Every difference is in the SIDEBAR.** `rest` differs by 66,367 px of
  4,968,000: 66,259 sidebar, 108 settings pane. The empty-agents block ("No
  agents yet", the paragraph, the button) sits ~42px higher in the re-capture;
  the gap above it in the first capture is pure background (`#21272a`, one
  distinct colour measured — no hidden content) — and the sidebar scrollbar is
  caught at a different fade phase. The paragraph's text and line wraps are
  identical. The other three frames split the same way (sidebar 66,259-66,264,
  settings 13-41).
- **The settings pane — every pixel this set's claims live on — matches the
  first capture** except the settings scrollbar's own fade marks (13-108 px in
  the 9px strip at x2662-2670).
- **Run stability, measured across three runs on the rebased tree** (two build
  envs): `search-found` and `saved` came back byte-identical between the first
  two; every run-to-run difference found was the settings scrollbar's fade
  phase (12-29 px in that same strip). The sidebar delta reproduces on both
  builds, and `chat-sidebar.tsx` is unchanged in the rebase range — the
  sidebar's empty-agents block position and scrollbar fade are the one region
  of this screen whose capture is not byte-stable, which is why the set is
  re-captured from the head that ships rather than kept behind a byte-equality
  claim the re-run contradicts.

Frame SHAs — first capture (`6d071ae02`) → re-capture (`3a7a4bd58`):

- `search-found`: `96b9951f7c070e2a8b3a8309b742b4ea0db34fe91f3c0027ad578f20cf9904f` → `9bef4e084185ba9bbcadcde16cdfb5db5460d8b068eca0a8df4b13bb65a91a19`
- `rest`: `53a71ea8205b2be108a28cd80feeab8853f22ae041fcc4b22a93baba6afcf08d` → `8f165901659f4d78f4ec6c864acdecd53fa709bfe4f103dd344575f1be09dbc7`
- `dirty`: `51e5ff130e0431de83302535c5ec5b631d5c81a1067f6b09de687d1be7fa33fd` → `8d7f4b4b4b35f01ac296f49e24f20336af007c84b57a67afec675e0e89c8be20`
- `saved`: `4310e02a6d106a70f840371d4f461f5ec030823d6b6d7f3b92e3e98af2703ad3` → `7e0a74c72983268002037c35b3958eceee41b8d099504a5bd2934ad735ec2f66`

## The frames

| Frame | What it shows |
| --- | --- |
| [settings-account-policy-search-found-dark.png](settings-account-policy-search-found-dark.png) | `retry.accountSelectionPolicy` typed into the search field with the tier STILL OFF: `1 result in 1 section`, the failover section force-opened onto its match, the row among it — the tier is a view of the list, never a gate on a question |
| [settings-account-policy-rest-dark.png](settings-account-policy-rest-dark.png) | The deep link's landing: the tier revealed BY THE LINK, the section opened and centred, the row at its shipped default (`Reset soonest`), its help pressed open and shown — the sentence in the frame is the DAEMON's |
| [settings-account-policy-dirty-dark.png](settings-account-policy-dirty-dark.png) | The change driven through the row's own enum (`Most headroom` pressed in the open listbox): the draft state — changed dot, `Save`, and the page holding `1 unsaved change` |
| [settings-account-policy-saved-dark.png](settings-account-policy-saved-dark.png) | After Save: the app's own round-trip has refetched, the row is clean (no `Save`), off the default (`Use default` + dot), and shows `Most headroom` |

## The transport proof, in one sentence

The Save press went through the app's own transport (renderer → IPC → main →
`PATCH /v1/settings/retry.accountSelectionPolicy`), the row's post-save state is
what the app's own REFETCH re-seeded it from, and the daemon's answer read from
THIS process — `GET /v1/settings` on the session bearer — returned
`{"value":"headroom","is_default":false}` (`[PASS] the PERSISTED value read back
from the daemon is the choice the control wrote`); before the save the same
route read `reset-soonest` / `is_default: true`.

## The numbers behind the pictures

Read from the page in the run, and from the shipped geometry rig
(`node scripts/backend-settings-geometry.mjs --json`, the shipped `SettingsPage`
over a stubbed bridge carrying the real `/v1/settings` projection — its window
1380x900, both palettes, the row identical in both):

| Reading | Value |
| --- | --- |
| The row's height, revealed and its section open (`dense`) | **53px** (the surface's own row pitch is 60.4px) |
| Its control (`kind: enum`) | Radix `button[role="combobox"]`, **256 × 32px** (slot 256) |
| Focusables the row contributes once revealed and open | **2** (its help disclosure + the combobox); 0 while its section is closed (a `[hidden]` subtree is not focusable) and 0 in the Basic surface (the row is not rendered) |
| Rows per screen at arrival | **14.9** at 1380x900 (pitch-derived: 900/60.4), 13.2 at 1280x800 — the same figures the redesign note states |
| The arrival surface | region 2937.5px, **68** focusables (vs 492 focusables / 16737.3px with the tier revealed and every section open) |
| The search-found state (`filtered`) | 11 matches in 4 sections; the row 53px, on screen, its combobox 256 × 32 |
| The `advanced` state (tier revealed, sections as arrived) | 230 rows rendered, ours inside its closed section (height 0, 0 focusables) — the tier admits it to the list; the section's own header opens it |
| Modified count across the drive | `2` at rest → `3` after the save |

**One rig reading is reported rather than quoted:** the geometry rig's scrolled
`rowsPerScreen` count reads **0 in every one of its 64 records on this tree**
(its scroll never leaves a row fully inside the viewport), while its
pitch-derived `perScreen` carries the number the acceptance target is actually
about — hence the pitch figures above. That zero is a property of the rig's
scroll step on this tree, not of the surface.

## The focus method, and what it cannot show

The run is `headless` — the window is never shown and cannot be focused — so
`Emulation.setFocusEmulationEnabled` was enabled over CDP **before the
deep-link leg** (the sanctioned alternative the window-mode policy names). It
moves the **PAGE's** focus, never the window's: the closing survey re-read main's
own facts and the window stayed `visible=false focused=false`. What it cannot
show is a `:focus-visible` ring as a keyboard user sees it — whether one paints
for a script-focused control is Chromium's heuristics — so the focus evidence is
the DOM reading, not a ring in the pixels: the landing check asserts
`document.activeElement` IS the row's trigger (`[PASS] the deep link FOCUSED the
row's own control (its keyboard-usefulness, not merely a scroll)`), and the rest
frame is the row plus its revealed help, not a focus-ring study.

## The first run, kept as the record of what it found

This scene's first run failed both landing checks and its help press, and the
fix it drove is IN this tree's scene (its wait now returns only the settled
landing; the chip is toggled back so the deep link performs its own reveal):

```
[FAIL] the deep link opened the section and scrolled the row on screen
        {"sectionOpen":"true","focused":"elsewhere","activeTag":"button","top":1312,"bottom":1365,"viewport":900,"onScreen":false}
[FAIL] the deep link FOCUSED the row's own control (its keyboard-usefulness, not merely a scroll)
        (same reading)
[FAIL] the run threw: Error: the press point of button "account selection policy" resolves to another element
```

Two facts were measured, and neither is smoothed over here:

- **The scene's wait was wrong**: `waitForCondition` treats any truthy value as
  the answer, and the reading object always was one — so the first run read a
  sub-second partial state and failed a reveal that had simply not run yet. It
  now waits for the settled landing only.
- **The landing with the tier ALREADY revealed did not settle**: hundreds of
  milliseconds later the row was still off-screen and unfocused (the help press
  refused at the row's off-screen centre). Whether the reveal loop's first
  animation frame lost a race with the commit that opens the section — it would
  `focus()` a control still inside a `[hidden]` subtree, refused silently, and
  latch as success — or would merely have needed longer cannot be separated from
  these two runs. From the Basic surface the same link is structurally ordered:
  the focus effect is gated on the tier, so its first frame is scheduled only
  AFTER the commit that reveals the tier and opens the section. That is the
  state the scene now drives, and the landing passes there — with the link
  exercising its full contract (reveal, open, scroll, focus) rather than
  scrolling an already-open section. The ordering question in the OTHER state
  remains open for the reviewer.

## What these frames do not prove

- **Not the packaged app.** A built checkout booted by its own Electron.
- **Not a full-page frame.** The settings page is ~17,000px tall with every
  section open; these are the row in its section, scrolled to it.
- **Not a keyboard user's ring, and not OS chords.** See the focus method above.
- **Not a refusal state.** The row's control offers only the daemon's own
  choices and the daemon accepts all three: a rejection is not cheaply
  producible through this control (a transport failure would need the daemon
  paused or killed mid-write, which this scene does not stage), so no rejection
  frame is claimed.
- **Not the tier drift test.** The classification's own detector is
  `scripts/backend-settings-tiers.test.mjs`; this set photographs what the tier
  means to a reader.
