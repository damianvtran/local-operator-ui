# The switcher's Recents section - rendered evidence

Six frames from the app's own rig for the Recents section of the Cmd/Ctrl+K
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
  --backend http://127.0.0.1:8080 --backend-records <records> \
  --seed-onboarding-complete --out <dir> --window-size 1380x900
```

The scene is `scripts/renderer-driver.mjs`'s `palette-recents`, committed at
`875526f04eb`. `run-after.log` is 29 `[PASS]` and no `[FAIL]`; `run-before.log`
is 22 `[PASS]` and no `[FAIL]`. `stub-requests.log` is the daemon's catalogue
reads (`limit=500&include_archived=true -> 200 rows=6`). One theme
(`localOperatorDark`), 1380x900 at dpr 2; the committed `.webp` files are
`cwebp -q 90` conversions of the run's PNGs, un-resized. The run's scratch
profile, config dir and log dir are throwaway; its log carries the readings that
prove the app held no connection to the operator's own backend.

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
| `after-switcher` | Head. **Unread** (Quarterly retention sweep), then **Recents** - Migration checklist, Release notes for 0.29, AWS cost increase review - then **Chats** (Invoice reconciliation, Old onboarding notes). The panel is 638 x 324.2px (before: 638 x 314.8px; the three extra rows plus a heading are what the list grew by, inside the 24rem list's own bound). |
| `before-down` | Base tree after one ArrowDown: selection moves from the unread row to the first Chats row (`chat-2d5ad5da0025`, the conversation on screen). |
| `after-down` | Head after one ArrowDown: the selection has crossed the Unread -> Recents boundary onto the first Recents row, Migration checklist (`aria-activedescendant` `chat-b3f1a09c7d52` -> `chat-7c1b0f2a4d31`). |
| `before-empty` / `after-empty` | An EMPTY ring (the profile reseeded to `[]` and rebooted). The boot restores the open conversation, so the ring fills with exactly that one, which is the conversation on screen and therefore excluded: nothing is eligible. Both halves read `Unread` then `Chats` and no Recents heading. The two PNGs differ in 201 channel samples of 14,904,000, all inside a 2 x 34px box at x 846-847, y 554-587 (the text caret blinking in the query field); the committed WebPs are different encodings of that. |

## What was read, not just looked at

- Section order and row ids, from the DOM: `Unread | Recents | Chats`; Recents rows
  `chat-7c1b0f2a4d31`, `chat-e059761608ae`, `chat-c4e17b90a2f6` in seeded visit order.
  The unread conversation is in the ring but appears ONLY under Unread; the
  conversation on screen is in the ring but appears ONLY under Chats.
- The walk: ArrowDown then alternating Ctrl+N / ArrowDown visits
  `chat-7c1b0f2a4d31`, `chat-e059761608ae`, `chat-c4e17b90a2f6`, `chat-2d5ad5da0025`,
  `chat-a91f4c7e2b60` - Unread -> Recents (x3) -> Chats in list order, none skipped
  - and Ctrl+N started no new chat (no staged draft).

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
