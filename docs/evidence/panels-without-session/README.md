# `panels-without-session` — the four gestures, in the shipped app

What a story fixture cannot prove: that the shipped app answers these four
gestures at all. Four frames, one per gesture, captured from the **built** app in
the documented `headless` mode against an isolated backend — the same scene list
run against both trees, before and after, so each frame here has a partner under
`../panels-without-session-baseline/`.

## The rig

```sh
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 pnpm build     # in each tree
node scripts/panels-without-session-evidence.mjs \
  --out <dir> --label <before|after> [--scene <name>|all]
```

`--label` names the tree and the rig never branches on it: the same scene body
runs against both trees, so a difference in the frames is a difference in the
app. Each run writes `run-<label>.json` beside its frames, carrying the rig's own
`sha256` (the same bytes ran on both trees), the route, the panel region, the
refusal flag and the browser-view suppression each gesture produced — the reads
that make the frames checkable rather than merely viewable.

Isolation: throwaway `HOME`, config dir, `--user-data-dir`, backend and debug
port; an allowlisted environment; `VITE_DISABLE_BACKEND_MANAGER=true` so the app
cannot spawn a backend of its own; and the backend on **8080** because the
renderer's CSP names only 1111 and 8080 (anywhere else the fetch is refused by
policy with no request sent). The window is never shown
(`LOCAL_OPERATOR_UI_WINDOW_MODE=headless`). Other Local Operator sessions run on
this host; nothing here reads or writes their config.

## What the four pairs show

| Gesture | Before (`origin/main`) | After |
| --- | --- | --- |
| `/analytics` typed on a pane with no conversation | the dispatcher's refusal in the transcript, no panel (`refusal: true`) | the Analytics panel, machine-wide (`regions: ["Analytics region"]`) |
| `/info` typed on the same pane | the same refusal | the Info panel (`regions: ["Host info region"]`) |
| Cmd+K → Info from `/settings` | the panel opens on **`/chat`** — the user is thrown out of Settings | the panel opens over `/settings`, route unchanged |
| Cmd+K → Info from `/browser` | the panel opens on **`/chat`** — the browser route is gone | the panel draws over `/browser` with `data-suppressed-by="panel-picker:<id>"` |

Two details of the frames are load-bearing rather than incidental:

- **The description tells you which half you are looking at.** The before frames
  read "…and the conversation in front of you." and the after frames read "…and
  the sessions running on it." — the conditioned copy, in pixels. (Round 1's
  remediation changed that clause to "…and the sessions on this machine." and
  could not re-take these frames: see "Three frames carry the pre-remediation
  copy" below.)
- **The browser frame's suppression is readable, not inferred.** A CDP
  screenshot cannot capture a native `WebContentsView`, so the frame cannot show
  the view going away; what it shows is the panel drawn over the browser route
  and the surface's own `data-suppressed-by` attribute naming `panel-picker` —
  the observable `PickerHost`'s `useSuppressBrowserView` registration produces.

## Not in this set

**The two live-conversation scenes of the design (§ 11.5, § 11.6) are absent**,
and that is a gap rather than a decision: both need a conversation whose first
turn was actually sent, and this rig could not land one against the scratch
backend it starts — the composer accepted the message and the pane stayed on
`/chat` with its draft through the 90 s wait, with and without the model chosen
from the pane's own chip first. What they would show (the "This conversation"
section and the "This session only" scope intact on a live conversation) is what
`../panels-info/populated` and `../panels-analytics/populated` are, and the live
flow belongs to the QA pass.

**The palette rows are picked with a pointer.** `Input.dispatchKeyEvent`'s Enter
triplet drives the composer and is inert on the palette's search input — measured
here: the palette stayed open with its row painted and "Open ↵" on it through
every variant of the event. The gesture photographed is therefore a real CDP
mouse press and release on the row the query painted first, not a synthesised
`element.click()`.

## Three frames carry the pre-remediation copy, on the record

`draft-info`, `palette-settings` and `palette-browser` each present the same
`/info` panel the Storybook set does, and none of them was re-taken after round
1's design fix that changed the panel's third description clause from "…and the
sessions running on it." to "…and the sessions on this machine."
(`../panels-info/session-free`).

The reason is the ADDRESS, and it is the rig's own constraint rather than an
oversight: the renderer inlines the backend URL at build time and
`src/renderer/index.html`'s CSP names only `1111` and `8080`, so a run cannot
move — and for the whole remediation window both of those were held by OTHER
sessions' processes (8080 by an agent's `local_test_doubles.py`, 1111 by a
packaged `local-operator serve`). The port check added to the rig in the same
remediation is what refused the run rather than quietly photographing someone
else's daemon, which is why this is written down instead of being invisible.

So, precisely: **the three frames are current in every respect except that one
clause, which they spell the old way.** The new copy is shown at twelve themes,
in the same component, by `../panels-info/session-free` — re-captured by that
remediation, and the section whose promise the clause makes. The re-take is owed
to the next window in which 8080 is free.

## Rig revision, and why two hashes appear

The frames in this set were produced by `scripts/panels-without-session-evidence.mjs`
at revision `78b708c3…`, which is the hash `run-after.json` records. The committed
file is that same revision **reformatted by biome** (`pnpm lint:scripts` requires
it); the differences are an import-list reorder and two wrapped call sites, and
nothing else:

```
$ git show <this commit>^:scripts/panels-without-session-evidence.mjs > /tmp/as-run.mjs
$ diff -w /tmp/as-run.mjs scripts/panels-without-session-evidence.mjs
42d41   < readdirSync,
43a43   > readdirSync,
627,630c627   < await clickFirstRow(  (wrapped over four lines)
              > await clickFirstRow(debugPort, '#command-palette-results [role="option"]');
641,644c638   < the same call, wrapped
              > the same call, on one line
```

So the pair is comparable in the way that matters — **both halves ran the same
bytes** (`78b708c3…` on the before tree and on the after tree) — and the hash in
each run record is the hash of what ran, not of what is committed. Stated here
rather than silently corrected in the JSON, because a record quietly rewritten to
match the tree is worth less than a record that says which revision it is.
