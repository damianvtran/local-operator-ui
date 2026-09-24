# The pane's keystroke path, against a real shell

The UX round's blocker (`U1`) was that no keystroke from the pane ever reached the
shell. This is the round-trip half of the proof: everything downstream of the
mirror's one `onData` line — preload, the IPC handler that names the actor, main,
the pty, and `zsh` — driven from the app's own renderer.

The mirror's own half (a keystroke in the mounted component becomes that call,
with xterm's own bytes) is `scripts/console-mirror.test.mjs`, which runs in
`pnpm test:desktop`. Neither half alone is the claim; together they are, except
for a human's finger on the pane's terminal inside the built app, which needs a
backend session to reach the chat route and is therefore left for QA.

```
host ready on 127.0.0.1:55118 (proto 1) — console on
surface con:1:6Pip8Ru0tMNRv6JsGG2D_g at 100x30
--- what the surface printed before any typing ---
"\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n"
--- status ---
{"running":true,"exit_code":null,"exit_epoch":0,"cols":100,"rows":30,"live":true,"truncated":false,"modes":{"bracketedPaste":false,"applicationCursorKeys":false,"mouseTracking":"none"},"cursor":{"x":0,"y":0},"last_activity":1789947593.983,"retain":false,"secure":false,"env_marker":{"name":"LOCAL_OPERATOR_CONSOLE_SURFACE","value":"con:1:6Pip8Ru0tMNRv6JsGG2D_g"}}
the app renderer has the console bridge: true
typed 25 characters one at a time; every call resolved: yes
--- the record's viewport, after typing ---
damian@damians-MacBook-Pro ~ % echo CONSOLE-TYPED-PROOF
CONSOLE-TYPED-PROOF
damian@damians-MacBook-Pro ~ % 

the shell echoed the typed command back: PASS
the shell's own second line (proof it RAN, not just echoed): 2 occurrence(s)
RESULT: PASS
```
