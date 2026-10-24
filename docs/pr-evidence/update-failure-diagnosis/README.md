# The update failure modal, before and after the structured cause (2026-10-24)

The incident: the server update to 0.89.0 failed with exit 1 on 2026-10-24, and
the modal showed the two startup advisories from the updater's stderr instead of
the cause. The cause was `fresh PyPI latest is 0.88.4, not 0.89.0; retry lop
update` on line 6. `installDiagnosisLines` takes the head of the stream and
slices it at 800 characters; the two advisories measured 355 and 427, so the
head was spent before the verdict arrived.

| Frame | What it shows |
| --- | --- |
| `before-publication-failure.webp` | Today's sentence and the raw output block: the panel says the update did not install, the install still reports 0.88.4, and the installer's output is below - with no cause anywhere. The output block carries the two advisories. |
| `after-publication-failure.webp` | The same failure with the report's `failure` block: the sentence names the publish step, quotes the updater's own line, gives the publication remedy ("try again in a few minutes"), and the raw output stays below as the fallback record. |

## How they were captured

Both are the same Storybook story,
`common-updatenotification--backend-update-failed-publication`, at
`1280x900`, theme `localOperatorDark`, through the repo's own rig:

```sh
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=backend-update-failed-publication --themes=localOperatorDark
```

The `before` frame was taken from the fixture's **older-backend path**: the same
story driven with `message` and `installerOutput` but no `failure` block, which
is the shape every backend that predates the contract sends. That path is pinned
byte-for-byte to `main`'s sentence by
`scripts/update-robustness.test.mjs` ("a structured failure names the cause...").
The `after` frame carries the `failure` block with the measured facts
(`step: publish`, `kind: publication`, `exit_code: 1`).

The capture ran against Storybook on `:6017`. The rig refuses to shoot while a
Local Operator backend answers on its configured origin (the operator's server
was live on `:1111`); the guard was pointed at a free port with a temporary
worktree `.env` (`VITE_LOCAL_OPERATOR_API_URL=http://localhost:19999`), removed
after the run. This story never reaches a backend - its `window.api.updater`
bridge is the fixture's - so the guard's concern (a frame showing a live
server's replies) did not apply.

The frames live here rather than in `docs/evidence-frames` because that tree is
ignored rig output; these two are the PR's before/after pair.
