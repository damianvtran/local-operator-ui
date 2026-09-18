# The citation in a sent message, and the fenced case that stays text

Three stories, twelve themes, 36 frames, at the 1024x620 pane
`chat-canonical-user-card-measure` uses — plus the 36-frame before half beside
them in `../chat-canonical-credential-citation-before/`.

| State | What it is |
| --- | --- |
| `citation-mid-sentence` | the operator's own report: a stored credential cited mid-sentence, which must stay INSIDE its paragraph |
| `citation-not-stored` | the same shape in the warning register, for a value that did not survive (`describeUnstored`) |
| `citation-in-code-fence` | the citation's own text inside a fenced block, which the transform must leave byte-identical |

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
- **The agent's half.** Agent output is deliberately NOT chipped (`MarkdownRenderer`'s
  `credentialCitations` prop is opt-in and only the two user-turn paths set it),
  so no frame here speaks for what an agent's message looks like — it is
  unchanged, which is the point.

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
