# Starting a new chat from the sidebar

Two reported defects, both about the same thing: the sidebar's primary action
was unlabelled, and its only named entry point was a 16px icon.

1. Clicking an agent or team name has always staged a draft, but nothing on the
   row said so, so the affordance was invisible and went unused.
2. There was no New chat control in the All chats region at all — only the
   header's small `Plus`.

## What produced these frames

**The live renderer, driven over raw CDP — not Storybook.** The claims under
test are a real pointer hover and a click that changes store state, and neither
survives a fixture: Storybook can force the revealed class but cannot produce
the `:hover` that reveals it, and a staged draft is state a fixture would have
to fake rather than demonstrate.

The surface is the app's own `src/renderer/index.html` served by Vite with the
app's aliases, Tailwind pipeline and the repo's `desktopProxyPlugin`, talking to
an **isolated Local Operator backend on its own port** seeded with 6 agents, 2
teams and 7 sessions (2 carrying an unseen completion, which is what fills
Active chats and leaves 5 under Previous). Transport, catalogue, session rows,
the Active/Previous split and the draft store are all real.

The CDP layer mirrors `scripts/capture-evidence.mjs`: a private headless Chrome
on a fresh user-data-dir, killed on exit, Node's built-in WebSocket speaking
DevTools directly, focus emulation on so `:focus-visible` paints.

### What these frames therefore do not prove

- **Not the packaged Electron app.** The renderer runs in Chrome, so the preload
  bridge is stubbed to a no-op and `window.api.desktop` is deliberately left
  undefined, which routes the desktop transport down its real `/__desktop` HTTP
  path. Electron IPC, native dialogs and the packaged build are not exercised.
- **No model inference.** No session is ever admitted; the backend has a
  placeholder provider key and nothing is sent to it. What is proven is that a
  draft is staged and the chat pane opens on it, not what an agent then replies.
- **Two themes, not twelve.** `localOperatorDark` and `localOperatorLight` — the
  two brand palettes, light included because that is where contrast defects
  hide. The twelve-theme sweep belongs to the Storybook pipeline and is not
  regenerated here.

## Before / after

Each state is captured on both trees at the same viewport, through the same
script, so the pair is comparable. Every frame is the sidebar column plus the
ground either side of it; the chat pane is cropped out because its suggestion
chips vary with model configuration and would churn a frame for reasons
unrelated to its subject.

| State | Before | After |
| --- | --- | --- |
| Panel at rest | [`before-sidebar-rest`](before-sidebar-rest/localOperatorDark.webp) — 16px `Plus` in the header; nothing named in the All chats region | [`after-sidebar-rest`](after-sidebar-rest/localOperatorDark.webp) — header carries only the title; a full-width **New chat** row sits below All chats, above Active chats |
| Entity row hovered | [`before-entity-row-hover`](before-entity-row-hover/localOperatorDark.webp) — hover is a bare colour step; nothing says the row starts a chat | [`after-entity-row-hover`](after-entity-row-hover/localOperatorDark.webp) — the chat glyph appears in its reserved slot |
| Entity row focused | [`before-entity-row-focus`](before-entity-row-focus/localOperatorDark.webp) | [`after-entity-row-focus`](after-entity-row-focus/localOperatorDark.webp) — `group-focus-within` reveals the same glyph, accent outline ring intact |
| All chats, flat list | [`before-all-chats-flat`](before-all-chats-flat/localOperatorDark.webp) | [`after-all-chats-flat`](after-all-chats-flat/localOperatorDark.webp) — the New chat row holds the same place when the split is replaced by the flat list |
| After staging a new chat | [`before-new-chat-staged`](before-new-chat-staged/localOperatorDark.webp) — via the header `Plus`, the only control that existed | [`after-new-chat-staged`](after-new-chat-staged/localOperatorDark.webp) — via the New chat row, which then marks itself current |

The staged frames are taken **after** a real click, not before one: a screenshot
of a button is not evidence that pressing it works.

## The row does not move — measured, not eyeballed

The constraint is that the affordance must not reflow the row, and pixels alone
cannot settle that. Geometry was read from the live document at rest, 40ms into
the transition, and settled, with the pointer moved by real
`Input.dispatchMouseEvent`:

```
REST   row {x:260,y:152,w:200,h:32}  glyph {x:428.44,y:160,w:16,h:16} opacity 0
MID    row {x:260,y:152,w:200,h:32}  glyph {x:428.44,y:160,w:16,h:16} opacity 0.883184
HOVER  row {x:260,y:152,w:200,h:32}  glyph {x:428.44,y:160,w:16,h:16} opacity 1

LAYOUT SHIFT: none (row, label, count, glyph position and the next row are byte-identical)
TRANSFORM hover=none (none means nothing translated or scaled)
FOCUS RING outline=2px solid
```

The label box (`x:284 w:140.44`), the count (`x:448.44`) and the following row's
`y` (`184`) are identical in all three samples. The mid-transition sample is the
point of the exercise: the glyph is fading, and nothing around it has moved.
`transition: opacity 0.12s` is the only transition on the element, which is what
keeps it inside § Motion's rule that hover is a colour step.

Reduced motion was checked in the same live app with the media feature actually
emulated, not assumed from reading the stylesheet:

```
media reduce:  true
rest:          opacity 0, transitionDuration 1e-05s   (capped by styles/index.css)
hover +30ms:   opacity 1
hover settled: opacity 1
```

The cap is a cap, not a disable, so the glyph reaches its revealed state
immediately rather than being stranded on its `from` value — the failure mode
§ Motion calls out by name.

## Each control actually works

Real CDP clicks at each control's own coordinates, reading the chat pane's title
and the sidebar's `aria-current` afterwards:

```
BEFORE                    {"route":"#/chat","paneTitle":"Start a chat","composer":false,"current":["Chat"]}
AFTER new-chat row click  {"route":"#/chat","paneTitle":"New chat","composer":true,"current":["Chat","New chat"]}
AFTER entity row click    {"route":"#/chat","paneTitle":"New chat with coder","composer":true,"current":["Chat"]}
AFTER team row click      {"route":"#/chat","paneTitle":"New chat with release-pod","composer":true,"current":["Chat"]}
AFTER Enter on New chat   {"route":"#/chat","paneTitle":"New chat","composer":true,"current":["Chat","New chat"]}
```

The pane title is read from outside the sidebar nav, so the sidebar's own
"Chats" heading cannot be mistaken for it. `New chat with coder` and
`New chat with release-pod` are `chat-page`'s own rendering of the draft's
target, which is what makes them proof the right draft was staged rather than
merely that something happened.

Keyboard traversal still passes through the new row rather than stopping at it:

```
TRAVERSAL {"total":16,"newChatIndex":11,"before":"All chats7","after":"Active chats2"}
```
