# What the composer says when the flight ends

Three arms of `../owner-refusal-send/harness/capture.mjs`, added by this change
(review round 4's M2 = QA's Q4-1 = the designer's D11 = UX's U16, and M1 for the
third). The owner holds each request INSIDE the app's own 20 s budget, which is the
one thing the committed 21 s arm can never do - that arm always ends in the app's
deadline, so it can only ever see a FAILURE settle.

```
OWNER_REFUSAL_OWNER_PORT=8911 OWNER_REFUSAL_APP_PORT=5311 \
  node docs/evidence/owner-refusal-send/harness/capture.mjs <out-dir> --only=<arm>
```

| arm | what it proves | reading |
| --- | --- | --- |
| `press-during-flight-settles` | a press answered inside a flight that SUCCEEDS leaves nothing behind: the line is gone once the message is in the transcript | `settled: {userRows: 1, box: "", alert: ""}` |
| `press-twice-no-stall` | the follow-up is its OWN row, not the glued row UX measured | `after next send: {userRows: 2, rows: [the first message…, "and here is my own next line…"]}` |
| `budget-409` | one failure renders ONE sentence, and the same one after a remount - the arm M1 was filed on | `alert: "this message's text alone fills 1.1 MB…"`, `controls: ["Clear"]`, identical after the reload |

`budget-409` is the daemon's own codeless 409 (the sender-side budget ladder). Before
this change the pane classified it a second time from the PRE-SEND row, so the screen
said "Couldn't confirm your message was sent. Sending it again is safe." with a Retry
while the row it was standing in for said not-sent with Clear only - one failure, two
renderings, and only the screen wrong. The two frames here are the same failure before
and after a remount, which is the pair that made the difference visible.
