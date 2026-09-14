# R2: a refused system prompt keeps the user's text (review round 3)

Round 2 asked for a pre-flight on `legacy.agent.systemPrompt.update`. It landed
on a broken consumer: the pre-flight threw to refuse, but
`system-prompt-settings.tsx` caught that throw without rethrowing, so
`EditableField` read the resolved promise as **success** — it exited edit mode
and displayed the rejected text as if it had saved. The text was never
persisted, so the next refetch replaced it with the old prompt and the user's
edit was silently gone.

That is Q-7's own defect — a refusal that retires the draft — one surface over,
introduced by the commit that fixed it for commands.

## Which surface produced these frames, and what they do not prove

**Surface:** the shipped `SystemPromptSettings` component, mounted by
`harness/r2-system-prompt.tsx` behind an injected `window.api.desktop` — the
same technique as `scripts/backend-error-evidence.html`, which puts the renderer
on the Electron IPC branch that ships rather than the browser-dev HTTP branch.
The component, the hook, the pre-flight and `EditableField` are all the real
ones; nothing is restated in the harness.

**The bridge answers the update op with HTTP 200.** Nothing on the server side
can be credited for the refusal: if the editor keeps the user's text, the client
pre-flight is what refused it. The harness records every op it is asked for, so
the driver asserts that an oversize prompt produced **no update request at all**.

**Capture:** raw CDP against a private headless Chrome profile under the system
temp dir, swept on exit, focus-emulated before measurement. The input is typed
through the real textarea's native value setter and the real **Save** button is
clicked at its own element — not a synthetic call to `onSave`.

**These frames therefore do NOT prove:** packaged Electron IPC, a real backend's
replies, or a real model completion. Those gaps are named in the PR body.

## Before / after

Both frames are the same moment: a 1,000,001-character prompt (over the
1,000,000 character cap, *under* the 1,100,000 byte budget — the branch R1 found
documented as unreachable) typed into the editor, Save clicked.

| Frame | Observed behaviour |
| --- | --- |
| [Before](r2-before-refusal-loses-edit.png) | Edit mode **exited**. The field shows `You are a helpful agent.` — the old value — and the user's 1,000,001 characters are gone. There is nothing left to retry. |
| [After](r2-after-refusal-keeps-edit.png) | Edit mode **held**, the rejected text still in the textarea, Save and Cancel both available. |

## Driver output

Pre-fix (both halves reverted, each mutation proven applied and parsing):

```
AFTER_REFUSAL  stillInEditMode: false   userTextKept: false
               updateRequestsMade: 0    bodyShowsOriginalAsSaved: true
RECOVERY       error: "not in edit mode - text was lost, nothing to retry"
```

Post-fix, same driver:

```
AFTER_REFUSAL  stillInEditMode: true    userTextKept: true   (1,000,001 chars)
               updateRequestsMade: 0    allOps: [config.get, legacy.agent.systemPrompt.get]
RECOVERY       exitedEditMode: true     updateRequestsMade: 1   updateChars: [24]
```

The recovery leg is the Q-7 property on this surface: the refusal is
**escapable**. Shortening to a legal prompt and saving again genuinely reaches
the transport (one update request, 24 characters) and exits edit mode — so the
refusal does not latch the editor.

`PAGE_ERRORS []` on every run: the surface mounted clean rather than being
photographed mid-crash. An earlier take was discarded for exactly that — the
harness's first bridge answered `config.get` without a `values` key, and
`useConnectivityGate` threw on `config.values.hosting`, leaving an empty root
that would have read as "the editor kept nothing".
