# Approvals card: the user's palette on first paint (#1488)

The operator's report: the approvals card opened painted in the default
`localOperatorDark` palette and corrected to the user's theme about a second
later (v0.46.0). The frames below are that same card document, loaded in an
OFFSCREEN Chromium window at the card's own viewport and captured from its own
surface — first paint (no model yet) and after one real model was pushed through
`window.__approvalsCard.setModel`, in a custom dark palette (`obsidian`) and a
light one (`kanagawaLotus`).

| frame | tree | reading |
| --- | --- | --- |
| `first-paint-obsidian-before.png` | `main` @ 20225f3 | brand `localOperatorDark`: warm charcoal card, brand-green primary. `data-theme=localOperatorDark` |
| `after-model-obsidian.png` | `main` @ 20225f3 | the model arrives and corrects it to `obsidian`: neutral grey card, white primary. This is the correction the operator saw |
| `first-paint-obsidian-after.png` | `fix/approvals-first-paint-palette` | `obsidian` already at first paint — its sampled card background equals the model's own paint, though the frames are not byte-identical. The post-model frame has `sha256 03c7f947…` in both trees |
| `first-paint-kanagawaLotus-before.png` | `main` @ 20225f3 | the mode default is `localOperatorLight`: white card, brand-green primary |
| `first-paint-kanagawaLotus-after.png` | `fix/approvals-first-paint-palette` | `kanagawaLotus` cream and navy at first paint |
| `after-model-kanagawaLotus.png` | either tree | the model's paint of the same card, unchanged |

`first-paint-facts.json` holds both runs' numbers: the palette the document URL carried,
the `data-theme` timeline read by a document-start preload, and the card's
background pixel sampled from each captured surface.

## What these frames are not

Only the card document. The window is offscreen, so nothing here shows the
native composite over a live page, the transparent ring over page content, or
Windows/Linux behaviour — those stay unproven here.

## Reproducing

```sh
# after: both cases must agree, else non-zero
node scripts/browser-approvals-first-paint-probe.mjs --out /tmp/first-paint --require-match

# before: run the same command from main without the fix; --require-match must fail
node scripts/browser-approvals-first-paint-probe.mjs --out /tmp/first-paint-before
```

The card document is served from the repo's own source over loopback, so no build
step is needed; the Electron child runs with a private `--user-data-dir`, the mock
keychain switch, and reaps its exact process group on exit.
