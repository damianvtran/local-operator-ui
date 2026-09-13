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

Thirty-seven stories over the two brand themes is seventy-four frames. One story
(`reduced-motion`) carries the rig's fourth tuple field, `{ reducedMotion: true }`,
which sets the CDP `prefers-reduced-motion` feature for that frame only and resets
it for the next one — the app's cap is a `@media` block in `styles/index.css`, so
a frame that faked the reduced style would be evidence about the fake. Two stories
(`trigger-hover`, `trigger-open-hover`) carry the rig's `{ hover: <selector> }`
option, which moves a real pointer over the element with
`Input.dispatchMouseEvent` before the shutter — `:hover` is browser state a story
cannot produce, and a story that forced the class would be a picture of the
forced class.

**This set's live-app counterpart is `../chat-run-panel-live/`, and the split is deliberate.**
The one frame that must come from the real app against a real running child (`reader-live`
paired to `~/local-operator-worktrees/desktop-subagent-transcript`'s
`subagents.transcript` route) is not in THIS set: the pairing, a real turn
with a live child and the CDP drive of the running app were completed in the
review round, and `../chat-run-panel-live/` is that pair, with the pairing, the ids
and the backend's own read counts recorded in its README. The `reader-live` below
is the FIXTURE-backed rendering of the same state — it proves the row pipeline,
and the live pair is what proves the wire. The two are kept apart deliberately and
named as such everywhere they are cited.

## The frames

| Frame | What it shows |
| --- | --- |
| [`trigger-idle`](trigger-idle/) | The icon on screen with nothing in flight and nothing open — the state the retired trigger did not exist in at all, because it was gated on `hasRunDetails`. Measured: **zero** danger-bound pixels in the header band, so the button is there and the dot is not. This is the trigger's **closed, at-rest** state. |
| [`trigger-hover`](trigger-hover/) | The same trigger with a real pointer on it (the rig's `{ hover }` option dispatches `Input.dispatchMouseEvent` at `[data-run-panel-trigger]`), so it is the **closed, hovered** state and it is one of the two frames that make the trigger's ground vocabulary visible at all. Measured ground: **`elevated`** — dark `(40,34,25)`/`(38,35,25)`, light `(255,253,252)` — against `trigger-idle`'s `canvas`. |
| [`trigger-open-hover`](trigger-open-hover/) | The **open, hovered** state: the pane open and the pointer on the pressed trigger. Measured ground: **`accent-wash`** — dark `(23,40,30)`, light `(231,242,233)` — i.e. the pressed ground SURVIVES the hover. This is design review round 2's `D2-1`: before the fix the hovered-open trigger painted `elevated`, the same ground as hovered-closed, so the open state's only signal under the pointer was the 16px glyph's ink. With `panel-empty` (open, at rest) it is also, by construction, byte-identical — see the identity section below; the identity IS the claim, and the rig's pointer is proven to land by `trigger-hover`, which does change pixels. |
| [`panel-empty`](panel-empty/) | The same session with the pane open: one quiet line, no skeleton and no placeholder rows. Unreachable through the retired popover, whose trigger did not exist on a session with no work. |
| [`settled-history`](settled-history/) | A finished run: the roster is history, the plan contributes no open work, and the panel's quiet state says so over a roster that is still readable. |
| [`roster-only`](roster-only/) | One section, no empty heading. Three children in priority order with the two-line row: label and activity, then the numbers run (`researcher · 3m34s · 21% · $0.19`) ending 12px inside the pane's right edge. |
| [`todos-only`](todos-only/) | One section: the FLAT plan — three rows under a `To-dos` heading with no phase names at all, because this fixture's plan arrived as a single unnamed phase (`§ 6.3`'s back-compat shape). One tally, `1 of 3 closed`, and no per-phase counts because there are no phases. (An earlier revision of this row described the fifteen-item phased plan, which is `todos-phased`'s frame — the two stories were byte-identical before the review round, and the row was not updated with the fixture that separated them.) |
| [`both-in-flight`](both-in-flight/) | Both sections and the hairline between them. |
| [`roster-capped`](roster-capped/) | Nine children at the roster's cap: seven rows and the disclosure, `Show 3 more`. |
| [`roster-capped-expanded`](roster-capped-expanded/) | The same roster **after the disclosure is clicked** — all ten rows, no disclosure. The click is real (`useClickAndWait` drives the button and holds the shutter until it leaves the DOM), which is what makes this the frame that proves every child is reachable rather than one that proves a cap exists. |
| [`todos-phased`](todos-phased/) | The fifteen-item plan, phased: `Reconcile` has lost all five of its rows to the cap and states so on its own header line — `Reconcile · 5 hidden`, which is the disclosure `D1-7` fixed rather than a per-phase count; `Verify` and `Publish` keep their rows and are names alone. Every item state is here (done struck, dropped tagged, blocked with its reason line) over one tally, `11 of 15 closed · 1 dropped`. Distinct from `todos-only` on disk. |
| [`todos-implicit-phase`](todos-implicit-phase/) | `§ 6.2`'s finding (2): the lazily-created implicit phase beside a named one. The implicit half renders headerless and its items join the list, so the plan is named once. **Read this against `todos-phased`**: that is the control (every phase named), this is the fold. The frame pair cannot show the retired rendering, because the whole-plan fold this one replaces is deleted; what it proves is the state that fold produced. |
| [`swap-canvas-open`](swap-canvas-open/) | The chat column with `isCanvasOpen` set: the run trigger is **present and unpressed**, which is the gate this change removed (`!isCanvasOpen`). The canvas button is deliberately not rendered as "pressed" — the frame is captured in the state where the preference is set and the trigger must still be there, which is the claim; a pressed canvas control is `canvas-workspace`'s frame, not this one. The canvas pane itself is not drawn — `ChatContent`'s canvas branch mounts the real editor against a document set, and a story that leaves it unseeded hangs before it paints; the canvas's own frames are `canvas-workspace`'s set. |
| [`swap-run-open`](swap-run-open/) | The mirror: the trigger pressed and the run pane open in the same slot. One pane in each frame is the claim, and the exclusivity is the store's (`§ 3.2`). |
| [`reader-live`](reader-live/) | A running child's reader, **fixture page** (the LIVE pair is `../chat-run-panel-live/`): chrome bar with the back control and the breadcrumb, the facts row (state, label, elapsed, context, cost, `model_label`), the `Delegated with` brief as ONE line (this fixture's launch map carries the concise prompt, so the block renders unfolded), then the child's transcript rendered through the parent's own path — durable rows, a `bash` tool row, the outcome text. |
| [`reader-settled`](reader-settled/) | The same child settled: the elapsed clock has stopped and the outcome block carries the final text. The fixture used to hard-code `result_text: ""`, so the frame the README advertised had no outcome block at all; the fixture now carries a real settled result and the claim is true of the file. |
| [`reader-failed`](reader-failed/) | The verbatim exception in the outcome block, `danger` on the header's state icon only. |
| [`reader-nested`](reader-nested/) | A grandchild: the breadcrumb carries two levels and the chrome bar's back control pops one. A reader replaces the pane's body wholesale, so this frame also shows the roster is not behind it. |
| [`reader-deep-floor`](reader-deep-floor/) | The same breadcrumb at **depth 3** with the pane at its 320px floor — the widest lineage the cap-and-shrink rule has to survive. Measured in the frame: `Run details / Re… / V… / Check the …` — the ancestors shortened to their leading words and the current node (the reader's title, `§ 5.2`) kept a legible share. Review round 2 left this open as a code-read-only risk; the guard is the ancestors' `min-w-0` plus the current node's `min-w-24`, and this is the frame that proves it. |
| [`reader-resumed`](reader-resumed/) | A resumed child: the durable `subagent-launch:<job_id>` turn reconciled to its concise authored prompt, with **no role/team/system preamble above it**. `§ 12`'s risk 3 has no other frame. |
| [`reader-brief`](reader-brief/) | The `Delegated with` brief in the ONE state that renders it: a child whose transcript does NOT already carry the instruction, so the block is the only copy. The brief is set in the PROSE role (`§ 4` — it is a paragraph, not machine output, and monospace was the review round's `D1-3`), and `reader-resumed` is its complement: the same block stands down when the transcript already says it. This story's record predates `launch_message_id`, so the brief falls back to the child's own multi-line prompt: the frame shows six of its eight lines with **`Show 2 more lines`** on the control — the fold and its expander `§ 11.3` cites it for, which the earlier fixture (a one-line launch prompt, `folded.hidden === 0`) could not render at all. |
| [`reader-image`](reader-image/) | A child's OWN image, painted: the row carries a content-addressed digest and the reader resolves it through the child-scoped attachment op (`subagents.attachment`), so the digest is a picture rather than the unavailable note. The story stubs the renderer's media relay with real PNG bytes, because a Storybook frame has no backend — so this frame proves the RENDERER's half (the scope reaches `desktopMedia`, the op is the child-scoped one, the bytes paint), while the route's own mapping is pinned by `scripts/tool-row.test.mjs` and exercised against a running server by QA. |
| [`reader-pending`](reader-pending/) | `§ 10.1`'s first absence: the child has a directory and no transcript yet. Its own copy, one quiet line, and no retry ladder — the state is not an error. |
| [`reader-gone`](reader-gone/) | `§ 10.1`'s second absence: the directory is not there (swept, or removed by hand). A terminal statement, and the same way out as any other terminal reader state. |
| [`reader-unaddressed`](reader-unaddressed/) | A reader whose row carries no `childSessionId` — the cold-conversation shape (`§ 10.1`, review round 1 R1-6). The roster does not offer such a row as openable; this is what the reader says if it is reached another way (the breadcrumb, the sibling stepper), instead of sitting on `Loading…` forever. The fixture is the shape that produces it — the durable graph's own status word (`paused`) with no session id and no launch time — and the line states the FACT ("this subagent's row carries no session id") rather than the cause the earlier copy named, which was wrong in the ordinary case (round 2, R2-2). |
| [`mcp-dot-ack`](mcp-dot-ack/) | The last step of the same sequence, and the one a single state cannot show: the server healed while the list was on screen (so the ledger PRUNED it, `seen' = seen ∩ problems`), the panel was closed, and the server broke again with the pane shut — **the dot is back**. Without this frame the re-arm rule has no picture. |
| [`mcp-dot-ack-acknowledged`](mcp-dot-ack-acknowledged/) | The ledger's step 2: the list was shown while a server was broken, so the dot is OFF with the panel shut again — the acknowledgement HOLDS. The dot's re-arm is the frame beside it. |
| [`mcp-all-connected`](mcp-all-connected/) | Three servers up: the word, the tool count and the scope qualifier per row (`connected 12 tools global`), the `3 of 3 connected` tally, and no dot anywhere. Measured: the healthy rows sit on a **32px pitch** (consecutive mark clusters at y432, y464, y496 in the dark frame), which is `§ 8`'s pinned row height. |
| [`mcp-auth-required-closed`](mcp-auth-required-closed/) | The dot with the pane SHUT: measured **21 danger-bound pixels in the dark theme and 52 in the light** inside an 8px box at the trigger's top-right (x398-405, y12-15), and nothing else red in the header band. |
| [`mcp-auth-required`](mcp-auth-required/) | The same session with the pane open **on the list**: the same measurement returns **zero** danger-bound pixels, the `notion` row carries the wire's own word `auth-required` and its remedy line, and the tally reads `1 of 2 connected · 1 need attention`. That pair is `§ 3.4`'s whole rule in two frames. |
| [`mcp-disconnected`](mcp-disconnected/) | The transport state beside the auth state, with its own remedy — the two words the operator reported being unable to tell apart, side by side and distinguishable. |
| [`mcp-unknown-status`](mcp-unknown-status/) | A word this build was not taught (`reticulating`): rendered verbatim in the quiet ink with the unknown mark and **no** remedy line — the refusal is never to claim the good state, and never to paint a `danger` failure the renderer cannot name. The pane is OPEN on the list, so the dot is off while it is shown, which is `§ 3.4` and not a refusal; the dot's own half of `§ 7.3` in a shut pane is `mcp-auth-required-closed`. (The row used to end by naming "the same frame's sibling `mcp-unknown-status`", i.e. itself — there is exactly one such story.) |
| [`mcp-cold`](mcp-cold/) | The cold payload (no runtime attached): the section's one line in place of the tally, rows with name and qualifier only — no per-row `cold` word, no tool count, no dot. |
| [`mcp-connecting`](mcp-connecting/) | A server coming up: not a problem, no dot, its own quiet word. |
| [`narrow-800`](narrow-800/) | The window floor, the rail expanded, the panel at its **320px minimum**. Measured by column scan of the committed file: the last canvas-ground column is x479 and the pane starts at x480, i.e. `800 - 480 = 320px` (the divider's shadow gutter is outside the pane, which is why the hairline's own darkest pixel reads 2px further left). The name segments truncate (`Read invoice…`, `Compare against…`) while every number stays whole — `§ 8` makes the name the only segment allowed to shrink. |
| [`capability-absent`](capability-absent/) | An older backend: `§ 10.5`'s one quiet line and its action (`Retry` here; `Update backend` appears too when the main process ships an updater, which a Storybook frame does not), the roster rows still present and deliberately not openable, and **no MCP section at all** beside them — measured zero danger-bound pixels, because MCP absent is not MCP broken. |
| [`reduced-motion`](reduced-motion/) | The pane's two animated glyphs with motion reduced: the running child's spinner and the MCP `connecting` mark both hold their frame, and shape still distinguishes every state. **This frame is byte-identical to `mcp-connecting`'s dark frame and near-identical in light** — see the identity section below: the rig caps animation on EVERY frame, so the media feature cannot change a still, and the claim lives in `styles/index.css`'s `@media (prefers-reduced-motion: reduce)` block rather than in this picture. |

## Frames that are byte-identical to another, and what that means

A frame that is a byte-for-byte copy of another proves **nothing** about the
state it is named for, so the set does not claim distinctness it does not have.
`md5` over the 74 committed frames gives **69 byte-distinct pictures**; the five
identities, and which of them is a defect and which is the point:

| frames | md5 | what it means |
| --- | --- | --- |
| `both-in-flight` == `swap-run-open` | *was* `5d2b2a5085816a02ebc078e4171cb68a`, both themes | **This was a defect and it is fixed.** The two exist to prove different things — the two sections coexisting, versus which pane owns the slot — and the swap pair rendered the same fixture, so the "mirror" frame carried no picture of its own. `swap-canvas-open`/`swap-run-open` now render `fixtures.swapSlot()` (one child, one open to-do), and all four frames were re-taken. |
| `trigger-open-hover` == `panel-empty` | `69e0e5aa2e` dark, `6d45582f90` light | **This one IS the claim.** `D2-1`'s fix says the pressed ground must not change under the pointer; a hover that still altered a pixel would be the defect. The pointer's arrival is proven by `trigger-hover`, which does move pixels against `trigger-idle`, and both hover frames are taken by the same rig option. |
| `mcp-dot-ack-acknowledged` == `trigger-idle` | `69a3a84199` dark, `41926989f3` light | **Inherent, and stated rather than claimed.** An acknowledged dot and a never-broken one are the same pixels by definition — the ledger's hold is invisible, which is why it needs no affordance (`§ 3.4`). The rule that produces the hold is pinned in `scripts/run-detail-model.test.mjs`; the frame is kept as the sequence's endpoint, not as a distinct picture. |
| `reduced-motion` == `mcp-connecting` | `170ac94459` dark (0 differing pixels); light differs in 2,570 scattered pixels (0.29%, single-pixel antialiasing in the pane) | **Inherent to the rig.** `capture-evidence.mjs` injects `animation:none; transition:none` before every shutter, so a still cannot differ by the motion media feature — a frame that faked the capped style would be evidence about the fake. The claim lives in the `@media (prefers-reduced-motion: reduce)` block in `styles/index.css`. |

Near-twins are not identities and are not listed above: `mcp-dot-ack` and
`mcp-auth-required-closed` share identical dot measurements (21 danger px dark /
52 light) and differ in 118 pixels of the chat column beside the header, which is
the sequence's own point (a dot re-armed reads the same as a dot never cleared
until the surface around it is compared).

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
| The plan carries one tally, and its per-phase lines are disclosures rather than counts. | `todos-only` shows the flat plan's single tally (`1 of 3 closed`) and no phases at all; `todos-phased` shows `11 of 15 closed · 1 dropped` over three phase headers, and the only per-phase line is `Reconcile · 5 hidden` — the fully-shed phase stating what it lost (`D1-7`), not a second count of closed work. The word is `closed`, not `resolved`: dropped is not resolved, and `3 + 1` cannot be checked against three rows. Pinned in the model test. |

| The trigger's ground vocabulary is four states, and the pressed one survives the pointer. | Cropped 120x40 of the header at the trigger and read as a histogram. Closed at rest (`trigger-idle`): dark `(23,19,14)` = `canvas`, light `(246,241,231)`. Closed hovered (`trigger-hover`): dark `(40,34,25)`/`(38,35,25)` = `elevated`, light `(255,253,252)`. Open (`panel-empty`) and open hovered (`trigger-open-hover`): dark `(23,40,30)` = `accent-wash`, light `(231,242,233)` — the same pixels in both, which is the fix. |
| The hover frames carry a REAL pointer, not a forced class. | `capture-evidence.mjs`'s `{ hover: "[data-run-panel-trigger]" }` option reads the element's own `getBoundingClientRect()` and dispatches `Input.dispatchMouseEvent` (`mouseMoved`, with the modifiers/buttons/clickCount fields Chromium's bindings require) before the shutter; a selector that matches nothing throws rather than photographing the resting state. That the dispatch lands is measured, not assumed: it is what turns `trigger-idle`'s `canvas` into `trigger-hover`'s `elevated`. |

**What these frames cannot carry, and where it lives instead.** The MCP poll's
cadence (15s closed / 5s open), its single in-flight tick, its window and focus
gates, and the canonical-change accelerator are timing facts — no still shows
them, so they are argued from the code (`use-mcp-servers.ts`) and belong to the
QA matrix's request counting. The reader's pulse-to-transcript path is the same
kind of fact, which is why it needs the live-app frame named above. And the
ledger's re-arm rule (`seen' = seen ∩ problems`) is invisible by construction —
a correctly quiet dot and a never-re-armed one are the same pixels — so it is
pinned as a model test instead.

**And one thing this set frames only for the TRIGGER.** The trigger's resting and
hovered grounds are frames now (`trigger-idle`/`trigger-hover` and
`panel-empty`/`trigger-open-hover`), but nothing here photographs a FOCUS ring:
the rig moves a pointer, not a keyboard, and no story in the set focuses a control
(`Emulation.setFocusEmulationEnabled` makes the page believe it has the window; it
focuses nothing). The roster row's own hover ground is in the same position. Round
1's remediation said "the set now covers hover and focus"; hover it now does for
the trigger, focus it does not, and this paragraph is the plain statement `D2-4`
asked for in place of the claim.
