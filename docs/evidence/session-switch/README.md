# Switching conversations: which click owns the view

Two reports about the same gesture. The first was about duration — "the switches
feel a bit slow" — and is what the seven states under this directory photograph.
The second, which this change is about, is about WHICH conversation wins when a
user crosses several in a row:

> "if you're clicking across multiple conversations, if you click one and then
> click another and the first loads, it switches you to that one even if the
> second loads first, so you need to probably make sure that clicking one
> conversation cancels loading for others which might help in situations where
> users might be clicking across multiple conversations"

## The frames here are unchanged by this change, and were not re-taken

They photograph the switch's own panel states (before, hydrating, settled,
mark, refusal, slow, error), and this change moves no pixel: the defect and its
fix are both in the URL write, and the address bar is not a rendered surface —
no component's markup, props, classes or copy moved. The one visible behaviour
change is which conversation you end up on, and that is what the arms below
assert; a re-shot frame would be byte-identical apart from lossy-WebP noise.
They are also not re-shootable on this machine under the policy five of the
manifest's supplementary sets record: the rig drives a scripted browser engine.

## The rule this directory's evidence now rests on

Every entrance to a switch — the sidebar row, the command palette, the `/chat`
slash rebind — writes its URL WITH the commit, in the same task, through
`src/renderer/src/features/chat/open-conversation.ts`. Writing it one guard read
later (what all three used to do) left this window's own address bar naming the
conversation the user had just LEFT for a whole round trip, and `ChatPage`'s
route-to-store effect — which reconciles the store TO the route for a deep link,
Back or a legacy agent link — read that stale value as an instruction, re-opened
the left conversation as a switch newer than the user's click, and won. The
call-site log in `--race-palette`'s output shows exactly that: the re-opening
`openSession` arrives from a `commitHookEffectListMount` frame in `chat-page`,
not from the click.

## The arms, and what each one is worth

Driver: `scripts/session-switch-latency.mjs` (the page it drives is
`scripts/session-switch.tsx`, which mounts the SHIPPED `ChatPage` behind the
scripted owner in `scripts/session-switch-bridge.ts`).

- `--race` / `--race-write` — two clicks, A and then B, with per-session hop
  latencies (`--race-get-a/b`, and the same for history and stream). `--race-write`
  dispatches the second click AT the first one's URL write. The settled view is
  asserted at three surfaces: the store for the committed conversation, the URL
  for the route, the DOM for whose transcript rows were painted.
- `--race-palette` — the same race with the palette on the near side, the far
  side and both, because a palette pick is not a row and no row-clicking arm
  reaches that path.
- `--race-fuzz` — fourteen click sequences (reversed pairs, re-clicks, three
  clicks, gaps 0-900 ms, palette and row entrances mixed) asserting the one
  property true of all of them: the LAST choice owns the settled view.

Sequence: `scripts/session-switch.test.mjs` pins the store's ordering and the
one-place rule structurally.

## Reachability: what is measured, and what the operator's report establishes

The arms force the window to **zero slack**: the second click is dispatched in
the same tick as the first one's URL write, which is earlier than any human can
click. They therefore establish the DEFECT and the fix, not that a person
reaches the window at their own cadence — and nothing here should be read as
"proven reachable at normal cadence".

What establishes that a human reaches it is the operator's own report, from real
use on this machine: clicking across several conversations and landing on the
earlier one. This machine runs ~26 concurrent agent sessions at load average
200-300, and the window stays open for exactly as long as the renderer has not
yet painted the previous switch's route — the measured cost of that load. The
zero-slack arm is a superset of it: any cadence whose click interval is shorter
than the render lag lands inside the same window.
