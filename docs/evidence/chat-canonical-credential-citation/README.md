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
