# Live-buffer edit and empty-proposal evidence

These selected browser-tool screenshots show the real production canvas editors
and edit API client against a disposable real FastAPI server. The model executor
is deterministic; Electron native saves/platform events are replaced by an
in-memory adapter. They do **not** prove packaged Electron IPC, native disk
writes, a physical keyboard shortcut, speech, or third-party model execution.
See [the reproduction runbook](../../edit-api-validation.md).

## Before / after

| Frame | Observed behavior |
| --- | --- |
| [Before: empty proposal](before-empty-proposal.png) | API200 returned an insertion, but the empty CodeMirror range threw and the proposed content could not be inspected. |
| [After: code single line](after-code-single.png) | `Updated buffer` is visibly above the controls, before acceptance. |
| [After: code multiline](after-code-multiline.png) | Both proposed lines are visible above the controls, before acceptance. |
| [After: empty Markdown](after-markdown-empty.png) | The inserted Markdown text is visible above the controls, before acceptance. |

The before frame is 3456×1812; the selected after frames are 3456×1924. They are
unaltered browser captures, not composited or DOM-only evidence. The insertion
position is measured from the real widget bottom relative to its positioned
container plus an 8px gap, rather than inferred from string length/line count.

Independent design capture pairs for code single/multiline were byte-identical.
Markdown insertion/control geometry was stable; the only image delta was the
unrelated toolbar at `(3302,289)-(3326,303)`. A separate UX run observed a
transient overlapping single-code first frame before settling correctly, so
these results are **not** a claim that every transitional frame is reflow-free.
Both reviewers inspected the settled proposal and controls visually, not only
accessibility text. Nonempty prompt/diff baseline frames were byte-identical
before the insertion-only correction; the final neighboring nonempty flow kept
its existing layout.

## Actual interaction receipts

- Empty single-line code reject: empty editor remains, `No native save requested`.
- Empty multiline code accept: native-save request
  `{"path":"/disposable-client-only/unsaved.txt","content":"Updated buffer\nSecond proposed line"}`.
- Empty Markdown accept: native-save request
  `{"path":"/disposable-client-only/unsaved.md","content":"Updated buffer"}`.
- Live buffer request: `file_content` is sent with the current editor value;
  a changed buffer after initial document load was exercised separately.
- Earlier full flow covered populated/empty prompts, delayed loading,
  provider error/retry, nonempty code acceptance and Markdown rejection.
- Final successful design run recorded no error-level browser console entries.

The static runtime gate (`pnpm check-edit-diffs`) ran the production diff plugin
with real CodeMirror state/decorations: a before-source snapshot failed with
`RangeError: Invalid range for replacement decoration`; the patched plugin
passed four single/multiline insertion previews and nonempty/dismissed cases.
Actual browser visibility and accept/reject checks above remain necessary.

Existing fixed-width prompt clipping in a 360px canvas and nonempty review-overlay
placement were unchanged, non-gating observations, not silently fixed here.
