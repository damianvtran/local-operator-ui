# The composer's notice, every arm of the copy table

Not swept, and not a Storybook set. These are **rendered frames of the shipped
`MessageInput`**, taken from a private headless Chrome by
`scripts/composer-alert-geometry.mjs` — one command, its own vite page, its own
`--user-data-dir`, killed on exit — plus its BEFORE half, taken by the same
command at unmodified `origin/main`.

## What each frame is

Every state is rendered by the SHIPPED composer, with the app's own stylesheet,
palette and font faces, through the same `sendError` contract the chat pane
passes it. The notice's own copy is imported from the code that writes it (the
table in `canonical-sessions-store.ts`, the transport's backstop in
`desktop-transport.ts`, the renderer's pre-flight in `message-budget.ts`), so no
frame can show a sentence the app is unable to produce.

| frame | state | what it shows |
|---|---|---|
| `<w>-notice.*` | unknown outcome (the 20 s transport deadline's class) | the operator's own failure: the message and its chip are IN the box, and the notice is ONE sentence with `Retry` and `Clear` |
| `<w>-unreachable.*` | nothing answered (`transport.failed`) | the same two controls, because a press is safe and the message may not have gone |
| `<w>-too-large.*` | the transport's byte-budget backstop | the app's real sentence, and `Clear` only — a press meets the same limit |
| `<w>-too-long.*` | the renderer's character pre-flight | the app's real sentence with its own numbers, and `Clear` only |
| `<w>-gone.*` | a 404: the conversation does not exist | `Clear` only |
| `<w>-muted.*` | the send lock | one muted line, NO controls |
| `<w>-delivered.*` | the late confirmation over the user's own edit | one muted line, no controls, and no chip (the user's draft is their own) |
| `<w>-idle.*`, `<w>-edited-idle.*` | the two baselines | the same drafts with NO notice, which is what makes the others a statement about the notice |

`<w>` is the column width the chat area leaves at a 1440px window: `892` (both
sidebars), `472` (the app's compaction threshold) and `172` (a window with the
canvas pane open — the narrowest the app reaches). The `-sage`/`-iceberg` frames
are the `notice` arm in two of the five themes whose two ink roles the design
round measured 1.05-1.11 apart (D2).

## The before half

`892-unreadable*`, `472-unreadable*`, `172-unreadable*`, `*-split*` and
`*-idle*` are **`origin/main`'s own committed rig** (`scripts/
composer-alert-geometry.mjs` at `origin/main`, run from a detached worktree),
photographing the screen this change replaces: the same composer, the old
region with its capped, internally-scrolling prose block, the refusal's sentence
**plus** the explanatory paragraph under it (`892-split.png` is the clearest:
"The text of your refused message was restored, but not its files…"), which is
the grey paragraph the operator reported.

The pairing is therefore one instrument, one window, one theme, two trees. **It
is not** the operator's own screenshot, and no frame here is claimed to be: the
operator's screen was the timeout arm with the held-message paragraph and
`Restore message`/`Discard message`, and the committed
`../chat-cold-send-browser/admission-timeout` is a capture of that screen from
2026-09-14 (with different red text). `../chat-cold-send-browser/README.md` now
says so where it used to imply the frame was the operator's exact screen (review
round 1, m4).

## What this set asserts, and what it does not

The run fails, and writes no frame, unless every arm shows: one sentence block,
the control set its own row of the table gives (by label), the register its class
gives, no jargon (`held`, `admission`, `owner`, `request id`), and — the number
the rig exists for — **the line the user is typing does not move** when the
notice renders, against the same draft with no notice. `Retry`'s computed font
weight is measured as heavier than `Clear`'s wherever both are offered (D2).

It does NOT prove: a packaged build, the Electron IPC hop (the page takes the
transport's Http path, as the sibling rig documents), screen-reader behaviour, or
anything about a real send — that is `../composer-timeout-live/`, which drives
the same composer through a real 20 s deadline.
