# `panels-live` — the in-app (real-path) frames that were not taken

**This set is declared at zero frames on purpose.** The panel sweep under
`docs/evidence/panels-*/` renders story fixtures, which is what proves the panel
states a live ledger cannot be made to produce. What a fixture cannot prove is
that the shipped app opens these panels at all: the slash command has to be
offered, the destination row has to exist, the op has to be reachable and the
panel has to render the wire shape rather than its own fixtures. That claim was
attempted here against a real backend, and this file records exactly how far the
attempt got, because an undeclared absence is invisible while a declared one is a
term `pnpm check-evidence` can fail on the moment a frame lands in this
directory.

## The rig that ran

1. An **isolated** backend, never the operator's store:

   ```sh
   LOCAL_OPERATOR_CONFIG_DIR=/tmp/lo-panels-live/config \
   LOCAL_OPERATOR_HOME=/tmp/lo-panels-live/home \
   LOCAL_OPERATOR_DESKTOP_TOKEN=<random> \
   <backend-worktree>/.venv/bin/local-operator serve --host 127.0.0.1 --port 8080
   ```

   Port 8080 rather than a spare one because the renderer's CSP
   (`src/renderer/index.html`) names only `1111` and `8080`, so a renderer
   pointed anywhere else has its fetch refused **by policy, with no request
   sent** — which is what painted the offline banner across an earlier set.

2. The **built** app (`pnpm build` with `VITE_DISABLE_BACKEND_MANAGER=true` and
   `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080`), headless, isolated
   profile:

   ```sh
   LOCAL_OPERATOR_UI_WINDOW_MODE=headless \
   LOCAL_OPERATOR_DESKTOP_TOKEN=<same token> \
   VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
   ./node_modules/.bin/electron . --remote-debugging-port=9444 \
     --user-data-dir=/tmp/lo-panels-live/user-data --window-size=1140x940
   ```

   Two things about the environment are load-bearing and were both found the
   hard way. The **desktop bearer** must be in the app's own environment: a
   second instance started no backend, so it holds no token, and without one
   every op answers `503`/`401` — with the wrong one, the backend's own
   `Desktop authorization is required.` appears in the renderer. And the token
   and URL are read by MAIN at startup (it loads `.env` and then `process.env`),
   not only baked by the build: with the value only baked in, the renderer read
   the isolated backend while the desktop transport — every op the panels use —
   talked to the port in the bundle.

3. The app over raw CDP, with `ui-preferences-storage` (theme) and
   `onboarding-storage` (`isModalComplete`/`isTourComplete`) seeded before the
   first app script, `canonical-sessions-storage` removed, and the command typed
   into the composer as a user types it.

## What was verified on the wire

The backend head at the time (uncommitted work in
`~/local-operator-worktrees/desktop-diagnostic-ops`) answers both new routes, so
the two halves agree on the wire even though the frames through the app are
missing. Real responses, isolated backend, session `4c1f858574f5` created
through `POST /v1/desktop/sessions`:

| Request | Result |
|---|---|
| `GET /v1/capabilities` | `features` includes `"diagnostics": 1` — so neither gated panel is gated on this head |
| `GET /v1/desktop/info` | `200`, `data.install.kind = "editable"`, `data.process`, `data.sessions`, `data.env`, `data.degraded` all present |
| `GET /v1/desktop/sessions/4c1f858574f5/report?recent_limit=12` | `200`, with `by_model` and `by_purpose_outcome` as **arrays** and `by_purpose` as an **object** |
| `GET /v1/desktop/analytics?days=7` | `200`, `aggregate.calls = 0` on a fresh store — the empty-ledger state the panel is judged on |

The `by_purpose` shape is a contract violation and is reported rather than
absorbed: §5.2 of `docs/design/panel-views.md` types it as
`Array<{purpose, aggregate}>` and the route converts the other two group-bys for
the same reason (a `dict` reaches JSON keyed and cannot be ordered). A view
written strictly against that type would throw on the real payload, so
`session-report-model.ts`'s `reportShapeProblem` turns it into section 4's own
`unavailable` notice — the rest of the report still renders, which is what § 8's
section-scoped state asks for and what review round 1's R3 required — instead of a
crash. The fix belongs upstream (the route converts it) and was taken there.

## Why no frame was taken

The composer only exists with a conversation in front of it. A backend with no
provider credential cannot record a turn (`POST .../messages` answers `503 No
model provider is configured yet.`), so no chat appears in the sidebar and the
only way to reach the composer is the app's own `New chat`, which stages a
**draft** with no session behind it. In that state, typing `/analytics` opens the
composer's slash menu and the menu's Enter accepts the row into the textarea
(`/analytics `) instead of dispatching it; no panel opened within 30s, with or
without a retried Enter, and with a direct click on the menu row. `/analytics`
and `/info` are the two panels whose op needs no session id, so a seeded session
is not what is missing for them — a dispatched command is.

Taking these frames needs a rig that can seed a session **with history** (a
credential the isolated backend did not have): the app opens the chat, the
composer carries a real `sessionId`, and the five commands dispatch. That is
what `scripts/mentioned-files-app-proof.mjs` does for the Files panel against a
live backend, and it is the shape this set needs.

### The dispatch gate is the leading candidate for this result

Review round 1 traced the same behaviour to a rule in the app rather than to the
rig. `slash-dispatch.ts` refuses to run a command when no conversation is open,
and `/info` and `/analytics` are the two commands whose op needs no session id at
all: they read the host and the ledger, so a seeded session is exactly what they
do not require — which is why this file can name a dispatched command as the only
missing ingredient and still see the row accept text instead of opening a panel.
The reviewer ruled that gate a real defect for those two commands and **not this
PR's to fix**: it is pre-existing behaviour this change neither introduces nor
claims, and changing it moves dispatch semantics shared by every command, which
needs its own review and QA. It is recorded on PR #165 as
`deferred — follow-up PR`, and it is the explanation to test first when the rig
grows the session-with-history seeding this file asks for.
