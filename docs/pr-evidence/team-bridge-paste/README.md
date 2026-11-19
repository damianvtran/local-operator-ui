# Team Bridge pasted images: the staged-value seam

**What this set is.** Two runs of one script, on two trees, against one recording
stub: `scripts/team-bridge-staged-upload-seam.mjs`. It is the SEAM the operator's
report lives in — a staged value from the composer's paste handler, carried by the
send's own module to the hub — and it prints the failure rows the page renders and
the bytes the hub received.

```bash
node scripts/team-bridge-staged-upload-seam.mjs --expect broken   # origin/main 65116989dc9
node scripts/team-bridge-staged-upload-seam.mjs --expect fixed    # this branch
```

No Electron window, no browser engine, no pasteboard write, one loopback port.

## base tree — origin/main 65116989dc9 (version 0.50.6)

```
cell            | staged              | ids | failures (name | reason)                                             | received
paste-png       | dataUrl/72936       | 0   | qnrDJOb2aTAAAAAASUVORK5CYII= | read                                    | none
paste-three     | dataUrl/4456+8116+8408 | 0 | vAAAAABJRU5ErkJggg== | read ; …ElFTkSuQmCC | read ; w8JotSQakzwBAAAAABJRU5ErkJggg== | read | none
paste-corrupt   | dataUrl/24          | 0   | png;base64,bm90IGEgcG5nIGF0IGFsbA== | read                          | none
file-picker     | path                | 1   | none                                                                    | 3340B 240x160 image/png
```

Six of six assertions pass, and each one states the operator's symptom: the row's
name is the **base64 tail** of the payload (the PNG IEND marker ends a base64
stream), the reason is `read`, and **zero bytes** reach the hub for every paste
cell. The picker control passes in the same run, which is why "primarily when
pasted" is a fact about the paste path rather than about attachments in general.

## fix tree — this branch

```
cell            | staged              | ids | failures (name | reason)        | received
paste-png       | dataUrl/72936       | 1   | none                            | 54701B 1600x1000 image/png sha c17f002a7048549f…
paste-three     | dataUrl/4456+8116+8408 | 3 | none                            | 3340B 240x160 ; 6087B 320x200 ; 6304B 200x320 (sha256 each)
paste-corrupt   | dataUrl/24          | 0   | Pasted image | unsupported        | none
file-picker     | path                | 1   | none                            | 3340B 240x160 image/png
```

Five of five assertions pass. A pasted picture now reaches the hub as its own
bytes; three pictures produce three uploads; a genuinely corrupt image still
reports a reason from the closed set with a neutral name (`Pasted image`) that
carries **no base64 run and no `data:` prefix**; the picker control is unchanged.

## Frames in `frames/` — who made them and what they are

Captured by the **designer** (design lane) from the **Storybook harness**; nothing
in this PR was re-captured to produce them. The composer, chips and failure rows are
the shipped components with fixture data, which is the surface design review judges
copy and layout from. The set carries all three design rounds: round 1 and
round 2 were judged in round 2's review, and the `r3-` frames with the `cmp-`
pairs are round 3's — the ones that show the SHIPPED text, after the position
suffix became conditional, beside the round-2 frame they are compared against.

### Round 1 (design round 1)

| frame | state |
| --- | --- |
| `before-payload-tail-light.png` / `-dark.png` | base tree: a pasted picture's row named by the base64 tail above the "damaged" sentence |
| `after-one-chip-light.png` | one staged picture, real preview, no refusal |
| `after-three-chips-light.png` / `-dark.png` | three staged pictures, each a real preview |
| `after-corrupt-refused-light.png` | a genuinely corrupt image: neutral name, format sentence, no payload |
| `after-three-one-refused-light.png` | a single refusal row; the frame shows no staged count, so it does NOT demonstrate a two-image state — see `r2-refuse-2of2-light.png` and `r3-refuse-three-*` for counted rows |

### Round 2 (design round 2, after the position-copy change)

| frame | state |
| --- | --- |
| `r2-chip-one-light.png` | chip-only pre-send state: the composer reads "Not sent yet" and no `Pasted image` failure row is present. This frame does NOT show the position copy; the round-3 frames below do |
| `r2-payload-tail-light.png` | the base tree's payload tail, re-staged as the control for the pair above |
| `r2-refuse-1of1-light.png` / `-dark.png` | one staged, one refused, with the **round-2** text `Pasted image · Image 1 of 1` — the suffix was still unconditional at this head, so this is the "before" for the fix, not the fixed state |
| `r2-refuse-2of2-light.png` | two staged, the second refused: `Pasted image · Image 2 of 2` |
| `r2-refuse-2of3-light.png` / `-dark.png` | three staged, the middle one refused: `Pasted image · Image 2 of 3` |
| `r2-staged-three-broken-second-light.png` | three staged pictures, one tile not rendering, before any send |
| `r2-refuse-damaged-light.png` / `-dark.png` | the "couldn't be read, it may be damaged" sentence — the arm a payload that declares base64 and will not decode reaches |
| `r2-refuse-narrow800-light.png` / `-dark.png` | the same refusal at an 800 px window: the position label wraps, accepted as the window floor (D2's other half), not fixed |
| `r2-truncated-no-refusal-light.png` | a truncated-but-decodable PNG stages with NO refusal — the pin for R2-3/D4: damaged-but-decodable bytes pass through `bound-image.ts` (pre-existing), so no frame claims that arm is caught |

### Round 3 (design round 3 — the shipped text)

These four show what the current head renders, which is why they, and not the
`r2-` rows above, are the evidence for the single-image and three-image copy.

| frame | state |
| --- | --- |
| `r3-refuse-single-light.png` / `-dark.png` | ONE staged image refused: `Pasted image` + the format sentence, **no position suffix** — the shipped single-image row, and the pair to `r2-refuse-1of1-*` |
| `r3-refuse-three-light.png` / `-dark.png` | three staged, the second refused: `Pasted image · Image 2 of 3` + the sentence — the shipped numbered row, and the pair to `r2-refuse-2of3-*` |
| `cmp-single-light.png` | round-2 frame above round-3 frame, cropped to the composer band: the suffix removal as one image |
| `cmp-three-light.png` | the same before/after crop for the three-image numbered row |

**App-real, separately:** QA's built-app pass mounted the **chat composer** and
pasted into it for real (the same `MessageInput` paste handler the bridge mounts).
The Team Bridge page itself mounts but is **auth-gated in an isolated profile**, so
no built-app frame of the bridge page exists. These frames are the harness, and this
README says so rather than implying otherwise.

## What these runs do NOT prove — read this before quoting them

- **No rendered frame, and no macOS pasteboard read.** The Team Bridge route lands
  in the app's own error boundary on this host before its first request, and the
  chat pane mounts no composer against a stub hub, so there was no composer to
  paste into. These runs drive the shipped modules with esbuild bundling (the
  sibling suites' recipe) against a stub that speaks the desktop media relay over
  real HTTP. The rendered row and the OS-flavour choice are QA's to verify on a
  tree where the page mounts.
- **The 1024px bound does not run here.** This process has no canvas, so
  `boundImageForWire` is the documented pass-through; the sha256 above is the
  source's, which is what proves the payload was carried whole. Bounding is
  exercised in Chromium.
- **The hub is a stub**: it records what it was handed and answers a staged
  descriptor. The composer paste handler, the store, `uploadStagedImages`,
  `prepareImageForUpload` and the transport shape are the shipped code.
