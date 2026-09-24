# The press that lands while a send is still out

One arm of `../owner-refusal-send/harness/capture.mjs`, added by this change
(UX round 3, U6). The owner is **alive and slow**: it holds the first `POST
.../messages` for 21 s, so the app's send is genuinely in flight while the user
types their next line and presses Send. The rig is the same set's - the app's own
`desktopProxyPlugin`, the shipped `desktop-transport`, the shipped composer, a
private headless Chrome - and everything is reaped on exit.

```
OWNER_REFUSAL_OWNER_PORT=8891 node docs/evidence/owner-refusal-send/harness/capture.mjs <out-dir> --only=press-during-flight
```

## What the frames are

| frame | state |
|---|---|
| `press-during-flight-composed.webp` | the first message typed, before the press |
| `press-during-flight-after-press-in-flight.webp` | **the press, answered**: the user's own next line still in the box, the flight's echo in the transcript above it, and one muted sentence over the composer - "Your last message is still sending." |
| `press-during-flight-after-flight-settled.webp` | the flight's own deadline spent: this app's sentence over the returned message, with `Retry` and `Clear` |

## The readings, which are the claim that can fail

| reading | value |
|---|---|
| the Send control at press time | `disabled: false` - the press is delivered, not refused by the browser |
| the notice region, read from the DOM | `"Your last message is still sending."` |
| the box after the press | the user's line, unchanged |
| the notice's controls | none (`controlLabels: []`) - nothing failed, so there is nothing to press |
| request ids at the owner after the press | one - the press admitted nothing, and the app's own ladder repeats carry the same id |

Before this change the same press reached an enabled control and produced no line
anywhere: `capture.mjs`'s own assertion for that arm reads the alert region's
prose, and on the previous head it was empty while the box kept the user's text.
