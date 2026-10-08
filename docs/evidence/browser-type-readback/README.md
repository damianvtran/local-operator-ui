# `type` read-back on the value-setter fallback (#871), against the built app

Issue #871: when `Input.insertText` does not land, `type` falls back to the node's
value setter and used to report what the setter's own function returned (the
value read in the same breath as the write). A field that takes the write and
reverts it on the next tick was therefore answered `ok: true` / "Value is now ...".
The fix (`73c1602981d`) reads the field back again, independently, in the node's
own session and refuses when it does not hold the text.

This is the real-Chromium reproduction and pass. `scripts/browser-host-proof.mjs`
§5c-ii boots the BUILT app headless (scratch HOME, config, log dir and
`--user-data-dir`; `--window-mode=headless`; `CMUX_*`/`LOP_*` removed), drives its
real `/rpc`, and reads every field back from the page's or frame's OWN devtools
target, never from the host's reply.

| | commit |
| --- | --- |
| before: base `src/main/browser/actions/input.ts` | `c14e07d95b0` (origin/main this branch was cut from) |
| after: this branch's fix, harness section included | `73c1602981d` (fix) + `06d827f64fc` (unit tests), with the harness at `f4f9e0060c4` |

The harness (`f4f9e0060c4`) is identical on both sides; only `input.ts` differs.
`transcript-before.md` is the harness with `git checkout c14e07d95b0 -- src/main/browser/actions/input.ts`
rebuilt; `transcript-after.md` is the same harness with the branch's `input.ts`.

## The fixture

A top document and a cross-site frame (`127.0.0.1` page, `localhost` frame: a
different site, so its own process and devtools target), each holding three fields:

- `revert`: refuses `insertText` (cancelled `beforeinput`), so the primary path's
  read-back disagrees and the setter fallback is what runs; restores `''` one
  macrotask after any `input` event. A precondition check proves the page really
  does take a setter write and give it back (`instant: "x"`, `later: ""`).
- `setter-only`: refuses `insertText` the same way but keeps a setter write: the
  control that the fallback still lands (`via: value_setter`).
- `keep`: an ordinary input: lands via `insert_text`.

## What flipped

| check | before (`c14e07d95b0`) | after |
| --- | --- | --- |
| `type at a top-document field that reverts the write is REFUSED, and the field reads back empty` | `[FAIL]` `ok:true`, `via: value_setter`, `value: "4000056655665556"`; field reads `""` | `[PASS]` `element_not_found`: `#top-revert took the value-setter write but does not hold the text (read back ''), so nothing was reported typed`; field `""` |
| `type at a cross-site frame field that reverts the write is REFUSED, and the field reads back empty from the frame's own target` | `[FAIL]` `ok:true`, `via: value_setter`, `frame_origin` set; frame field reads `""` | `[PASS]` same refusal naming `iframe#rv >>> #frame-revert`; frame field `""` |

Unchanged and passing on both sides: the fixture precondition, the iframe-element
refusal (three fields, nothing typed), both `setter-only` controls (top document
and frame land via `value_setter`, read back equal) and the `keep` control (via
`insert_text`). The before run's two `[FAIL]`s here are therefore exactly the
claim of #871, and nothing else regressed.

## The two cookie `[FAIL]`s present on both sides

`the persistent cookie is in Chromium's own store, with the flags to match` and
`MEASURED: a persistent cookie survives the restart` fail identically before and
after and are unrelated to `type`; same pre-existing failures as
`docs/evidence/browser-type-iframe/README.md`. (The transcripts' two cookie
`[FAIL]` lines are the sqlite3 read and the post-restart `/echo`.)

## Re-running it

```bash
# A tree without a .env needs the four build variables; inert placeholders do.
VITE_GOOGLE_CLIENT_ID=inert VITE_GOOGLE_CLIENT_SECRET=inert \
VITE_MICROSOFT_CLIENT_ID=inert VITE_MICROSOFT_TENANT_ID=inert \
  pnpm build:npm
node scripts/browser-host-proof.mjs
# before side: git checkout c14e07d95b0 -- src/main/browser/actions/input.ts, rebuild, rerun
```

Scratch paths in the transcripts are rewritten to `<scratch>`, `<worktree>` and `<home>`.
