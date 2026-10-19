# Internal receipts fold into the action group

## What this proves

PR #1198 makes the transcript's fold tier treat `peer`, `wake`, `custom/hub_message`,
`custom/job_result` and `custom/monitor_prompt` as internal receipts. Before it, every
job result was a run boundary: a long turn became a wall of one-action groups and
standalone `job result:` rows, and the line beside them counted only peer/hub traffic.

The pair below renders the **same synthetic journal page** through the shipped
`CanonicalTranscript` at the **same Storybook story** (`chat-receipt-fold--collapsed` and
`--expanded`), once from base `ab1ab8e65e` and once from this branch. Only the code under
review differs.

The page: one user message, 13 `bash` calls (call 7 fails), 4 job results, 8 hub
messages, 4 peer messages, then the assistant's final answer. The job-result headlines use
the producer's real shape, including `pinned anthropic/claude-sonnet-5-5, ran on
openai/gpt-6.1-sol` and one `failed: Provider connection failed. Retry the job.` result.

| Scene | Before (`ab1ab8e65e`) | After (this branch) |
| --- | --- | --- |
| Standard column, condensed | [before-collapsed.png](before-collapsed.png) | [after-collapsed.png](after-collapsed.png) |
| Standard column, opened | [before-expanded.png](before-expanded.png) | [after-expanded.png](after-expanded.png) |
| 640px column, condensed | [before-narrow-collapsed.png](before-narrow-collapsed.png) | [after-narrow-collapsed.png](after-narrow-collapsed.png) |
| 640px column, opened | (same base fold as standard) | [after-narrow-expanded.png](after-narrow-expanded.png) |
| Receipt-only turn (the turn bar owns the first press) | — | [after-receipt-only.png](after-receipt-only.png) |
| One call + a trailing receipt pair (nested fold) | — | [after-short-mixed.png](after-short-mixed.png) |
| Long mixed-kind inventory (`and N other actions` + receipts), 640px | — | [after-long-inventory-narrow.png](after-long-inventory-narrow.png) |
| Long mixed-kind inventory, standard column | — | [after-long-inventory-wide.png](after-long-inventory-wide.png) |

## What the frames show

- **Before:** the page paints several `1 action` segment bars with hub rows beside them,
  a `Ran 9 commands · 6 incoming messages` fold, and the job-result rows separately
  (the visible window above; the page scrolls). The operator's wall is exactly this
  mixture of small groups and standalone receipts.
- **After:** the same page condenses to **one** fold line,
  `13 shell · 12 incoming messages · 4 job results`, with the final answer untouched
  below it. Opening that line mounts the job results, hub rows and peer rows it counted;
  the failed job's `failed: Provider connection failed. Retry the job.` sentence is in
  the opened body (it is not advertised in the condensed line — UX round 1, U1, deferred
  pending a typed job status on the wire).
- The 640px frames show the same line at the narrow column; it fits on one line in this
  page. A longer page (real session `8c2ff1914f44`, 63 shell + 11 other action kinds)
  adds `and 11 other actions` before the receipt units; its exact wrap was not captured.
- The long-inventory stories exercise the capped line:
  `3 files · 1 web search · 2 shell · 1 edit · 1 task · and 2 other actions · 3 job results`
  at 640px and the standard column. Measured `[data-fold-summary]` rect in both:
  **x=75, width=479.88px, height=19.5px** (one line, right edge 554.88px), with
  `overflow: visible` and `white-space: normal`; no clipping and no wrap at this length.
- `after-receipt-only.png` shows the quiet-turn bar (`Job results · 2`) that owns the
  first press for a settled receipt-only turn; `after-short-mixed.png` shows the inner
  `1 shell · 2 job results` fold after that bar is opened (UX round 1, U2, accepted
  density trade-off).

## How the frames were taken

Storybook (a Vite dev server, **not** a packaged build) served the two worktrees; the
frames are the app's own headless browser host photographs of the story iframe, via the
harness browser at 1024x576, saved as PNG. No install, Electron build, packaging step or
live provider request was made.

- Head: `src/renderer/src/features/chat/canonical/receipt-fold.stories.tsx`
  (`Collapsed`, `Expanded`, `NarrowCollapsed`, `NarrowExpanded`, `ReceiptOnly`,
  `ShortMixed`), replayed through the production `applyHistoryPage` → `CanonicalTranscript`
  path with fixed epoch-second stamps.
- Base: `ab1ab8e65e`, the same story file copied into a scratch worktree; the base
  component ignores the new receipt classification, which is the comparison.
- The 640px frames put the transcript in a `w-[640px]` wrapper; the browser viewport was
  not resized.

## Not covered

This is not a frame of the operator's live app or live session. The live session's
records are covered by `scripts/fixtures/receipt-fold-8c2ff1914f44.json` and the
reducer→mounted-transcript regression in `scripts/receipt-fold-behaviour.test.mjs`
(122 rows → one fold, 8 job results + 9 incoming messages on expansion). Native app
capture, light/dark and non-default themes, zoom, real keyboard traversal and
screen-reader output remain blocked by the host's resource hold; they are listed for a
later native evidence round rather than claimed here.
