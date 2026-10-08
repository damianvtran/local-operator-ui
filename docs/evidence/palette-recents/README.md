# The switcher's Recents section - rendered evidence

Eight frames from the app's own rig for the Recents section of the Cmd/Ctrl+K
conversation switcher: a real Electron launch of the built app in `headless`
window mode, driven over CDP's own input pipeline, against the sidebar row-space
set's stand-in daemon (six conversations, one carrying the unread mark's
`attention.unseen` shape). The set is a BEFORE/AFTER pair of the same scene over
the same seeded profile: `before` is the base tree (`15a7a4ed522`, no Recents),
`after` is the feature head.

## The command

```sh
node docs/evidence/sidebar-row-space/harness/stub-daemon.mjs \
  --port 8080 --records <records> > <stub.log> 2>&1 &

# build the half under test (the BEFORE half is built from the base tree's src/;
# the driver refuses a build older than the newest source file). Placeholder
# VITE_* identifiers are enough: nothing in this run signs in. NO_BYTECODE
# because the bytecode plugin needs a babel plugin this tree does not install.
LOCAL_OPERATOR_UI_NO_BYTECODE=true VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
  VITE_DISABLE_BACKEND_MANAGER=true VITE_GOOGLE_CLIENT_ID=x VITE_GOOGLE_CLIENT_SECRET=x \
  VITE_MICROSOFT_CLIENT_ID=x VITE_MICROSOFT_TENANT_ID=x VITE_RADIENT_SERVER_BASE_URL=http://127.0.0.1:9 \
  VITE_PUBLIC_POSTHOG_KEY=x VITE_PUBLIC_POSTHOG_HOST=http://127.0.0.1:9 \
  npm_config_verify_deps_before_run=false pnpm build

LOCAL_OPERATOR_DESKTOP_TOKEN=stub node scripts/renderer-driver.mjs \
  --scene palette-recents --recents-expect <after|before> \
  --backend http://127.0.0.1:<port> --backend-records <records> \
  --seed-onboarding-complete --out <dir> --window-size 1380x900
```

The two frames the design round's D4 added are the same build and driver, one
flag apart:

```sh
# The light shot of the same scene: the same command with the theme named.
LOCAL_OPERATOR_DESKTOP_TOKEN=stub node scripts/renderer-driver.mjs \
  --scene palette-recents --recents-expect after --theme localOperatorLight \
  --backend http://127.0.0.1:<port> --backend-records <records> \
  --seed-onboarding-complete --out <dir> --window-size 1380x900

# The full pin with a bound row, over the stub's LARGE catalogue (its six-
# conversation fixture has no bound conversation and too few rows to fill the
# pin, so this half runs against `--catalogue 90` instead).
node docs/evidence/sidebar-row-space/harness/stub-daemon.mjs \
  --port <port> --records <records> --catalogue 90 > <stub.log> 2>&1 &
LOCAL_OPERATOR_DESKTOP_TOKEN=stub node scripts/renderer-driver.mjs \
  --scene palette-recents --recents-full \
  --backend http://127.0.0.1:<port> --backend-records <records> \
  --seed-onboarding-complete --out <dir> --window-size 1380x900
```

The scene is `scripts/renderer-driver.mjs`'s `palette-recents`. The set's six
BEFORE/AFTER frames were captured at `875526f04eb` and are unchanged; the two
frames the design round's D4 added were shot from the tree of this round's commit
(the scene's `--theme`/`--recents-full` arms above, both added by this round).
`run-after.log` is 29 `[PASS]` and no `[FAIL]`; `run-before.log` is 22 `[PASS]`
and no `[FAIL]`; `run-after-light.log` (the light frame) is 26 `[PASS]` and
`run-full.log` (the full-pin frame) is 16 `[PASS]`, both with no `[FAIL]`, and
both are committed beside the frames. `stub-requests.log` is the daemon's
catalogue reads (`limit=500&include_archived=true -> 200 rows=6`). Two themes
(`localOperatorDark` for seven frames, `localOperatorLight` for one), 1380x900 at
dpr 2; the committed `.webp` files are `cwebp -q 90` conversions of the run's
PNGs, un-resized. The run's scratch profile, config dir and log dir are
throwaway; its log carries the readings that prove the app held no connection to
the operator's own backend.

**Why the round's delta is not re-evidenced in the six older frames.** This
round's change is renderer-side and narrow: the Recents pin no longer CLAIMS a
conversation the archive store holds out of the default lists (`palette-search.ts`
carries the row's `archived` fact and excludes it; the browse pool is unchanged).
The six committed frames' rings contain no archived conversation, so no state they
render moved. That is measured rather than assumed: `after-switcher` was re-shot
from this round's tree and compared against the committed frame - 6 pixels differ
at a 5% per-channel tolerance and 0 at 8%, i.e. lossy re-encoding noise, not a
render.

## The profile the scene seeds

The persisted ring is seeded (merged into `ui-preferences-storage` at the
store's own version, then the page reloaded, so the app BOOTS with a history and
zustand's hydration is what runs) as, most recent first:
Migration checklist, Release notes for 0.29, AWS cost increase review, and the
**unread** conversation (Quarterly retention sweep). The scene then opens
**Invoice reconciliation** by pressing its sidebar row - nothing tells the ring.
The persisted ring read back after that press is
`["2d5ad5da0025","7c1b0f2a4d31","e059761608ae","c4e17b90a2f6","b3f1a09c7d52"]`:
the opened conversation is at the front, the seeded history behind it, no
duplicate. That is the visit hook working on the real app.

## The frames

| set | what it shows |
| --- | --- |
| `before-switcher` | Base tree. The `#` switcher: **Unread** (one row) then **Chats** (five rows). The selection is on the unread row. No Recents. |
| `after-switcher` | Head. **Unread** (Quarterly retention sweep), then **Recents** - Migration checklist, Release notes for 0.29, AWS cost increase review - then **Chats** (Invoice reconciliation, Old onboarding notes). Both halves list SIX conversations and the head half draws one more heading: no row was added, three conversations moved from the Chats tier into Recents. The results listbox (`#command-palette-results`, not the whole panel) is 638 x 324.2px against the base half's 638 x 314.8px, so this pair is 9.4px taller - one heading, less the 24px `h-6` dropped-rows end spacer (`command-palette.tsx`) the base half's list still carries. The head half reconciles exactly at 324.2px (6 x `h-9` rows = 216px, three headings, `p-2`); the base half's six rows and two headings compute to 290.8px, 24px short of the logged 314.8px, and the 24px is that spacer. |
| `after-switcher` (light) | The same scene in `localOperatorLight` - the same list, the same selection on the unread row, no Recents row moved. Shot because the committed set was dark-only; the section headings' contrast is HIGHER here than in the dark frame (`ink-dim` on `elevated` is 6.14:1 against 5.25:1 - the design round's token ratios, not pixel samples) (design round 1, D4). |
| `after-full` | The pin at its FULL five rows, over the stub's large catalogue (`--catalogue 90`), with a ring of six bound conversations: **Recents** draws Chat 016/017/018 (team `minervadev`) and Chat 035/036 (agent `reviewer`) - five rows, in visit order, each drawing its binding hint - and **Chats** draws Chat 000-003. The sixth ring entry is past the Chats tier's own five-row cap in this fixture, so this frame does not draw it (it is not in Recents either - the pin's cap, not an exclusion). |
| `before-down` | Base tree after one ArrowDown: selection moves from the unread row to the first Chats row (`chat-2d5ad5da0025`, the conversation on screen). |
| `after-down` | Head after one ArrowDown: the selection has crossed the Unread -> Recents boundary onto the first Recents row, Migration checklist (`aria-activedescendant` `chat-b3f1a09c7d52` -> `chat-7c1b0f2a4d31`). |
| `before-empty` / `after-empty` | An EMPTY ring (the profile reseeded to `[]` and rebooted). The boot restores the open conversation, so the ring fills with exactly that one, which is the conversation on screen and therefore excluded: nothing is eligible. Both halves read `Unread` then `Chats` and no Recents heading. Measured from the two COMMITTED WebPs themselves (decoded, 8 per channel): 138 pixels differ, spread over the frame (x 71-1980, y 554-1763, worst per-channel delta 205) - lossy re-encoding noise, plus the blinking text caret in the query field. No structural difference is visible in the pair. |

## What was read, not just looked at

- Section order and row ids, from the DOM: `Unread | Recents | Chats`; Recents rows
  `chat-7c1b0f2a4d31`, `chat-e059761608ae`, `chat-c4e17b90a2f6` in seeded visit order.
  The unread conversation is in the ring but appears ONLY under Unread; the
  conversation on screen is in the ring but appears ONLY under Chats.
- The walk: ArrowDown then alternating Ctrl+N / ArrowDown visits
  `chat-7c1b0f2a4d31`, `chat-e059761608ae`, `chat-c4e17b90a2f6`, `chat-2d5ad5da0025`,
  `chat-a91f4c7e2b60` - Unread -> Recents (x3) -> Chats in list order, none skipped
  - and Ctrl+N started no new chat (no staged draft).
- The full-pin frame's own DOM read (in `run-full.log`): headings
  `Recents | Chats`; Recents rows `chat-p016`, `chat-p017`, `chat-p018`,
  `chat-p035`, `chat-p036` - five, in ring order - and each row's text carries its
  binding hint (`minervadev` for the three team-bound rows, `reviewer` for the two
  agent-bound ones). No id appears twice. The unit tests that own the fact these
  frames only illustrate are `scripts/palette-recents.test.mjs`'s
  `chatRecentsOfRow` cases and `scripts/palette-search.test.mjs`'s archived-row
  case.

## What these frames cannot prove

- **Recents driven by a notification click or a deep link** is not photographed:
  the hook reads the one displayed-conversation value those paths move, and the
  rule is pinned in `scripts/palette-recents.test.mjs`, but only the sidebar row
  press is exercised on the real app here.
- **Cmd/Ctrl+K itself** is not pressed: the `#` is typed, as in the Unread set,
  because a headless window is neither focused nor visible.
- **The unscoped Cmd/Ctrl+P browse** staying unchanged is pinned in
  `scripts/palette-search.test.mjs`, not photographed.
- **The 20/5 bounds, the shared 48-row budget and deleted-conversation absence**
  are pure-function facts in the unit tests, not pixels.
