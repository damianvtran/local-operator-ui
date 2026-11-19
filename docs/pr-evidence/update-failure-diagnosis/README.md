# The update failure modal: cause, remedy, and the record (2026-10-24)

The incident: the server update to 0.89.0 failed with exit 1 on 2026-10-24, and
the modal showed the two startup advisories from the updater's stderr instead of
the cause. The cause was `fresh PyPI latest is 0.88.4, not 0.89.0; retry lop
update` on line 6. `installDiagnosisLines` takes the head of the stream and
slices it at 800 characters; the two advisories measured 355 and 427, so the
head was spent before the verdict arrived.

The panel is now one failure block: a step label, the cause in plain language,
one action per kind, and the installer's output behind a collapsed disclosure.
The primary block paraphrases the cause; the raw record keeps the updater's
exact sentence, including the verdict, for the reader who opens it.

| Frame | What it shows |
| --- | --- |
| `publication-en-collapsed.webp` | The publication failure at 1280x900. Cause: "Version 0.89.0 is not on PyPI yet." Remedy: the release is still publishing. The raw record is collapsed. |
| `publication-en-expanded.webp` | The same frame with `Installer output:` open and the record parked at its end: the updater's exact verdict ("fresh PyPI latest is 0.88.4, not 0.89.0; retry lop update") is visible. The primary block is a paraphrase, so this is the record, not a duplicate on screen. |
| `publication-es-collapsed.webp` | The same failure in Spanish, every clause from the `es` catalogue: "Paso de publicación", "La versión 0.89.0 aún no está en PyPI.", the Spanish remedy and consequence. |
| `publication-es-expanded.webp` | The Spanish frame with the raw record open at its end; the updater's exact sentence is visible there. |
| `serve-en-collapsed.webp` | The install landed and the server did not move. The heading says the state, the cause names 0.88.4, the consequence is suppressed, and the primary control is **Restart the server** - not a repeat install. |
| `unknown-en-collapsed.webp` | An unclassified failure. The fallback is read once as the primary line, says the updater named no cause, and points at the record. |
| `legacy-en-collapsed.webp` | An older backend with no `failure` block: the pre-change sentence renders byte-for-byte (pinned by `scripts/update-robustness.test.mjs`), with the raw record collapsed. |
| `publication-en-narrow.webp` | The publication failure at a 320x568 viewport. The card's `w-100 max-w-[calc(100vw-2rem)]` narrows to 288px; the step, cause, remedy and actions wrap without clipping. |

## How they were captured

All frames come from the repo's own rig against Storybook on `:6017`, at the
viewport in the table (1280x900, or 320x568 for the narrow row), theme
`localOperatorDark`:

```sh
printf 'VITE_LOCAL_OPERATOR_API_URL=http://localhost:19999\n' > .env
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=backend-update-failed --themes=localOperatorDark
rm -f .env
```

The temporary `.env` points the rig's live-backend guard at a free port; the
operator's server was live on `:1111`. The story never reaches a backend - its
`window.api.updater` bridge is the fixture's - so the guard's concern does not
apply. The Spanish frames are the same story with the preview's `locale: es`
global (`BackendUpdateFailedPublicationEs`). The narrow row is
`BackendUpdateFailedPublicationNarrow` at 320x568.

The two expanded frames come from the same rig, with two capture-row options:
`press` opens the disclosure and `scrollToEnd: "pre"` parks the record at its
last line, so the frame shows the verdict the reader expands it to find. They are
distinct capture rows (`backend-update-failed-publication-expanded` and
`...-es-expanded`) so the collapsed frames keep their own names. The rows also
assert the verdict is in the page's text, which catches a fixture that stops
sending it.

The report in the story fixture carries the incident's facts, not a live
server's: `step: publish`, `kind: publication`, target 0.89.0, install 0.88.4.
