# `type` aimed at a cross-site iframe — the live before/after

The fix is `fix(browser): type refuses a non-editable target instead of echoing
its own write`. Its unit tests run the real injected functions against fake
elements; these transcripts are the same claim measured on a real Chromium page
in the BUILT app, driven over the real `/rpc` by `scripts/browser-host-proof.mjs`.

## What the proof page is

`/iframe-type` on the harness's loopback site (`127.0.0.1`) holds a top-level
`#holder` field and an `<iframe id="card">` whose document comes from a SECOND
loopback server addressed as `localhost` — a different site, so Chromium gives
the frame its own process and target, the way it treats a payment provider's
card frame. Section 5c of the harness:

1. checks the frame loaded cross-site, as its own `iframe` target;
2. calls `type {selector: "#card", text: "4242424242424242"}` and asserts the
   typed `element_not_found` refusal naming the cause;
3. reads the top document for a `value` expando on `#card`, and the frame's OWN
   target (over CDP) for the text of its `#number` field — nothing may be written
   in either place;
4. types into `#holder` on the same page as the control.

## The files

| file | what it is |
| --- | --- |
| `transcript-proof-before.md` | The harness at the base input code (`input.ts` from `25561e029`, everything else as on this branch), built with `pnpm build:npm`. `type` at the iframe answers `ok: true`, `{"value":"4242424242424242","via":"value_setter","insert_text_readback":""}`, and the top document's `#card` now carries an own `value` property holding the card number — the false success, measured. The frame's own field is empty. |
| `transcript-proof-after.md` | The same harness at this branch's head. `type` at the iframe answers `ok: false`, `element_not_found`, `#card is not an editable field (no value setter, not contenteditable), so nothing was typed; if the field lives inside an iframe, it cannot be targeted from the top document`; no expando is left on `#card`; the frame's field is empty; the `#holder` control still lands via `insert_text`. |

The bridge `session_key` in each transcript's state record is replaced with
`[redacted]`, and machine paths are shortened to `$TMPDIR` / `<worktree>`.
Nothing else is edited.

## What the refusal does NOT show

The frame's field is not filled — the fix makes the failure honest, it does not
make the frame reachable. No selector, ref or snapshot reaches into a cross-site
frame from the top document today; that is the follow-up named in the PR.

## The two `[FAIL]`s present on both sides

`the persistent cookie is in Chromium's own store, with the flags to match` and
`MEASURED: a persistent cookie survives the restart` fail IDENTICALLY before and
after, and are unrelated to `type`: the cookie store reads empty after the run's
clean quit on this machine. `docs/evidence/browser-oauth-popups/README.md`
recorded the same two failures on another branch's base. The before side's other
two `[FAIL]`s are the iframe checks this change fixes. The frontmost sampler
skipped on both runs (`the OS never answered a frontmost sample`).

## Re-running it

```bash
# A tree without a .env needs the four build variables; inert placeholders do.
VITE_GOOGLE_CLIENT_ID=[redacted] VITE_GOOGLE_CLIENT_SECRET=[redacted] \
VITE_MICROSOFT_CLIENT_ID=[redacted] VITE_MICROSOFT_TENANT_ID=[redacted] \
  pnpm build:npm
node scripts/browser-host-proof.mjs
```

The harness's isolation (scratch `HOME`, config dir, log dir and
`--user-data-dir`, headless, every `CMUX_*`/`LOP_*` variable removed) is unchanged
by this section. For the before side, check out `src/main/browser/actions/input.ts`
from `25561e029`, rebuild, and run the same command.
