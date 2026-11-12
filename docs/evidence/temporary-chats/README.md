# Temporary chats: before/after frames

Captured 2026-11-12 with the repo's own rig: `scripts/renderer-driver.mjs --scene temporary-chats`
(`scripts/temporary-chats-scene.mjs`), the BUILT app in a headless window under Xvfb, in a scratch
profile, 1380x900, both brand palettes.

**The app is the real one; the daemon is not.** The core half of the feature
(`features.temporary_chats`, damianvtran/local-operator) is a separate pull request, so the runs
answer from `harness/stub-daemon.mjs`, the session-archive stub plus the frozen wire of contract
§2.3: the capability, `include_temporary` on the list, the row's `temporary` object (computed from
the wall clock at every read), `POST /v1/desktop/sessions/{id}/temporary`, and a tombstoned id
answering 404 `session_temporary_deleted` on its snapshot and event stream.

- `before/` - `--temporary-expect withdrawn` against `stub-daemon.mjs --no-temporary` (an older
  core). The scene asserts nothing new is drawn: no group, no pill, no Keep / Make temporary item,
  no draft toggle, Ctrl+Shift+N does nothing, and the deleted id gets the generic notice. The stub's
  log for these runs carries no `include_temporary` request and no `/temporary` call (0 of 11 list
  reads per run).
- `after/` - `--temporary-expect on`. Every frame below is preceded by a DOM check (29 PASS, 0 FAIL
  per palette).

| Frame | State | What the scene checked before the shutter |
| --- | --- | --- |
| `sidebar` | `/chat` at rest | `[data-sidebar-temporary-group]` drawn (after) / absent (before); no temporary row in the normal list |
| `sidebar-group-open` | the group's header pressed | three rows; only the last-five-minutes row carries the amber countdown |
| `live-pill` | a temporary chat open (22 min left) | `[data-session-temporary-pill="live"]`, the dashed neutral pill; the group opened by itself |
| `countdown-pill` | a temporary chat with 4.5 min left | the pill reads `Deletes in 5 min` in the warning badge, with Keep chat beside it |
| `menu-keep` | the header menu on a temporary chat | `[data-temporary-keep]` present (after) / absent (before) |
| `menu-make` | the header menu on an ordinary chat | `[data-temporary-make]` present (after) / absent (before) |
| `confirm` | Make temporary... pressed | the confirmation is up, Cancel focused; it was then dismissed (nothing written) |
| `draft-toggle-off` | Ctrl+N (a real CDP chord) | the dashed toggle with `aria-pressed="false"` (after) / no toggle (before) |
| `draft-toggle-on` | Ctrl+Shift+N (a real CDP chord) | a fresh draft with the toggle `aria-pressed="true"` |
| `tombstone` | `/chat/c0ffee5a1e04`, a deleted temporary chat | `[data-missing-session-notice="temporary"]` with New temporary chat / Back to chats (after); the generic notice (before). The stub log shows exactly one snapshot read for the id, the tombstone probe |

The panes say `Reconnecting`: the stub serves no event stream for a live row, as in the
session-archive set. That is the stub, not the feature.

## Re-deriving

```bash
# a build pointed at the stub; the four OAuth values are inert build placeholders
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18301 \
VITE_GOOGLE_CLIENT_ID=evidence-build-only-not-a-credential \
VITE_GOOGLE_CLIENT_SECRET=evidence-build-only-not-a-credential \
VITE_MICROSOFT_CLIENT_ID=evidence-build-only-not-a-credential \
VITE_MICROSOFT_TENANT_ID=evidence-build-only-not-a-credential pnpm build

Xvfb :97 -screen 0 1920x1200x24 -nolisten tcp &   # Linux only

# one FRESH stub per launch; add --no-temporary for the before arm
node docs/evidence/temporary-chats/harness/stub-daemon.mjs --port 18301 --records <rig>/records
DISPLAY=:97 LOCAL_OPERATOR_DESKTOP_TOKEN=<any> node scripts/renderer-driver.mjs \
  --scene temporary-chats --temporary-expect on|withdrawn \
  --backend http://127.0.0.1:18301 --backend-records <rig>/records \
  --seed-onboarding-complete --theme localOperatorDark|localOperatorLight \
  --out <rig>/frames --window-size 1380x900
```
