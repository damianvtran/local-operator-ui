# Run panel — the pane, its roster, its child reader, its plan and its MCP servers

`docs/run-sidebar.md` replaces the header popover with a persistent pane in the
right slot the canvas uses. These frames are that pane, re-taken on the branch it
was built on.

The frames render the **real surfaces** — the production `ChatHeader` with its own
action cluster and its own data gate, the production `RunPanel` with its chrome
bar, its roster, its plan, its MCP section and its reader, and the production
`ResizableDivider` — inside a chat column, so a frame is a picture of the
product's surface rather than a reproduction of it.

## The capture

```
# Storybook walks forward when a port is taken, so read the port off the banner
# rather than assuming it. 6017, 6031, 6041 and 6046 were held by other
# worktrees' Storybooks and app runs while this set was being taken, and 6041 is
# what this set actually bound — confirmed on the banner, not assumed.
pnpm storybook --port 6041 --no-open

node scripts/capture-evidence.mjs http://localhost:6041 \
  --only=run-panel \
  --themes=localOperatorDark,localOperatorLight \
  --allow-backend

pnpm check-evidence
```

Twenty-seven stories over the two brand themes is fifty-four frames. One story
(`reduced-motion`) carries the rig's fourth tuple field, `{ reducedMotion: true }`,
which sets the CDP `prefers-reduced-motion` feature for that frame only and resets
it for the next one — the app's cap is a `@media` block in `styles/index.css`, so
a frame that faked the reduced style would be evidence about the fake.

**This set has no live-app counterpart yet, and says so plainly.** The one frame
that must come from the real app against a real running child (`reader-live`
paired to `~/local-operator-worktrees/desktop-subagent-transcript`'s
`subagents.transcript` route) is not in it: the backend worktree's route exists
(`local_operator/server/routes/desktop_sessions.py:349`). The pairing, a real turn
with a live child and the CDP drive of the running app were completed in the
review round: `../chat-run-panel-live/` is that pair, with the pairing, the ids
and the backend's own read counts recorded in its README. The `reader-live` below
is the FIXTURE-backed rendering of the same state — it proves the row pipeline,
and the live pair is what proves the wire. The two are kept apart deliberately and
named as such everywhere they are cited.

## The frames

| Frame | What it shows |
| --- | --- |
| [`trigger-idle`](trigger-idle/) | The icon on screen with nothing in flight and nothing open — the state the retired trigger did not exist in at all, because it was gated on `hasRunDetails`. Measured: **zero** danger-bound pixels in the header band, so the button is there and the dot is not. |
| [`panel-empty`](panel-empty/) | The same session with the pane open: one quiet line, no skeleton and no placeholder rows. Unreachable through the retired popover, whose trigger did not exist on a session with no work. |
| [`settled-history`](settled-history/) | A finished run: the roster is history, the plan contributes no open work, and the panel's quiet state says so over a roster that is still readable. |
| [`roster-only`](roster-only/) | One section, no empty heading. Three children in priority order with the two-line row: label and activity, then the numbers run (`researcher · 3m34s · 21% · $0.19`) ending 12px inside the pane's right edge. |
| [`todos-only`](todos-only/) | One section: fifteen items over three phases, capped at ten with the five hidden rows disclosed **inside the phase that lost them**, every item state in one plan (pending, done struck, dropped tagged, blocked with its own reason line), and the plan's one tally — `11 of 15 closed · 1 dropped` — with **no per-phase counts**. |
| [`both-in-flight`](both-in-flight/) | Both sections and the hairline between them. |
| [`roster-capped`](roster-capped/) | Nine children at the roster's cap: seven rows and the disclosure, `Show 3 more`. |
| [`roster-capped-expanded`](roster-capped-expanded/) | The same roster **after the disclosure is clicked** — all ten rows, no disclosure. The click is real (`useClickAndWait` drives the button and holds the shutter until it leaves the DOM), which is what makes this the frame that proves every child is reachable rather than one that proves a cap exists. |
| [`todos-phased`](todos-phased/) | The plan with every phase named: three phase headers, each a **name alone** — no per-phase count. Distinct from `todos-only` on disk, not a re-encoding of it: this story's fixture is a named plan (the review round found the two frames byte-identical, which meant one of the two states had no picture at all). |
| [`todos-implicit-phase`](todos-implicit-phase/) | `§ 6.2`'s finding (2): the lazily-created implicit phase beside a named one. The implicit half renders headerless and its items join the list, so the plan is named once. **Read this against `todos-phased`**: that is the control (every phase named), this is the fold. The frame pair cannot show the retired rendering, because the whole-plan fold this one replaces is deleted; what it proves is the state that fold produced. |
| [`swap-canvas-open`](swap-canvas-open/) | The chat column with `isCanvasOpen` set: the run trigger is **present and unpressed**, which is the gate this change removed (`!isCanvasOpen`). The canvas button is deliberately not rendered as "pressed" — the frame is captured in the state where the preference is set and the trigger must still be there, which is the claim; a pressed canvas control is `canvas-workspace`'s frame, not this one. The canvas pane itself is not drawn — `ChatContent`'s canvas branch mounts the real editor against a document set, and a story that leaves it unseeded hangs before it paints; the canvas's own frames are `canvas-workspace`'s set. |
| [`swap-run-open`](swap-run-open/) | The mirror: the trigger pressed and the run pane open in the same slot. One pane in each frame is the claim, and the exclusivity is the store's (`§ 3.2`). |
| [`reader-live`](reader-live/) | A running child's reader, **fixture page** (the LIVE pair is `../chat-run-panel-live/`): chrome bar with the back control and the breadcrumb, the facts row (state, label, elapsed, context, cost, `model_label`), the folded brief, then the child's transcript rendered through the parent's own path — durable rows, a `bash` tool row, the outcome text. |
| [`reader-settled`](reader-settled/) | The same child settled: the elapsed clock has stopped and the outcome block carries the final text. The fixture used to hard-code `result_text: ""`, so the frame the README advertised had no outcome block at all; the fixture now carries a real settled result and the claim is true of the file. |
| [`reader-failed`](reader-failed/) | The verbatim exception in the outcome block, `danger` on the header's state icon only. |
| [`reader-nested`](reader-nested/) | A grandchild: the breadcrumb carries two levels and the chrome bar's back control pops one. A reader replaces the pane's body wholesale, so this frame also shows the roster is not behind it. |
| [`reader-resumed`](reader-resumed/) | A resumed child: the durable `subagent-launch:<job_id>` turn reconciled to its concise authored prompt, with **no role/team/system preamble above it**. `§ 12`'s risk 3 has no other frame. |
| [`reader-brief`](reader-brief/) | The `Delegated with` brief in the ONE state that renders it: a child whose transcript does NOT already carry the instruction, so the block is the only copy. The brief is set in the PROSE role (`§ 4` — it is a paragraph, not machine output, and monospace was the review round's `D1-3`), and `reader-resumed` is its complement: the same block stands down when the transcript already says it. |
| [`reader-pending`](reader-pending/) | `§ 10.1`'s first absence: the child has a directory and no transcript yet. Its own copy, one quiet line, and no retry ladder — the state is not an error. |
| [`reader-gone`](reader-gone/) | `§ 10.1`'s second absence: the directory is not there (swept, or removed by hand). A terminal statement, and the same way out as any other terminal reader state. |
| [`reader-unaddressed`](reader-unaddressed/) | A reader whose row carries no `childSessionId` — the cold-conversation shape (`§ 10.1`, review round 1 R1-6). The roster does not offer such a row as openable; this is what the reader says if it is reached another way (the breadcrumb, the sibling stepper), instead of sitting on `Loading…` forever. |
| [`mcp-dot-ack`](mcp-dot-ack/) | The last step of the same sequence, and the one a single state cannot show: the server healed while the list was on screen (so the ledger PRUNED it, `seen' = seen ∩ problems`), the panel was closed, and the server broke again with the pane shut — **the dot is back**. Without this frame the re-arm rule has no picture. |
| [`mcp-dot-ack-acknowledged`](mcp-dot-ack-acknowledged/) | The ledger's step 2: the list was shown while a server was broken, so the dot is OFF with the panel shut again — the acknowledgement HOLDS. The dot's re-arm is the frame beside it. |
| [`mcp-all-connected`](mcp-all-connected/) | Three servers up: the word, the tool count and the scope qualifier per row (`connected 12 tools global`), the `3 of 3 connected` tally, and no dot anywhere. Measured: the healthy rows sit on a **32px pitch** (consecutive mark clusters at y432, y464, y496 in the dark frame), which is `§ 8`'s pinned row height. |
| [`mcp-auth-required-closed`](mcp-auth-required-closed/) | The dot with the pane SHUT: measured **21 danger-bound pixels in the dark theme and 52 in the light** inside an 8px box at the trigger's top-right (x398-405, y12-15), and nothing else red in the header band. |
| [`mcp-auth-required`](mcp-auth-required/) | The same session with the pane open **on the list**: the same measurement returns **zero** danger-bound pixels, the `notion` row carries the wire's own word `auth-required` and its remedy line, and the tally reads `1 of 2 connected · 1 need attention`. That pair is `§ 3.4`'s whole rule in two frames. |
| [`mcp-disconnected`](mcp-disconnected/) | The transport state beside the auth state, with its own remedy — the two words the operator reported being unable to tell apart, side by side and distinguishable. |
| [`mcp-unknown-status`](mcp-unknown-status/) | A word this build was not taught (`reticulating`): rendered verbatim in the quiet ink with the unknown mark and **no** remedy line — the refusal is never to claim the good state, and never to paint a `danger` failure the renderer cannot name (the same frame's sibling `mcp-unknown-status` from the pane-open story carries the dot's half of `§ 7.3`). The earlier text called this a closed-panel frame; it is the pane OPEN on the list, so the dot is off while it is shown, which is `§ 3.4` and not a refusal. |
| [`mcp-cold`](mcp-cold/) | The cold payload (no runtime attached): the section's one line in place of the tally, rows with name and qualifier only — no per-row `cold` word, no tool count, no dot. |
| [`mcp-connecting`](mcp-connecting/) | A server coming up: not a problem, no dot, its own quiet word. |
| [`narrow-800`](narrow-800/) | The window floor, the rail expanded, the panel at its **320px minimum**. Measured by column scan of the committed file: the last canvas-ground column is x479 and the pane starts at x480, i.e. `800 - 480 = 320px` (the divider's shadow gutter is outside the pane, which is why the hairline's own darkest pixel reads 2px further left). The name segments truncate (`Read invoice…`, `Compare against…`) while every number stays whole — `§ 8` makes the name the only segment allowed to shrink. |
| [`capability-absent`](capability-absent/) | An older backend: `§ 10.5`'s one quiet line and its action (`Retry` here; `Update backend` appears too when the main process ships an updater, which a Storybook frame does not), the roster rows still present and deliberately not openable, and **no MCP section at all** beside them — measured zero danger-bound pixels, because MCP absent is not MCP broken. |
| [`reduced-motion`](reduced-motion/) | The pane's two animated glyphs with motion reduced: the running child's spinner and the MCP `connecting` mark both hold their frame, and shape still distinguishes every state. |

## Measured comparisons

Everything below is a reading taken from the committed files, with the method
named so it can be re-run.

| Claim | Measurement |
| --- | --- |
| The panel is 420px by default and takes its 320px floor at the window floor. | The pane's own edge, from the modal colour of each column: **x860 of 1280** in `mcp-auth-required` (1280 − 860 = **420px**) and **x480 of 800** in `narrow-800` (**320px**) — the design's own constants, both themes. Measured as a column scan across y = 30-98% of each committed file; the divider's shadow gutter lies OUTSIDE the pane, which is why counting from the hairline's darkest pixel over-reads by the 4px and 2px an earlier pass reported. |
| The pane is a `surface` step above the column's `canvas`. | Modal colour of a panel-interior box against a column box, same frame: dark **(30,26,21)** vs **(23,19,14)**, light **(250,248,242)** vs **(246,241,231)**. A lightness step in both palettes, no hue shift — `branding.md`'s elevation rule. |
| The dot is on with the panel shut and cleared when the list is shown. | Count of pixels with `r>150, g<130, b<130` in the header band: **21** (dark) / **52** (light) in `mcp-auth-required-closed`, confined to x398-405, y12-15 — an 8px dot at the button's top-right; **0** in `mcp-auth-required`, `trigger-idle` and `capability-absent`. |
| A healthy MCP row is 32px; a problem row is 48px and carries a second line. | Mark-column clusters in `mcp-all-connected`: y432-440, y464-472, y496-504 → two consecutive **32px** pitches. In `mcp-auth-required` the problem row's cluster is 16px tall against the others' 8 and the next row's mark centre sits 29px below it rather than 32 — the mark is centred in a taller box, which is the pin plus the extra line. |
| The roster's disclosure is a real expander. | `roster-capped` renders seven rows and `Show 3 more` for nine children at a cap of seven; `roster-capped-expanded` renders all ten with no disclosure, driven by a real click on `[data-run-panel-disclosure]` and held until the button leaves the DOM. The cap and the priority order are pinned in `scripts/run-detail-model.test.mjs`. |
| The plan carries one count and no per-phase counts. | `todos-phased` and `todos-only` show exactly one tally per section — `11 of 15 closed · 1 dropped`, the word the review round corrected from `resolved` (dropped is not resolved, and 3 + 1 cannot be checked against 3 rows) — and the phase headers are names alone. Pinned in the model test. |

**What these frames cannot carry, and where it lives instead.** The MCP poll's
cadence (15s closed / 5s open), its single in-flight tick, its window and focus
gates, and the canonical-change accelerator are timing facts — no still shows
them, so they are argued from the code (`use-mcp-servers.ts`) and belong to the
QA matrix's request counting. The reader's pulse-to-transcript path is the same
kind of fact, which is why it needs the live-app frame named above. And the
ledger's re-arm rule (`seen' = seen ∩ problems`) is invisible by construction —
a correctly quiet dot and a never-re-armed one are the same pixels — so it is
pinned as a model test instead.
