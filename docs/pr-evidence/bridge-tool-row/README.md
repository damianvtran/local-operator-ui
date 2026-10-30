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
