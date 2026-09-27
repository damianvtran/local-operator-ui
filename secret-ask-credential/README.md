# Secret-ask credential input — review frames

Frames for `fix/secret-ask-credential-input` (the docked `ask` card's
`secret: true` state). They live on this `evidence/` branch so the PR can
render them without committing a new evidence directory into the feature
branch; the committed `docs/evidence/chat-ask-options` set is untouched.

Taken with `scripts/capture-evidence.mjs` against this worktree's Storybook
(`storybook dev -p 16016`), the two brand themes only:

    node scripts/capture-evidence.mjs http://127.0.0.1:16016 \
      --only=chat-ask-options \
      --dirs=secret-ask,secret-ask-typed,secret-answer-in-flight,secret-answer-held \
      --themes=localOperatorDark,localOperatorLight --allow-backend

`--allow-backend` was needed because the operator's own backend answers on
`localhost:1111` here; the docked-card stories render from fixtures and make no
request, which is what that flag states.

**RE-CAPTURED FOR THE ROUND-1 REMEDIATION** (design D1/D2, UX U1-U4, reviewer
MINOR-1, QA Q-1): all four states were re-taken after the held/released split
and the in-flight story change, so every file here is a function of the
remediation tree. The two states the reviews named are now reached by REAL
interaction rather than a bare render — the row focuses the field, types
through `Input.insertText`, and submits through the real key pipeline (an
enter with `text: "\r"`, so Chromium's implicit form submission runs); the
shutter waits for each state's own sentence and re-reads the field's value at
shutter time (`expectValueKept`), which is what makes "the value is kept" a
claim a frame can fail rather than one it merely illustrates.

| file | state |
| --- | --- |
| `frames/secret-ask--<theme>.webp` | the empty field: placeholder, reassurance line, Send disabled |
| `frames/secret-ask-typed--<theme>.webp` | the mask mid-entry (`Input.insertText`); Send enabled |
| `frames/secret-answer-in-flight--<theme>.webp` | mid-submit: "Sending your answer…" + field and Send refused, WITH the typed value still under the mask (the reading the round-1 review found unphotographed) |
| `frames/secret-answer-held--<theme>.webp` | the held card after an unknowable outcome: field and Send disabled, the typed value kept, and the held hint ("nothing can send again · Esc hides") |

The `secret-ask-typed` entry carries a shutter-time claim (`expectAttribute`
`type="password"`), the in-flight and held entries carry theirs too plus the
`expectSentence` that waits for the state's own eyebrow / hint and the
`expectValueKept` claim that the masked value is still there: a frame cannot
ship under any of these names with the wrong surface, the wrong sentence, or a
prematurely cleared field.
