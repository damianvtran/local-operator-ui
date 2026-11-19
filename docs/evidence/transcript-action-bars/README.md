# Transcript action bars — the three placements

The operator's regression report and its fix, photographed on the real built app.

> "We should have actions on hover only for the in between text messages but all final responses to the user even in between should have the inline action bar from before where they're hidden buttons on the row of the time, and appear on hover. Same with the user message, it should be a row under the user's message that takes up space. It's only the in-between text messages, etc. that are not final responses to the user that need that hover since they shouldn't have a row under them."

The pill in the operator's screenshot — copy/speaker/branch enclosed in a bordered, filled, rounded box beside `9:13 AM` — is the specific regression this set proves gone:

> "the previous bar was SMALL BARE ICONS - no boxes, no borders, no container, no background surface, no divider"

## The defect, in one pair

`before/closing/hover/localOperatorLight.webp` shows the closing answer's control wearing a ground, a hairline, a radius and padding on the `Worked for … / timestamp` line. `after/closing/hover/localOperatorLight.webp` shows the same line with three bare icons before the stamp, no container. The before report measures the chrome verbatim: `background rgb(254, 253, 250); border 1px solid rgb(218, 213, 203); radius 10px; padding 0px 4px 0px 4px`. The after report: `no container chrome`.

## The classification

The three classes are decided by the MESSAGE'S ROLE, not by position in the turn. The fact is the wire's own, stated by the core in `local_operator/tui/narration.py::is_intermediate_narration`: **`tool_calls` is the whole rule** — an assistant message that carries its own `tool_calls` is mid-turn narration/status commentary; one that carries none is a handover to the reader. `stop_reason` does not corroborate it alone (a `toolUse` with empty `tool_calls` is reachable and is a final response).

The desktop reducer records that fact as `callsTools` on the assistant record at the two settle paths that can state it (the durable journal payload and `message_end`, plus the id-less fallback and `agent_end`'s abort sweep). `turn-segments.ts::isFinalResponse` is the single predicate: settled, paints text, `callsTools !== true`.

## The three placements

1. **Final response — in flow, on a reserved line.** The closing answer keeps its bar on the existing `Worked for … / timestamp` line (numbers and stamp are that line's; the action row sits before the stamp). A NON-CLOSING final response gets one meta row under its prose, in the foot line's `mt-1 flex items-center gap-2` rhythm, and offers the full set: Copy, Speak, Fork. No invented caption, no timestamp.
2. **User message — a reserved row under the bubble.** It takes layout space and reveals on hover, so the bubble and the next row do not move when the pointer arrives.
3. **In-between status text — hover only, no reserved row.** The only class that keeps the overlay. Below 900px the row reserves a 40px trailing band (28px bare target + 12px clearance) so the prose wraps before the control; at ≥900px the control moves into the `-right-10` gutter and the band is zero.

**No container, on all three.** The row and the overlay are bare: no ground, edge, radius, padding or shadow. Buttons are ghost icons with an ink step on hover and no hover ground; the reveal is opacity-only.

## Condensing

`partitionRun` keeps a final response visible when the harness continues past it (V5), closing the phase rule's 1-in-234k residual. The condensed frames show the turn folded to its bars while the final response and its own action row stay on screen. Measured delta from the frozen corpus (documented in `turn-segments.ts`): ≤286 of 254,999 prose rows; the 233,783 rows that carry their own calls are untouched.

## Frames

Every frame is a real capture at the app's own pixel size (DPR 2); nothing was resized. Themes are the palette ids.

**The pixels are not tracked.** Frames are rig output and live in the ignored `docs/evidence-frames/transcript-action-bars/` tree (the post-#1256 convention; see `.gitignore`), seeded once from a captured checkout. This README stays tracked as the set's index and measured record. For a reader who does not have the frames tree, the same files are hosted on the `evidence/1260-action-bars` branch under `docs/pr-evidence/1260-action-bars/`, and the PR description embeds the key pairs from there.

| Class | State | Viewport | Theme | Shows |
| --- | --- | --- | --- | --- |
| closing | rest / hover | 1380×900 | light, dark | bare icons before the stamp on the `Worked for` line; hover moves nothing and reveals no box |
| mid-turn-final | rest / hover | 1380×900 | light, dark | the reserved meta row under a non-closing handover; in-flow, full Copy/Speak/Fork set |
| user | rest / hover | 1380×900 | light, dark | the reserved row under the bubble; zero layout shift |
| commentary | rest / hover | 1380×900 | light, dark | the hover-only overlay in the wide gutter; zero flow height |
| condensed | rest / hover | 1380×900 | light, dark | the folded turn with the final response and its bar still visible |
| user, commentary | rest / hover | 800×900 | light, dark | the app's minimum width: the 40px band keeps prose clear of the overlay |
| d3: copy-hover, copied, fork, speak | — | 1380×900 | light, dark | per-button states: ink step with no ground, `Copied` pinned, the Fork dialog, and Speak's disabled sentence |
| selection | — | 1380×900 | dark | a drag over the mid-turn final response: one toolbar, the row stood down |

`before/` is the base tree (`ceed42e2`) with the hover-only-overlay regression; `after/` is the fixed tree (`9e8fe58` for user/commentary, `ceed42e2` for closing/mid/condensed where the remediation changed no visual code). `after-min-800/` is the same split at 800px.

## Measured numbers

From QA's real-app reports (`after-1380.json`, `after-1380-r2.json`, `after-min800-r2.json`), all `ok: true`:

- **Closing row, 1380 light:** row `{x:995.3, y:416.2, w:92, h:32, right:1087.3}`; stamp `right:1203` — the stamp stays rightmost (`stamp.right >= row.right`). Row is `position: static` (in flow, height 32), `no container chrome`, rest `opacity 0`, hover `opacity 1`, hover box delta `{0,0,0,0}`, prose overlap `0px²`. Full set present: `["Copy","Speak aloud","Fork from this message"]`.
- **Mid-turn final response, 1380 light:** row `{x:1111, y:416.3, w:92, h:32}`; wrapper height 32; `position: static`; `proseBottom 412.3` vs `rowTop 416.3` → `overlap 0px²`; hover delta `{0,0,0,0}`.
- **User row, 1380:** `rowTop=178 bubbleBottom=174 gap=4px`; `rowRight=1203 bubbleRight=1203 delta=0`; flow, `opacity=0`, `height=32`; the zero-shift pair — `bubbleDelta={"dx":0,"dy":0,"dw":0,"dh":0} nextDelta={"dx":0,"dy":0,"dw":0,"dh":0}` at rest and on hover; hover `opacity=1`. _Measured on #1260, before the per-message timestamps of #1285: `rowRight` is the action row's box; after #1285 the stamp is the rightmost element, so `bubbleDelta` compares the bubble's right edge to the stamp's right. The historical number is kept as taken._
- **Commentary, 800:** `paddingRight=40px controlLeft=704 proseRight=692 clearance=12px overlap=0px²`; revealed overlay `opacity=1 overlap=0px² clearance=12`.
- **Commentary, 1380 (wide):** `column=810px paddingRight=0px controlLeft=1215 proseRight=1203 clearance=12px overlap=0px²` — the band is dropped and the gutter is unchanged.
- **Selection:** a drag over the mid-turn final response leaves `visible=["response"] live=1 strip=false` — one toolbar. The response row is `visibility:hidden pointer-events:none` while the selection is live; clearing restores `visibility:visible` (its rest state remains pointer-inert by design).

## Provenance

Real built app, driven headless over CDP by QA's rig against an isolated daemon (`127.0.0.1:18731`) and a scratch config; no live session, no hand-composited frame. Heads: `ceed42e2` (before; also the unchanged closing/mid/condensed after frames) and `9e8fe58` (corrected user/commentary placement and the narrow band). `08aaa17` changes tests and comments only, so the after frames remain valid.

**D3 limitation.** In the isolated rig Speak never gets a configured speech target, so the only state reachable is the disabled sentence (`title` carrying the sign-in reason). The loading/playing/error states are unreachable without a speech credential; the change to that control is a className-only seam (the hover ground is overridden at the caller), accepted by design round 2. The frames capture `speak/` as the disabled sentence.
