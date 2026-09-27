# Secret-ask credential input - review frames

Frames for `fix/secret-ask-credential-input` (the docked `ask` card's
`secret: true` state). They live on this `evidence/` branch so the PR can
render them without committing a new evidence directory into the feature
branch; the committed `docs/evidence/chat-ask-options` set is untouched.

Taken with `scripts/capture-evidence.mjs` against this worktree's Storybook
(`storybook dev -p 16016`), the two brand themes only:

    node scripts/capture-evidence.mjs http://127.0.0.1:16016 \
      --only=chat-ask-options \
      --dirs=secret-ask,secret-ask-typed,secret-answer-in-flight \
      --themes=localOperatorDark,localOperatorLight --allow-backend

`--allow-backend` was needed because the operator's own backend answers on
`localhost:1111` here; the docked-card stories render from fixtures and make no
request, which is what that flag states.

| file | state |
| --- | --- |
| `frames/secret-ask--<theme>.webp` | the empty field: placeholder, reassurance line, Send disabled |
| `frames/secret-ask-typed--<theme>.webp` | the mask mid-entry (`Input.insertText`); Send enabled |
| `frames/secret-answer-in-flight--<theme>.webp` | mid-submit: "Sending your answer..." + field and Send refused |

The `secret-ask-typed` entry carries a shutter-time claim (`expectAttribute`
`type="password"`), and `secret-answer-in-flight` one that the field is present,
so a frame cannot ship under either name with the wrong surface.
