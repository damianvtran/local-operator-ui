# D1/D2 follow-up — prepared, not executed

**Follow-up:** [D1/D2 full-container RED → GREEN remediation](D1-remediation.md) supersedes the earlier post-off verification limitation; earlier artifacts and preparation notes below remain historical records.

Status: **light edits only; awaiting a new serial slot**. No tests, typecheck, Storybook, browser, or push was run for these follow-up files. Earlier genuine-source before/after artifacts remain unchanged.

## Contract finding, not a rendered reproduction yet

Runtime PR #2790 at `5d254286fe698ba89fc99b6476b201c505b30384`:

- `local_operator/team_bridge/client.py:_surface_state`: eligible selected tenant with disabled endpoint => E.
- `surface_projection`: `read_only = state == "F"`; therefore **E returns false**, while `can_receive` becomes false and `visibility.inbox/account_door` become false.
- `local_operator/server/routes/desktop_team_bridge.py` forwards `projection.read_only` unchanged and emits composed `local.enabled`; the accepted disabled PUT persists local enabled=false.
- The separate retained-history read envelope can be readonly after local opt-out. It is **not** the desktop status projection and must not be substituted for it in a fixture.

The UI currently derives page readOnly solely from status.read_only; the page eligibility helper does not classify E or local.enabled=false. This is a concrete static concern, but **not yet proof of the rendered post-refresh result**. No production code was changed to anticipate the result, and no fixture manufactures read_only=true to force the desired UI.

## New fixture and full-container stories

- `default-on-container.fixture.ts`: replaces only `window.api.desktop.request` with a stateful runtime-shaped adapter. The real DesktopRequest routing, renderer API parsing, mutation hooks, query invalidation, and `TeamBridgePage` remain intact. Unexpected operations return a local 503, never fall through to the actual desktop or hub.
- `default-on-container.stories.tsx`: mounts **TeamBridgePage**, not PageView, with an isolated QueryClient and the real `useTeamBridgeStatus` observer. The adapter is installed before child mounting and restored after unmount.
- TurnOffObserved clicks the actual button, then requires exactly one disabled PUT, no settings.edit, a subsequent status GET returning E/local.enabled=false/read_only=false, and the real query cache idle with at least one mounted observer. It records composer/send presence rather than silently asserting that the required off-state UX is correct.
- Nonvisual DOM evidence: `[data-runtime-audit]` contains every request, resolved route/body, and response; `[data-status-observer-audit]` contains the actual query data/fetch status/observer count; `[data-off-observation]` contains the final visible composer/send observations and request sequence. Preserve these beside the next rendered frames.
- Capability fixture advertises Team Bridge only. Account/membership proxy networking is unrelated to this delta; tenant identity/labels come from the runtime-shaped status tenant list, as the real page supports.

Expected story IDs (verify against the index before capture):

- `team-bridge-default-on-container--pending`
- `team-bridge-default-on-container--turn-off-observed`
- `team-bridge-default-on-container--expanded`
- `team-bridge-default-on-container--minimum-expanded`
- `team-bridge-default-on-container--minimum-off-observed`
- `team-bridge-default-on-container--minimum-expanded-french`
- `team-bridge-default-on-container--minimum-expanded-urdu`

The actual native minimum is **800×600** (`src/main/window-mode.ts`), not 800×500. Minimum boards constrain the page layout box as well as declaring Storybook viewport parameters because direct iframe captures do not apply the manager addon. Urdu uses existing audited strings and the production `useTextDirection` resolver on the pane. French checks longer existing action labels. No new UI copy or palette values. Larger OS display/text scaling is not simulated or claimed by these boards.

## Next authorized slot

1. Check shared lockfile/dependencies and disk; format/lint/types with agreed memory/PGID limits, serial only.
2. Start one narrowed Storybook instance; capture pending then real Turn off transition in both themes, saving audit JSON plus initial/settled geometry and frames.
3. Record what the full container actually renders under E/read_only=false. Only if the production path is reproduced as wrong, fix the owning source and add focused regression coverage. Batch that genuine fix and evidence rather than altering approved banner visuals.
4. Capture minimum expanded/off and French/Urdu neighbor boards; inspect clipping/scrollability, not merely their titles.
5. Close the browser, reap exact server tree/log, then normal-hook commit/push after the batch is verified. Independent design round 2 primarily reviews D1 and direct neighbors; no whole-matrix re-audit or merge authorization implied.
