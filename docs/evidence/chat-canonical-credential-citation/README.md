# The citation in a sent message, and the fenced case that stays text

Eight states, twelve themes, 96 frames, at the 1024x620 pane
`chat-canonical-user-card-measure` uses — plus the 72-frame before half beside
them in `../chat-canonical-credential-citation-before/`.

| State | What it is |
| --- | --- |
| `citation-mid-sentence` | the operator's own report: a stored credential cited mid-sentence, which must stay INSIDE its paragraph |
| `citation-not-stored` | the same shape in the warning register, for a value that did not survive (`describeUnstored`) |
| `citation-unconfirmed` | the third register: a store the session never answered, where the app says so instead of claiming an outcome |
| `citation-unconfirmed-narrow` | the same citation at the 440px rung, where a key-bearing label has to clamp rather than run out of its own bubble |
| `citation-in-code-fence` | the citation's own text inside a fenced block, which the transform must leave byte-identical |
| `citation-multiline` | (2026-09-25) the second report's own shape: the fields on their own lines, both citations chipped, lines kept |
| `plain-multiline` | the same surface with NO citations: this is about the reader's own turn, not about chips |
| `agent-multiline` | the control: an agent-side answer with single newlines, which keeps CommonMark's collapse and must not move |

The command that wrote them, from the tree this branch commits:

```
npx storybook dev -p 6018 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-canonical-credential-citation \
  --allow-backend http://127.0.0.1:6018
```

The before half needs a different recipe and is declared in `manifest.json`'s
`supplementary`: this branch's story file, with main's own `markdown-renderer.tsx`,
`message-content.tsx` and `canonical-transcript.tsx` checked out over it and the
story title temporarily suffixed `before` so the ids land in their own directory.
It carries the operator's report as pixels — the whole citation sentence inside
the reader's own bubble — which the after frames cannot show, because the change
removed it.

WHAT THESE FRAMES DO NOT SHOW, and where each claim lives instead:

- **That the text is unchanged.** A frame cannot show that the message, the
  draft, the payload and the prompt never moved; the render-only property is
  structural (`credential-citation-remark.ts` runs in the markdown pipeline and
  nothing else was touched), and the shape of the transform — the citation
  mid-sentence, two of them, the lookalikes, the fenced and inline-code cases —
  is pinned in `scripts/credential-capture.test.mjs`.
- **The chip's geometry.** These chips are laid out inline by the browser rather
  than at a measured box, so there is no run box to cover here; the measured pair
  belongs to the composer and is printed by
  `scripts/credential-chip-geometry.mjs`.
- **The agent's half, in words.** Agent output is deliberately NOT chipped
  (`MarkdownRenderer`'s `credentialCitations` prop is opt-in and only the two
  user-turn paths set it). `agent-multiline` is the one frame that does speak
  for it — the soft-break transform's control — and its before/after pair is
  identical on purpose: an agent's answer is a markdown document, and
  CommonMark's collapse is its contract.

---

## Round 1's remediation: two rules added, no pixel moved

The transcript chip's rendering is unchanged this round — the modifications
`git status` reports in this set are encoder and caret noise (0 px at a 5%
fuzz), and all three states were re-captured from the code commit that landed
the round (`a5227de6c`) so the committed bytes are a picture of that tree.

Two rules the reviews asked for land in the render path and are pinned in
`scripts/credential-capture.test.mjs`:

- **Provenance** (QA Q1): a markdown link is a citation only when its own
  VISIBLE TEXT is the citation its URL names. The private scheme's shape alone
  was satisfied by a hand-typed `[sneaky](#lo-credential/LOP_SECRET_ZZZZZZZZ/19)`,
  and the frame drew the app's own receipt for it.
- **The math veto** (code review R1-1): every citation carries one `$`, so
  `containsLatex`'s `$…$` matched ACROSS two citations on one line and
  `remark-math` — a micromark SYNTAX extension, so it runs at parse time, before
  any remark plugin sees a tree — split them: neither reference was chipped and
  the words between them were typeset as a formula. `markdown-math.ts` now makes
  that decision with the citation in hand, and when both are present the
  citation wins (the formula renders as its own source).

And one accessibility change: the citation's full sentence, which a `title` on a
non-focusable span had reduced to a pointer-only affordance, is back in the
accessibility tree in a visually hidden element beside the words the chip shows.

### Re-captured after the fold onto `3cb1eea3c`, and why it did not move

`#311` rewrote the renderer's anchor while this branch was open, so all three
states were re-captured from the rebased tree — and all three came back
BYTE-IDENTICAL to the committed set. That is the end-to-end proof that the new
anchor and its `urlTransform` leave the citation chip alone: the transform falls
through to `defaultUrlTransform` for a `#`-fragment, and the override delegates
to `MarkdownAnchor` for every link that is not a citation.

---

## Round 2: the reader's own line breaks (2026-09-25)

A second report, a second shape: a message sent with `Prod:` / `Email: …` /
`Password: …` each on its own line read back as ONE line — `Prod: Email: …
Password: …` — because a single newline inside a paragraph is a markdown SOFT
break: a line ending inside a `text` node's value, which HTML collapses to a
space unless something turns it into a `break` node first. The fix is
render-only: `utils/remark-soft-breaks.ts` walks the tree and every soft break
becomes one `break` node (`<br>`), hand-rolled rather than a new dependency
(`remark-breaks` is not one of this repository's deps), and
`markdown-renderer.tsx` appends it to the four citation-bearing pipelines — the
renderer's user-turn pipelines. Agent output keeps CommonMark's collapse; its
four pipelines are untouched. `scripts/soft-breaks.test.mjs` pins the transform
over real mdast trees, the pipeline end to end over the three shapes, and the
wiring itself (four pipelines carry it, four do not).

The commands that wrote the after frames, from the tree this branch commits
(both under `LOCAL_OPERATOR_UI_THEME_SETTLE_MS=120000` — this pass ran at a
fleet load where a cold story compile outlived the shipped 10 s theme budget:
measured, the first attempt died on `document carries theme "" after 10s` and
the same story captures warm):

```
npx storybook dev -p 6018 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-canonical-credential-citation \
  --dirs=citation-multiline,plain-multiline,agent-multiline \
  --allow-backend http://127.0.0.1:6018
node scripts/capture-evidence.mjs --only=chat-canonical-credential-citation \
  --dirs=citation-mid-sentence,citation-not-stored,citation-unconfirmed,citation-unconfirmed-narrow,citation-in-code-fence \
  --allow-backend http://127.0.0.1:6018
```

The before half needed its own recipe, as round 1's did and a shorter one:
this branch's story file with `origin/main`'s own `markdown-renderer.tsx`
checked out over it — ONLY that file, because the fix's other half is a module
main does not have and neither user-turn call site moved — the title
temporarily suffixed `before` so the ids land in
`../chat-canonical-credential-citation-before/`, and three `-before` entries
added to `STORIES` for the run. All three edits were reverted afterwards and
the tree verified against the commit (an empty `git diff` outside
`docs/evidence`); the manifest's `supplementary` entry carries the record.

What the pair proves, and what it does not:

- The three new states' pairs ARE the claim: the before frames are the
  collapsed report (`citation-multiline`), the collapsed plain message
  (`plain-multiline`), and the agent control, which is identical in both halves
  by construction.
- **The five pre-existing states moved no pixel because of this change.** The
  pass re-took them at this head: 24 of the 60 frames are BYTE-IDENTICAL to
  their committed predecessors (both `citation-unconfirmed` states, all twelve
  themes) and the other 36 differ only in the ways the set's own ground has
  moved since it was last captured — its bytes date from 2026-09-19/20, and the
  rig drives the SYSTEM Google Chrome, which updated 152.0.7933.0 →
  154.0.8037.58 on 2026-09-23, mid-window. At a 5% fuzz the difference is
  66–276 px per frame except `tokyoNight`'s three (1,348–2,875 px), and it sits
  on glyph and border antialiasing, which is where a browser's rasterisation
  drift lands. The measurement that isolates the transform from all of it:
  re-capturing TWO states (`citation-mid-sentence`, `citation-in-code-fence`,
  all twelve themes) with `origin/main`'s own `markdown-renderer.tsx` over this
  HEAD reproduced every one of the 24 frames at **0 px at a 5% fuzz** (22
  byte-identical; the last two sub-fuzz re-capture noise). Structurally: no
  fixture here contains a soft break, so the plugin adds zero `break` nodes to
  any of them.
- That the residual is not the rig misbehaving, either: re-capturing a single
  frame a second time on the same tree is byte-identical, so what moved against
  the committed predecessors is the set's own age rather than capture noise.
- The frames remain the reader's own turn ONLY: nothing here says an agent's
  answer should keep its soft breaks, and `agent-multiline`'s identical pair is
  the frame that says so.
