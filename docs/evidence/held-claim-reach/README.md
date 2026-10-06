# Held-claim reach — the phantom row, in the real app

Frames for PR #854 (`fix(chat): a held send's verdict is about reach, not just a
complete page`), issue #847. Design round 1 (head `9f2be9da19b`), re-shot on the
remediation head `34470e9bc55`. Captured 2026-10-06.

**What these are.** Live frames of the BUILT app, launched in the documented
`headless` window mode (`--user-data-dir` + `--remote-debugging-port`; the window
is created at size and never shown, and no run took the operator's focus), booted
against an isolated `lop serve` daemon this run owned. Pixels are
`Page.captureScreenshot` over CDP — the app's own compositor output — never
`macOS screencapture`.

## The set

| file | tree | state |
| --- | --- | --- |
| `frames/before-phantom.png` | base `9b11d395b8b` | the defect: a DELIVERED message (row `ac4b015eca0e89c02d0191265c183bd6`, index 100 of the daemon's 260) painted at the conversation's tail wearing `Not delivered · Send again · Edit` |
| `frames/after-phantom.png` | head `34470e9bc55` | the same session, the same record, the same seeded store bytes, on the shipped fix |
| `frames/before-genuine.png` / `frames/after-genuine.png` | base / head | the control: a verdict whose record is NOT in the transcript — the line is present on BOTH trees |
| `frames/after-claimheld.png` | head | a claim the reach test refuses to conclude: no transcript row at all; the composer's own notice is its home |
| `frames/after-plain.png` | head | a plain transcript with no claim |

Each phantom frame has its companion `.readout.json` beside it: the app's own
reading of `[data-undelivered]`, the row list, and the draft AS THE STORE HOLDS
IT AFTER THE MOUNT (`stored_draft.has_undelivered`).

## What the readouts say, verbatim

```
before-phantom  rows 61  undelivered {"text":"Not delivered Send again Edit","controls":["Send again","Edit"]}
                stored_draft {"has_undelivered": true, "undelivered_record": "ac4b015eca0e89c02d0191265c183bd6"}
after-phantom   rows 60  undelivered null
                stored_draft {"has_undelivered": false, "undelivered_record": null}
before-genuine  undelivered {"text":"Not delivered Send again Edit","controls":["Send again","Edit"]}
after-genuine   undelivered {"text":"Not delivered Send again Edit","controls":["Send again","Edit"]}
```

**`after-phantom.png` and `after-plain.png` are byte-identical** on this head
(`sha256 1cba9d36b0e4b563…`): the phantom scenario now renders exactly the plain
transcript — no extra row, no line. In design round 1 the same staging on
`9f2be9da19b` produced **61** rows, the extra one being the pending bubble
`resynthesisePendingSend` had painted a moment before the heal retracted the
verdict (review finding D1). The remediation resolves it: both retraction points
now clear the painted echo (`clearPaintedVerdictEcho` → `retractLocalEcho`), so
the statement-less bubble is gone on the first mount after an upgrade.

The row list is the arbiter of position: on the base frame the last
`data-record-id` row is `ac4b015e…` and carries the sentence; on this head no row
carries the staging text at all.

## How the states were staged

```sh
# 1. an isolated daemon this run owns, on a scratch config root, with a bearer of
#    this run's own choosing (values: {hosting: test, model_name: mock-model})
node scripts/seed-paging-session.mjs <scratch>/config2 260 "Held claim reach deep"
LOCAL_OPERATOR_CONFIG_DIR=<scratch>/config2 LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
  LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_TERMINAL_TITLE=1 \
  lop serve --host 127.0.0.1 --port 46200 &

# 2. the app built for that daemon, then booted headless and driven over CDP.
#    The draft is seeded into the app's OWN persisted store key
#    (`canonical-sessions-storage`) with the stale verdict, then the page reloads
#    so the store hydrates it the way a returning user's would.
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:46200 VITE_GOOGLE_CLIENT_ID=<inert> \
  VITE_GOOGLE_CLIENT_SECRET=<inert> VITE_MICROSOFT_CLIENT_ID=<inert> \
  VITE_MICROSOFT_TENANT_ID=<inert> pnpm build:npm
node rig.mjs --label before|after --mode phantom|genuine|claimheld|plain ...
```

The verdict is seeded rather than produced by a live send because the app has no
way to make a delivered message look older than a tail page on demand; what the
frames photograph is the app's own rendering of a store state the app itself
writes. The staging is the issue's own shape: the verdict names a message older
than the loaded tail window, so the pre-fix code paints it at the tail.

`frames/*.png` are WebP-free on purpose: `check-evidence.mjs`'s frame walker
counts `.webp` only, so a hand-driven set cannot be mistaken for a sweep.

## Bundles the frames come from

```
before  (base 9b11d395b8b)              out/main sha256 b91af5a5066f1d5f  out/renderer/assets/index-BVBUQwde.js sha256 f84d1821a7307741
after   (head 34470e9bc55, r1 fix)      out/main sha256 b91af5a5066f1d5f  out/renderer/assets/index-B_lrhlT_.js  sha256 d0cc9798a3c5b293
   (design round 1 was shot on head 9f2be9da19b: out/renderer/assets/index-CIhLOSfj.js sha256 25c5c47f42e7d490)
```

`main` is byte-identical across every build; the whole delta is the renderer,
which is where the change is.

## What this set does NOT show

- **No second theme, no second viewport.** The change adds no colour, no token,
  no copy and no geometry (the diff under `src/` is three `.ts` files, zero CSS),
  so a sweep would only re-shoot the same pixels. The line's own contrast is
  measured instead: `Not delivered` is `--lo-danger #ef8078` on
  `--lo-canvas #22201c` at **6.22:1**, and on `--lo-message-surface #2e2a21` at
  **5.46:1** (both AA, both unchanged by this diff).
- **No empty, narrow or error-transcript frame.** None of those states is
  reachable differently because of this change.
- **The `Connect a provider` control inside the composer notice is a rig
  artifact** of the scratch daemon having no provider configured; it is the
  composer's own no-model affordance, not part of the surface under review. The
  transcript surface — the one this change touches — is unaffected by it.
