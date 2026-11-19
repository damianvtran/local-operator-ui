# Team Bridge tool row — frames

Taken 2026-10-30 from Storybook (`node scripts/with-storybook.mjs`), one instance on
this branch and one on `origin/main` with this branch's `tool-row.stories.tsx`
copied in, through the harness browser at a 1280×720 viewport (2× device pixels),
`?args=theme:localOperatorDark|localOperatorLight`. Each frame was read back after
capture.

| file | what it shows |
| --- | --- |
| `before-bridge-rows-{dark,light}.png` | `origin/main`: every bridge state is a wrench, `Called bridge …`, and raw args (`channel_history bcv_b0044d5e`); the refusal reads only `failed`. |
| `before-bridge-rows-post-open-dark/light.png` | `origin/main` expansion: the argument dump and the one-line machine receipt. |
| `before-bridge-rows-condensed-open-{dark,light}.png` | `origin/main` condensed run: the bridge calls count under the display name `bridge`. |
| `after-bridge-rows-{dark,light}.png` | Every state collapsed: `Posted in #release · …`, `Messaged Ada Lovelace · …` + amber `awaiting acceptance`, pair-lane `Sent to a teammate` + amber `not posted to a conversation`, `Read a conversation (7 messages)`, `Reacted in … · 👍`, `Couldn't post in … refused · not_member`, `Posted in #ops … delivery unconfirmed`. |
| `after-bridge-rows-post-open-{dark,light}.png` | Expanded post: `#release` headline, the body as markdown (bold rendered), `Posted at seq 42`, closed `Details`. |
| `after-bridge-rows-post-details-open-{dark,light}.png` | The same with `Details` clicked open: ids, seq, destination type, receipt stage, raw content. |
| `after-bridge-rows-inbox-only-open-{dark,light}.png` | Pair-lane send expanded: the "Accepted into their inbox — … Use a DM to be seen." sentence. |
| `after-bridge-rows-refused-open-{dark,light}.png` | Refusal expanded: `Refused (not_member): …` in danger ink. |
| `after-bridge-rows-condensed-{dark,light}.png` | A consecutive bridge + send run, folded: `10 team actions · 5 team messages · 1 message`. |
| `after-bridge-rows-condensed-open-{dark,light}.png` | The same fold open: one row per op, including `Used Team Bridge teleport` for an unknown op. |

What these frames do not cover: the Team Bridge cache resolver (no conversation
list is seeded in these stories, so un-named channels show `a conversation`); it is
covered by `scripts/tool-row.test.mjs` with a real `QueryClient`. No live-app frame
was taken.

## Round 2 — `r2/` (remediation of review/design/QA round 1)

Taken 2026-10-30 from this branch's Storybook (`node scripts/with-storybook.mjs`, one
instance, torn down: "pid gone, port 6131 closed"), harness browser at 1280×720
(2× device pixels), `?args=theme:localOperatorDark|localOperatorLight`. Every frame
was read back after capture. `{t}` is `dark` and `light`.

| file | what it shows |
| --- | --- |
| `r2/bridge-rows-{t}.png` | Every state collapsed. The preview drops inline markdown: `Posted in #release · Tagged v0.46.7 — …` (D2). `delivery unconfirmed` is amber, not danger. |
| `r2/bridge-rows-post-open-{t}.png` | The expansion's first line is labelled: `Posted in #release` (D4). The body still renders as markdown (bold). |
| `r2/bridge-rows-post-details-open-{t}.png` | `Details` open. Its chevron is now `ink-dim`, measured 5.02:1 light / 6.59:1 dark against `sunken` (was 2.43 / 2.49; D3). |
| `r2/bridge-rows-inbox-only-open-{t}.png` | `Sent to a teammate` headline, with the inbox-only sentence. |
| `r2/bridge-rows-refused-open-{t}.png` | `Refused (not_member): this agent is not a member of a conversation`. No `bcv_` id in the sentence (D5). |
| `r2/bridge-rows-refused-details-open-{t}.png` | The raw error, with the id, under `Details` (D5). |
| `r2/bridge-rows-condensed-{t}.png`, `r2/bridge-rows-condensed-open-{t}.png` | The fold is unchanged: `10 team actions · 5 team messages · 1 message`. `Read thread in #release (3 messages)` has no `thread` suffix. |
| `r2/bridge-rows-narrow-414-{t}.png` | A 414px pane (334px row, measured). The SHORT words are `not posted` / `awaiting` / `unconfirmed` (48–62px, measured), and the summary keeps its room (D1). |
| `r2/bridge-rows-narrow-320-{t}.png` | A 320px pane (240px row). The mark plus the sr-only label carry the state, and the summary is untouched (D1). |
