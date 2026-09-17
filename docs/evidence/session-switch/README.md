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

**No arm is evidence by being green.** Some of these discriminate and the rest are
regression guards, and which is which is measured rather than asserted: every arm was
run on a tree with the deferral put back (`navigate` returned to the read's answer,
the only change), and the runs are recorded below with the configuration each used.
Two of them are RELIABLE discriminators (`--race-write` and the write-gated fuzz
failures, each reproducing on every run); one can fail on an unfixed shape without
always doing so (`--race-palette`), and is labelled that way rather than promoted.

- `--race` — two clicks, A and then B, `--race-gap` ms apart, with per-session hop
  latencies (`--race-get-a/b`, and the same for history and stream). **A regression
  guard**: it PASSES on the tree with the deferral put back, at both latency pairs
  tried, because a deadline can only race the renderer's frame.
- `--race-write` — the same two clicks with the second dispatched AT the first
  one's URL write. **A reliable discriminator**: on the deferred tree at
  `--race-get-a=0 --race-get-b=900` it is 4 FAIL of 6 claims (the settled view is
  the FIRST click's conversation) and 6 PASS on this one, and it failed the same way
  on every run it was tried. Its discriminating configuration puts the SLOW hop on
  the second click: the late write belongs to the click the user made first.
- `--race-palette` — the same write-gated race with the palette on the near side,
  the far side and both, and it drives the PALETTE COMPONENT: the harness mounts the
  real `CommandPalette` and the pick is a click on the palette's own `role="option"`
  row, so `command-palette.tsx`'s handler runs (the call-site log in its output shows
  `… <- at openConversation <- (command-palette.tsx…)`). An earlier version called
  the rule directly and reported the palette as covered; on a tree where the palette
  still deferred, that version was 3/3 PASS, which is what a claim like that needs to
  be checked against. **Its discrimination is INTERMITTENT, and is not the proof**:
  independent QA measured 3 failures in 10 runs on unfixed shapes (1 in 6 on the
  rule-deferral tree, 2 in 4 on the branch-point tree) and none on this head, and the
  author's own single run at the default latencies caught one case. It is reported
  here as a run that CAN fail on an unfixed shape, not as a reliable discriminator;
  the reliable ones are `--race-write` and the write-gated fuzz failures below, both
  of which reproduced on every run they were tried.
- `--race-stage-draft` — the New-chat gesture (`stageDraft` + `/chat`, as `app.tsx`
  performs it) staged inside a switch's guard read, by row and by palette.
  **Discriminating against the refusal**, which is the defect it is for: 2/2 FAIL on
  a tree whose refusal repair is unbounded (`path=/chat/<A>` and the draft gone —
  the reviewer's M1), 2/2 PASS here. It does NOT indict the deferral on its own, and
  is not claimed to: a deferred write plus a bounded refusal is a correct tree.
- `--race-fuzz` — twenty click sequences: reversed pairs, re-clicks, three clicks,
  gaps 0-900 ms, palette and row entrances mixed, and seven of them WRITE-GATED
  (each click after the first dispatched at the previous one's URL write). The
  driver prints each trial's gate, and the distinction is measured: on the deferred
  tree all **thirteen deadline-gated sequences PASS** in both configurations (a
  regression guard, not proof), and 18/20 settle correctly — every failure
  write-gated, two in each configuration, the same two on both runs of each:
  `A -> B` and `A -> B -> A (palette,row,row)` at
  `--race-get-a=0 --race-get-b=900`; `B -> B -> A` and the same three-click
  palette chain at the defaults (600/40). Each latency pair discriminates a
  different sequence, which is why both are recorded rather than one being called
  "the" configuration — and these two, not `--race-palette`, are what the README
  leans on.

Sequence: `scripts/session-switch.test.mjs` pins the store's ordering and the URL
rule structurally — including an enumeration of every `/chat/<id>` write in the
renderer with the reason it is not a switch's URL, so a new entrance cannot appear
unnamed (the previous version listed three entrance files and the reviewer proved
both a differently-written deferral in a listed file and a fourth entrance in an
unlisted one passed it).

## Reachability: what is measured, and what the operator's report establishes

The write-gated arms dispatch the second click in the same microtask drain as the
first one's URL write — earlier than any human can click, and tighter than the
window the defect actually needs (the write→route-effect interval, which lasts as
long as the renderer has not painted). They therefore establish the DEFECT and the
fix; they do **not** establish that a person reaches the window at their own
cadence, and nothing here should be read as "proven reachable at normal cadence".
Nor do the deadline-gated sequences stand in for it: they are the ones that pass on
the deferred tree.

What establishes that a human reaches it is the operator's own report, from real
use on this machine: clicking across several conversations and landing on the
earlier one. This machine runs ~26 concurrent agent sessions at load average
200-300, and the window stays open for exactly as long as the renderer has not
yet painted the previous switch's route — the measured cost of that load. The
zero-slack arm is a superset of it: any cadence whose click interval is shorter
than the render lag lands inside the same window.
