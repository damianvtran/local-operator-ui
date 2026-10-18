# LOH-11 UX — current-state evidence

Captured 2026-10-18 by ux-reviewer, openai/gpt-6.1-sol (quota fallback).
Source baseline: `76dda0304bfa4b54ebd42cccd32bbd05841ca4a3`.
These are **BEFORE** frames of real existing components, not proposed tags screens.
Flow contract and limitations: `../../design/sidebar-tags-flows.md`.

## Frames

- `before/view-options-dark.png`: `chat-sidebar-view-menu--popover-open`; options open, Time section/Last active/Active first selected. Viewed by the reviewer.
- `before/sidebar-240-light.png`: `chat-sidebar-sections--narrow-240&args=theme:localOperatorLight`; populated sidebar with Pinned/Running/Older, existing truncation. Viewed by the reviewer.
- `before/context-keyboard-dark.png`: `chat-sidebar-row-context-menu--keyboard-open`; **story-synthesised** ContextMenu event through real row handler, first item focused, no flyout. Viewed by the reviewer. Readout says panel 273×175 at 14,370, row 240×32 at 12,340, focus Archive conversation. This is not a physical-key test.
- `before/pin-backend-unavailable-dark.png`: reviewer clicked Pin conversation in preceding menu; menu dismissed, row retained, inline error plus Retry. Action failure is fixture-limited, not a product regression.

## Command/observation receipts

`GET http://localhost:6006/index.json` returned the story IDs, including `chat-sidebar-view-menu--popover-open`, `--popover-open-narrow`, `chat-sidebar-sections--narrow-240`, `--narrow-min-220`, `chat-sidebar-row-context-menu--keyboard-open`, `--pointer-open`, `--pinned-row`, `--menu-closed`, `--flyout-alone`. The brief's `--narrow240` shorthand is not its literal ID.

Harness browser `snapshot` on View options:
- band: Search chats and agents e4; View options e5; New agent or team e6; Open agent e7.
- popover: Time section e38; Agent and team e39; In one list e40; Last active e41; Created e42; Active first e43; Most recent e44; section checkbox/reorder refs e45–e59.
- These refs describe accessible document order; **no Tab traversal was driven**.

Harness browser `click(selector='e42')` → readback:
- before: `Stored view: section/active/active-first · hidden [] · loads 0`;
- after: `Stored view: section/created/active-first · hidden [] · loads 0`;
- five rows regrouped into Older; panel remained OPEN; `basis [active=false created=true]`.

Harness browser `styles(selector='[role=dialog]', properties=['overflow-y','max-height'])`:
- `rect 51,42 240x640.39`;
- `overflow:auto overflow-x:auto overflow-y:auto`;
- `max-height:662px`.

Narrow-light snapshot's fixture DOM readout:
- `Scroller: content 848, box 668`;
- `Rows drawn: 10 entity · 8 chats`;
- `First title clip: 67px`;
- `First row box: 32px`.

Keyboard-open snapshot: menu refs e6 Archive, e7 Pin, e8 Fork, e9 Copy session ID, e10 Rename.
`click(selector='e7')` → snapshot:
- `Could not pin “Migrate the deploy script”. Desktop controls could not reach the backend process.`;
- Retry button e12;
- Today row retained; Pin and Archive still present;
- fixture focus receipt: `button “IdleMigrate the deploy script5m, l”`.

Surprising action result was checked one step further: `chat-row-context-menu.stories.tsx:136–200` installs a bridge handling capabilities, sessions.list/search, profiles.list and teams.list only; its default throws for unexpected operations. No successful durable pin/archive is claimed.

Static dead-end scan:

```sh
rg -n 'href="#"|to="#"|onClick=\{\(\) => \{\}\}' \
  src/renderer/src/features/chat/components/chat-sidebar*
```

Actual output: no matches (rg exit 1; shell wrapper completed 0). This is a literal placeholder scan, not proof that every flow is functional.

Canonical `skill://design-qa/scripts/copy_scan.py` was read through the skill resource, materialised in `$LOCAL_OPERATOR_SCRATCHPAD`, and executed, not located by filesystem traversal.

```text
python3 $LOCAL_OPERATOR_SCRATCHPAD/copy_scan.py \
  src/renderer/src/features/chat/components/chat-sidebar-view-menu.tsx \
  src/renderer/src/features/chat/components/chat-sidebar.tsx --top 10
exit 0
scanned 2 files, 1414 candidate strings; 0 findings

python3 $LOCAL_OPERATOR_SCRATCHPAD/copy_scan.py \
  docs/design/sidebar-tags-flows.md --exts .md --top 10
exit 0
scanned 1 files, 113 candidate strings; 0 findings
```

No production files changed; no heavyweight automated suite run for this docs-only review. No generic DOM browser script was used: the harness-only restriction takes priority. Native scripts discovered in package.json include check-changed and check-themes; these are future implementation gates, not evidence of tags today.

## Deliberately incomplete coverage

Browser host health check failed during navigation. One recovery/open succeeded; a later navigation lost the surface again. Dispatch stopped; final `browser.close` returned `No browser surface open`. No browser processes were independently launched.

No complete wide/220/320 resize sweep, physical right-click/keyboard input, Escape test, successful pin/archive mutation or tags flow is claimed. The driver has no keypress/right-button operation in this session's tool schema. Existing context stories supply synthetic-event baselines only; menu-closed/flyout-alone/pinned-row were inspected as story/source provenance, not newly walked here. Implementation QA must provide actual-key/pointer and live durable-state proof as specified in the acceptance matrix.
