# A draft's bridge 404 is not a conversation verdict

The operator's report (2026-10-23): a **New chat with a team** landed on *"This
conversation is no longer on this machine"* and the draft text was stranded. The
team's draft row keeps a stable key (`draft:team:<name>`) and its
`draftRequestId` persists across launches; a daemon that restarted (or a draft
that expired) answers that request's receipt by replaying the id it minted the
first time — an id its registry no longer serves. The pane streams on
`sessionId ?? draft.warmId`, so the bridge 404s.

The frames are the same scene (`--scene team-newchat`) on the same isolated
daemon shape and the same inert build environment, on two source trees. Both legs
ran against the same **unfixed** backend (`origin/main` of
`damianvtran/local-operator`, `6f9efefb2c`): the 404 is the subject, and a backend
that re-mints on a stale receipt would never send one to the renderer, leaving
this PR's client arm unexercised.

| frame | source | reading |
| --- | --- | --- |
| `before.png` | `origin/main` (`39164868fc`) | header *New chat with Minerva Development*; body *This conversation is no longer on this machine.* / *It was deleted, or it belongs to a machine this app is not connected to.*; composer holds `C`, `readOnly: true`; the row still holds the seeded request id `3f2f0b4a-…`; no bubble after Enter (45 s bound) |
| `after-new-chat.png` | `fix/team-newchat-missing` | same header; **no notice**; the app's new-chat empty state with `C` in an editable composer; the row's request id re-minted (`1ac9177b-…`), no `sessionId` |
| `after-send.png` | same branch | the same send reached the conversation: user bubble *C a regression check*, mock provider's answer *Hello from the mock provider!*, no undelivered line, composer empty |

The before half's after-send capture is **byte-identical** to `before.png`
(215205 bytes): the refused composer accepted nothing, so the send state and the
new-chat state are the same picture. That is the defect, not a missing frame.

## Measured numbers

Both legs, one free loopback port each run (8080, the only non-operator port the
renderer's CSP admits), 1380x900 at DPR 2, `localOperatorDark`:

- **the id the pane streamed** — the daemon's own replay of the seeded request:
  `cdb83405be6d` (before) / `8a9f36477485` (after).
- **404s counted from each run's serve log**
  (`grep 'GET /v1/desktop/sessions/<D>/events'`): 2 lines per leg — one is the
  precondition's own `curl` probe, the other is the app's bridge stream
  (`?frontend_replace=1&open_frame=1&journal_order=1&supplements=1`). So the
  renderer itself made **one** 404 request per leg. The after leg additionally
  opened the conversation the send created (`134fb23128da`) with a `200`.
- **Enter → rendered bubble**: 43 ms (after). The before leg produced no bubble
  within the 45 s bound.
- **states**: after the keystroke — notice `null`, composer `C` editable,
  `activeDraftKey` `draft:team:minervadev`, `draftSessionId` null. After the send
  — notice `null`, composer `""`, `[data-undelivered]` absent,
  `draftSessionId` `134fb23128da`.

## Reproducing the pair

The precondition is the operator's persisted state, built from the daemon's own
API and then restarted:

```bash
# isolated root: config/agents + config/teams/<team> copied from the live store
# config.yml values: {hosting: test, model_name: mock-model}
POST /v1/desktop/sessions/draft   {request_id: R, cwd: "~", target: {kind: team, name: minervadev}}  -> D
POST /v1/desktop/sessions         {request_id: <uuid>, cwd: "~", target: …, draft_id: D}            -> session D
rm -rf <config>/sessions/D
# restart the daemon; POST /v1/desktop/sessions/draft with R now replays D, and
# GET /v1/desktop/sessions/D/events answers 404 (verified before every run)
```

Then, per leg (renderer built against `http://127.0.0.1:8080` with
`VITE_LOCAL_OPERATOR_API_URL`, inert `VITE_GOOGLE_*`/`VITE_MICROSOFT_*` values,
`VITE_DISABLE_BACKEND_MANAGER=true`):

```bash
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/renderer-driver.mjs \
  --scene team-newchat --seed-onboarding-complete \
  --backend http://127.0.0.1:8080 --backend-records <config>/run/serve \
  --team minervadev --team-label "Minerva Development" \
  --draft-request-id 3f2f0b4a-8c1e-4d2b-9a77-5e61c0a2b1d4 \
  --expect broken|fresh --window-size 1380x900 --out <dir>
```

The scene writes the seeded row into the profile and reloads, types one `C`
through CDP's input pipeline, reads the screen, then types a short message and
presses Enter through the composer's own key handler.

## What these frames may claim

They are the app's own `capturePage` of a hidden (`headless`) window, settled
(two identical captures 150 ms apart). They show what this client did with the
404 the daemon actually served; they do not prove the daemon restarted for the
operator's own reason, and they are not a screenshot of the operator's live data
— the run is an isolated profile and an isolated daemon. The send's delivery is
the transcript's own `[data-undelivered]` absence plus the daemon's `200` stream
for the created conversation, not a claim about the model's answer content.
