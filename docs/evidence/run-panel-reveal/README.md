# The run panel's reveal, before and after the container-scoped scroll

Ten frames, one pair per size, of the same gesture: **press the composer's plan
chip and look at what moves.** They are the evidence for `docs/composer-status-tabs.md`
§ 5.2 step 3 ("bring the To-dos section into view IN THE PANE'S SCROLL REGION"),
which the shipped code did not do — it called `scrollIntoView`, whose default
`container: "all"` walks every scrolling box up to the viewport, `overflow: hidden`
boxes included.

```
press-1024x673-before-fix/localOperatorDark.webp    press-1024x673-after-fix/localOperatorDark.webp
press-1024x673-before-fix/localOperatorLight.webp   press-1024x673-after-fix/localOperatorLight.webp
press-800x600-before-fix/localOperatorDark.webp     press-800x600-after-fix/localOperatorDark.webp
press-800x600-before-fix/localOperatorLight.webp    press-800x600-after-fix/localOperatorLight.webp
press-1380x900-before-fix/localOperatorDark.webp    press-1380x900-after-fix/localOperatorDark.webp
```

`before-fix` is the BUILT app of unmodified `origin/main` (`8f80697c8`), which is
the v0.24.0 the operator runs; `after-fix` is this branch's own build. Each
`<theme>.json` beside the frames in the capture directory holds the raw
readings; the table below is read off those.

## What moves, in numbers

Every scrolling box in the ancestor chain of the composer chip and of the To-dos
section was read before and after a real `Input.dispatchMouseEvent` press at the
chip's painted centre. `scrollLeft` of the chat column's slot row
(`div.relative.flex.h-full`, the row holding the chat column and the run pane),
the chat column's and composer's `left`, and the pane's `left`:

| window (CSS viewport) | theme | row `scrollLeft` before → after | chat column `left` | composer `left` | pane `left` |
| --- | --- | --- | --- | --- | --- |
| 1024x673 (1024x641) before-fix | dark | **0 → 108** | 500 → **392** | 500 → **392** | 613 |
| 1024x673 (1024x641) before-fix | light | **0 → 108** | 500 → **392** | 500 → **392** | 613 |
| 1024x673 (1024x641) after-fix | dark | 0 → **0** | 500 → **500** | 500 → **500** | 721 |
| 1024x673 (1024x641) after-fix | light | 0 → **0** | 500 → **500** | 500 → **500** | 721 |
| 800x600 (800x568) before-fix | dark | **0 → 221** | 500 → **279** | 500 → **279** | 500 |
| 800x600 (800x568) before-fix | light | **0 → 221** | 500 → **279** | 500 → **279** | 500 |
| 800x600 (800x568) after-fix | dark | 0 → **0** | 500 → **500** | 500 → **500** | 721 |
| 800x600 (800x568) after-fix | light | 0 → **0** | 500 → **500** | 500 → **500** | 721 |
| 1380x900 (1380x868) before-fix | dark | 0 → 0 | 500 → 500 | 500 → 500 | 961 |
| 1380x900 (1380x868) after-fix | dark | 0 → 0 | 500 → 500 | 500 → 500 | 961 |

Three facts the table carries, and one it deliberately does not:

- **1024x673 is the operator's own window.** The press slid the chat column, the
  transcript and the composer 108px sideways, under the sidebar: the column's
  `left` and its content moved with the row, and the frames show the transcript
  running underneath the chat list. The composer also moved UP 26px in both
  builds, because the column narrows when the pane opens and the composer band
  wraps taller — a layout fact of the pane opening, not of the walk, and it is
  unchanged by the fix.
- **At 800x600 the same walk moves the column 221px.** The pane does not fit
  beside the column at either width, which is what gave the walk something to
  grab: the row has 116px of horizontal scrollable overflow at 1024 and 340px at
  800.
- **At 1380x900 nothing moved in either build**, because the row fits there and
  the walk had nothing to move. That is why this survived: the default window the
  app opens in is the one size where the defect is invisible.
- **The vertical axis is not reproduced, and the numbers say so.** No ancestor of
  the pane ever had vertical scrollable overflow (`scrollHeight - clientHeight`
  was 0 for every box outside the pane, at 1380x900, 1024x673 and 800x600, in
  both builds), so no ancestor can scroll vertically: the frame shift this
  reproduces is the horizontal one, plus the composer's own 26px reflow above.

## What the fix is

The reveal now computes the To-dos section's offset inside the pane's own
scroll region and assigns `region.scrollTop` (`shared/lib/scroll.ts`,
`scrollRegionToTop`), instead of asking a browser to walk the chain. The region
still scrolls when it has to — with the pane open and its region already at
the bottom, the same press takes it from 346 back to 0 at 1024x673 — and no
ancestor is touched either way. The reader-first, request-holding, nonce-retirement
and focus-stays-put behaviours the effect encoded are unchanged.

## Reproducing

An isolated backend, a seeded session, and the app paired to it. Nothing here
touches the operator's own backend, config dir, sessions or window.

```sh
# 1. An isolated backend with a plan in it. Never the live config dir.
node scripts/seed-plan-session.mjs /tmp/loui-plan/config 8
cd ~/local-operator                    # the backend repo
LOCAL_OPERATOR_CONFIG_DIR=/tmp/loui-plan/config \
LOCAL_OPERATOR_DESKTOP_TOKEN=$(openssl rand -hex 32) \
OPENROUTER_API_KEY=<dev key> \
  .venv/bin/python -m local_operator.cli serve --host 127.0.0.1 --port 18111
# ... and one provider credential in it, or the app opens its first-run modal
# over the whole window and swallows the press. This is the app's own credential
# path (the settings UI's), and the one the provider census reads: a key left in
# the backend's environment is not "connected" as far as `decideFirstTimeUser`
# is concerned. `GET /v1/auth/providers` then reports `configured: true`:
curl -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"value\":\"$KEY\"}" http://127.0.0.1:18111/v1/auth/providers/openrouter/key

# 2. The app, built against that port (VITE_LOCAL_OPERATOR_API_URL in `.env`,
#    VITE_DISABLE_BACKEND_MANAGER=true), launched headless and driven.
cd <repo> && pnpm install && pnpm build
LOCAL_OPERATOR_DESKTOP_TOKEN=$TOKEN LOCAL_OPERATOR_CONFIG_DIR=/tmp/loui-plan/config \
  node scripts/run-panel-reveal-proof.mjs --session=<seeded id> \
  --backend=http://127.0.0.1:18111 --width=1024 --height=673
```

`--window-mode=headless` (through `pnpm app:headless` or the switch the proof
script sets) is what keeps the operator's focus; the proof script also uses its
own `--user-data-dir` under the system temp dir and strips any inherited
`CMUX_*` variable, so a run cannot rename the operator's real workspaces. The
backend is a real `local_operator` server; only its conversation content is
synthetic.

## Re-checked on the rebased base

This branch was rebased onto `d0f86ffaf` (the 0.24.1 bump and #169's
draft-splash/hydration fix, which touches `run-child-reader.tsx` — no overlap
with the three files this change edits, and no scroll behaviour added upstream).
The rebased build was re-driven at all three sizes and the readings are
identical to the table above: no mover, chat column at `left: 500`, composer at
`500`, pane at `721` (1024, 800) and `961` (1380).

The frames were re-taken and compared against these committed ones rather than
assumed valid: at 1024x673 / 800x600 / 1380x900 the layout is identical and the
only differing pixels are the content this set already declares as live — the
transcript's clock and the MCP section's rows and tally (2.0% / 1.3% / 4.4% of
pixels, all inside those regions; the dark ground and every rect measure the
same). No frame was replaced for the rebase.

## Provenance and the limits of these frames

- The app is the BUILT one (`pnpm build` + `npx electron .`), never `pnpm dev`:
  the dev build paints a development-only strip over the header this surface
  starts at (`docs/evidence/chat-title/README.md`).
- The press is a real CDP mouse press at the chip's painted centre, after asking
  the page which element owns that point, so a chip that is painted but not
  hit-testable would fail the run rather than pass it.
- **CDP focus emulation is ON** (`Emulation.setFocusEmulationEnabled`). A window
  that is never shown cannot be focused, and a key event is dropped without it —
  the runs need Escape to close the pane first, which is the pane's own ladder.
  The visible consequence is the focus ring around the composer in every frame.
- **The MCP section is live and its height varies between runs** (it is a real
  read of MCP status against the isolated backend, and servers settle between
  captures): the 1024x673 dark pane's own region has 346px of vertical overflow
  and the light one 186px in the after-fix captures. Nothing in the table above
  depends on it — the compared facts are ancestor scroll offsets and the
  column/composer/pane rects — and the pane's own region still ends at the top of
  the To-dos section in every run.
- These frames cannot come from `pnpm capture-evidence`: a sweep photographs
  Storybook stories, and this claim is about the app's whole frame in a real
  window at three sizes, over a backend. That is why the set is declared
  `supplementary` rather than swept.
- **Not everything here is evidence about a fix.** The pane's own fit at these
  widths is unchanged and unfixed: with the walk removed, the pane sits at
  `left: 721` and its right 116px is clipped at 1024 (340px at 800). That is the
  pane's existing behaviour on its other opening path too — opening it from the
  header trigger on unmodified `origin/main` leaves the row at `scrollLeft 0`
  with the pane at `left: 721, right: 1140` in a 1024px viewport — so the reveal
  used to MASK the clipping rather than cause it. Making the pane fit is a
  layout decision of its own (the pane's 320/420/640 width contract, and the chat
  column's own minimum), and it is not this change.
