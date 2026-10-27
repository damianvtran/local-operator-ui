# PR #1446 design review round 2: frames

Head `4ef30f0909` (scope `1decc306a1..4ef30f0909`). This is a static Storybook built from only
`team-bridge-invitations.stories.tsx` plus the review scratch stories in `harness/`, using a scoped `-c` config copy in an
in-repo worktree with the shared `node_modules` and the V8 heap capped at 1 GB. It was served on 127.0.0.1 and captured
with the harness browser tool (one tab, extension host), 1440 px wide @2x. Themes: `localOperatorDark` and
`localOperatorLight`.

The extension host (0.1.20) has no geometry reads, so the numbers come from review-only scripts. These were injected
into the built `iframe.html` only and are archived in `harness/`. Each is URL-gated: `&probe=1` dumps rects and colours,
`&mo=1` is a MutationObserver commit recorder, and `&w=<px>` pins the story width to an app content width.

- 01–08: changed view states. These are the consent copy (D1), Several against Outcomes (D2), Accepting and Declining
  (D4), Declined and AnsweredElsewhere (D7, R6), and read-only (D6).
- 10–15: the real `TeamBridgePage` container behind round 1's desktop stub. They show idle, accept pending, a retryable
  refusal (`agent_not_permitted`), then pending and a final refusal (`invalid_transition`, `rule=not_invited`). The frames
  +9 s and +6 s after each refusal are byte-identical (md5) to 12 and 15, so the settle re-read moved nothing. They are
  omitted.
- 20–21: N1. A pointer rests on a rail row while the invite appears: the entry is held absent. After a pointer
  boundary crossing out of the rail, it is applied.
- 22: D3, the badge column, light theme.
- 30–31: D2 at a 732 px content width, which is a 1280 px window minus the 260 px app sidebar and the 288 px rail.
