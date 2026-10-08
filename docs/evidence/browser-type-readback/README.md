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
| after: this branch's `input.ts` | head of the branch (`73c1602981d` plus the round 1 remediation) |

The harness is identical on both sides; only `input.ts` differs. Round 1 of the
review (a masking field the first cut falsely refused, and a revert later than the
next tick) added the `late-revert` and `mask` fields, so these transcripts were
re-taken. `transcript-before.md` is the harness with
`git checkout c14e07d95b0 -- src/main/browser/actions/input.ts` rebuilt;
`transcript-after.md` is the same harness with the branch's `input.ts`.

## The fixture

A top document and a cross-site frame (`127.0.0.1` page, `localhost` frame: a
different site, so its own process and devtools target), each holding five fields:

- `revert`: refuses `insertText` (cancelled `beforeinput`), so the primary path's
  read-back disagrees and the setter fallback is what runs; restores `''` one
  macrotask after any `input` event. A precondition check proves the page really
  does take a setter write and give it back (`instant: "x"`, `later: ""`).
- `late-revert`: the same, but restores `''` 40 ms later, which an immediate
  re-read cannot see and the host's settle window (100 ms) can.
- `mask`: groups digits in fours on every `input`. It really holds what was typed,
  in another spelling, so it must LAND; a byte-for-byte comparison would refuse it.
- `setter-only`: refuses `insertText` the same way but keeps a setter write: the
  control that the fallback still lands (`via: value_setter`).
- `keep`: an ordinary input: lands via `insert_text`.

## What flipped

| check | before (`c14e07d95b0`) | after |
| --- | --- | --- |
| `type at a top-document field that reverts the write is REFUSED, and the field reads back empty` | `[FAIL]` `ok:true`, `via: value_setter`, `value: "4000056655665556"`; field reads `""` | `[PASS]` `element_not_found`: `#top-revert took the value-setter write but does not hold the text (read back ''), so nothing was reported typed`; field `""` |
| `type at a cross-site frame field that reverts the write is REFUSED, and the field reads back empty from the frame's own target` | `[FAIL]` `ok:true`, `via: value_setter`, `frame_origin` set; frame field reads `""` | `[PASS]` same refusal naming `iframe#rv >>> #frame-revert`; frame field `""` |
| `type at a top-document field that reverts the write 40 ms later is REFUSED, and the field reads back empty` | `[FAIL]` `ok:true`, `via: value_setter`; the transcript shows the field still holding `"4000056655665556"` at the time of the read (the fixture reverts it to `""` 40 ms after the write, by construction; no later read is taken) | `[PASS]` refused; field `""` |
| `type at a cross-site frame field that reverts the write 40 ms later is REFUSED, ...` | `[FAIL]` `ok:true`, `via: value_setter` | `[PASS]` refused |
| `type aimed at the multi-field iframe ELEMENT is refused, never answered ok for text no frame field holds` | `[FAIL]` `ok:true` (the descent lands on the frame's focused, reverting field and the old code echoes the setter) | `[PASS]` refused; every frame field reads `""` |

The `ELEMENT` row is an invariant rather than a fixed message: focusing an
`<iframe>` element hands focus back to the field the frame last focused, so the
call is the candidates refusal or a type at that field depending on focus state.
Either way the host must not answer `ok` for text no field holds.

## What did NOT flip (regression guards)

| check | before | after |
| --- | --- | --- |
| `the control: a masking field in the top document (digits grouped in fours) LANDS ...` | `[PASS]` `ok:true`, `via: value_setter` (with `insert_text_readback` set), `value: "4242 4242 4242 4242"` | `[PASS]` `ok:true`, `via: insert_text`, same value: same outcome (ok, same value), a different path |
| `the control: a masking field in the cross-site frame LANDS ...` | `[PASS]` (same outcome as the top document) | `[PASS]` same outcome (ok, same value) |
| both `setter-only` controls (`via: value_setter`), the `keep` control (`via: insert_text`), the fixture precondition | `[PASS]` | `[PASS]` |

The masking rows are the reason round 1 exists: the first cut of the fix compared
the read-back to the typed text byte for byte, so on this fixture it refused a card
field that held `4242 4242 4242 4242`. Those rows pass on the base (which echoed
success) and must keep passing on the fix.

## Limit

The host re-reads the field once, 100 ms after its setter write. What was
MEASURED (QA round 2, eight trials per context, a setter-path field that reverts
after N ms): reverts at 16, 40, 50 and 80 ms were refused 8/8 in each context
(top document and cross-site frame); a revert at exactly 100 ms races the host's
own 100 ms timer and was refused 6/8 in the top document and 6/8 in the frame,
the other two answering `ok`; reverts at 120 ms and 300 ms were not caught. So:
caught reliably up to about 80 ms, racing at 100 ms, not caught from 120 ms. A
later revert (a debounced validation, an async re-render, a network-backed check)
is not seen at `type` time, by this check or by any read-back taken while `type`
runs, and `type` still answers `ok`. This change narrows the gap from "never" to
"about 80 ms"; it does not claim to close it.

"Holds the text" means the field's value contains the typed content after folding
case, spacing, punctuation and combining marks (masks rewrite those): a field
that drops characters (a digits-only mask turning `abc123` into `123`) is
refused, and one that keeps all of them is not. The same fold has two accepted
residuals. A field that already holds text fold-equal to what was typed (`42`
into a field holding `4242`, which also passed before the fold; `4-2` or
`UNRELATED` into one holding `4242` / `unrelated`), or that reverts the write to
a previous value fold-equal to the new text (`John Smith` -> `john-smith`), is
reported typed. The reply's `value` is the field's real content, so `ok` means
"the field holds the text", not "the field changed".

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
