# Output artifact rendering — real app frames

The desktop half of the output-attachment evidence (harness PR:
`damianvtran/local-operator#2076`). The frames are the real built app
photographing itself (`webContents.capturePage()`) in `headless` mode over a
REAL isolated backend seeded with a session carrying an artifact row plus both
legacy image shapes — driven by the `output-artifact` scene this branch adds to
`scripts/renderer-driver.mjs`.

## The run

```sh
# from this repo, against an isolated daemon the run owns (see the scene's doc):
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/renderer-driver.mjs \
  --scene output-artifact --session a77ac41f0001 \
  --backend http://127.0.0.1:8080 --seed-onboarding-complete --out <dir>
```

The build the run drives must have been built against the same URL
(`LOCAL_OPERATOR_UI_NO_BYTECODE=true VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 pnpm build`);
the scene refuses otherwise.

## Readings (verbatim from the run)

```
[PASS] the artifact picture decoded at its real 640x360 size from a store fetch (blob:)
[PASS] the externalised legacy picture decoded too (a digest reference, the route images always used)
[PASS] the sub-floor legacy picture decoded straight from its inline data: URL
[PASS] every picture decodes again after a renderer reload
[PASS] the artifact is STILL a store fetch after the reload (the durable row, not a cached object URL)
[PASS] no process from this run outlived its boot
ALL CHECKS PASSED
```

`artifact-inline.png` — the transcript with the artifact under the settled
tool row and both legacy images around it. `artifact-after-reload.png` — the
same session after `Page.reload`, every picture decoded again from the daemon's
history route. The seed (a real session written through the harness's own
`cache_media` + `Transcript.append_message`) is reproducible from
`damianvtran/local-operator:docs/evidence/output-attachments/seed_output_artifact.py`.
