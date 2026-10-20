# The Library panel's conversation line, against a real backend

The details panel renders a conversation reference from
`asset.occurrences[0].session_title`. The operator's report (2026-10-20) was
that line reading the session's **opening user message** — "From Can you review
Victor's message in non-urgent-tech-support, and delegate to a minervadev
team…" — where the conversation's generated name belonged.

These frames are the end-to-end proof, over the real app and a real daemon, for
both arms:

| arm | harness source | conversation line |
| --- | --- | --- |
| before | `ab58506ec4` (`INDEX_SCHEMA` 3, `title = snapshot.scan.title or title`) | `From Can you review Victor's message in non-urgent-tech-support, and delegate to a minervadev team to draft the reply?` |
| after | `76d6efa226` (merge of `fix/library-occurrence-title`, head `5f40bda815`) | `From Victor support reply triage` |

Both arms run the SAME seeded config root, the SAME UI build and the SAME scene
bytes. The only variable is the daemon's source tree.

The four PNGs are NOT committed: the capture copies them from the rig's
`$RIG/frames` into the ignored
`docs/evidence-frames/library-tab-live/<theme>/{before,after}.png` tree. The two
proof JSONs and this README stay tracked, so a fresh checkout has the readings
but no pictures until the capture is re-run.

## Frames

| file | what it shows |
| --- | --- |
| `dark/before.png` | the panel at `127.0.0.1:18234`, base daemon: the conversation line is the opening message |
| `dark/after.png` | the same panel and payload shape, fixed daemon: the line is the stored generated title |
| `light/before.png`, `light/after.png` | the same pair in the light palette |

The two `library-panel-{before,after}.json` files are written BY the scene, not
copied by hand: each holds the request status, the asset and session ids, the
`occurrences[0]` payload, the `title.json` sidecar, the transcript's opening
message, and the DOM reading per theme. No bearer appears in either file.

## What the scene asserts (all three surfaces read independently)

The scene (`--scene library-asset` in `scripts/renderer-driver.mjs`) reads:

1. the **title sidecar** `sessions/<id>/title.json` on disk — what the naming
   process writes (`resume.write_session_title(..., user_set=False)`);
2. the **daemon's payloads** — `library.list` and `library.get`, over HTTP;
3. the **DOM** — the real app's `From <title>` link in
   `[data-library-preview="<asset id>"]`.

It derives the opening message from the seeded transcript itself, so it knows no
fixture strings and the same bytes are meaningful on both arms.

Actual output, fixed daemon (the run's own stdout, 19 PASS / 0 FAIL):

```
[PASS] the session's title sidecar is a GENERATED name (user_set false), not an opening line
        "Victor support reply triage" user_set=false
[PASS] library.list's occurrence carries the STORED title, not the opening message
        occurrences[0].session_title="Victor support reply triage"
[PASS] library.get agrees with the listing on the same stored title
        status=200 occurrences[0].session_title="Victor support reply triage"
[PASS] the conversation line reads "From Victor support reply triage" (localOperatorDark)
        "From Victor support reply triage"
[PASS] the conversation line does NOT repeat the opening message (localOperatorDark)
[PASS] the conversation line reads "From Victor support reply triage" (localOperatorLight)
[PASS] the conversation line does NOT repeat the opening message (localOperatorLight)
```

Actual output, base daemon (the same scene and build, 13 PASS / 6 FAIL — the six
FAILs are the discriminating checks, and only those):

```
[FAIL] library.list's occurrence carries the STORED title, not the opening message
        occurrences[0].session_title="Can you review Victor's message in non-urgent-tech-support, and delegate to a minervadev team to draft the reply?"; title.json="Victor support reply triage"
[FAIL] library.get agrees with the listing on the same stored title
        status=200 occurrences[0].session_title="Can you review Victor's message in non-urgent-tech-support, and delegate to a minervadev team to draft the reply?"; title.json="Victor support reply triage"
[FAIL] the conversation line reads "From Victor support reply triage" (localOperatorDark)
        the line read "From Can you review Victor's message in non-urgent-tech-support, and delegate to a minervadev team to draft the reply?"
[FAIL] the conversation line does NOT repeat the opening message (localOperatorDark)
        the preview carried the opening message's first 60 chars: "Can you review Victor's message in non-urgent-tech-support, "
[FAIL] the conversation line reads "From Victor support reply triage" (localOperatorLight)
        the line read "From Can you review Victor's message in non-urgent-tech-support, and delegate to a minervadev team to draft the reply?"
[FAIL] the conversation line does NOT repeat the opening message (localOperatorLight)
        the preview carried the opening message's first 60 chars: "Can you review Victor's message in non-urgent-tech-support, "
```

Every harness check outside the payload/DOM claim passes on both arms (headless
window, Electron pin, isolated scratch, connection to the run's own backend and
none to the operator's `1111`), so the FAILs are the harness behaviour under
test and not a broken rig.

## The exact commands

Everything below ran on this machine, 2026-10-20, with an isolated `HOME` and
`LOCAL_OPERATOR_CONFIG_DIR` under the session scratchpad and `CMUX_*` stripped.
`$RIG` here is the scratch root (`…/library-tab-live-rig`); `$SRC` is a harness
checkout of the commit named in each arm; `$UI` is this UI worktree.

**1. Seed one session, one image asset, one generated title.** `seed.py` (in
this directory) imports the transcript row shapes from the harness's own
`tests/unit/library/_fixtures.py` and registers the image through
`cache_media`, the same store call a real `generate_image` result uses.

```sh
mkdir -p "$RIG/config" "$RIG/home"
printf 'values:\n  hosting: test\n  model_name: mock-model\n' > "$RIG/config/config.yml"
LO_SOURCE="$SRC" LOCAL_OPERATOR_CONFIG_DIR="$RIG/config" HOME="$RIG/home" \
  ~/local-operator/.venv/bin/python "$RIG/seed.py"
```

Seeded data (printed by the script):

```json
{
 "session_id": "b1a5e7c0d2f4",
 "digest": "a36061116ef78c9f1e0b540c84679195",
 "opening": "Can you review Victor's message in non-urgent-tech-support, and delegate to a minervadev team to draft the reply?",
 "generated_title": "Victor support reply triage",
 "stored_title_read_back": "Victor support reply triage"
}
```

The sidecar is exactly what the naming process writes:

```json
{"text": "Victor support reply triage", "user_set": false, "names": ["Victor support reply triage"]}
```

**2. Serve the isolated daemon.** `run_source.py` runs a harness SOURCE tree on
the shared editable venv: that venv's `__editable__..._finder` outranks
`PYTHONPATH` (measured), so the bootstrap drops the finder, puts the source tree
at `sys.path[0]`, and refuses to start if the wrong tree resolved.

```sh
LO_SOURCE="$SRC" LOCAL_OPERATOR_CONFIG_DIR="$RIG/config" HOME="$RIG/home" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  ~/local-operator/.venv/bin/python "$RIG/run_source.py" serve \
  --host 127.0.0.1 --port 18234 --hosting test --model mock-model
```

Port 18234 is deliberate: `127.0.0.1:1111` is the operator's own daemon and
`8080` was another session's. The app's transport is MAIN's over IPC and the
driver widens `img-src`/`frame-src`/`media-src` in the gitignored build output
(`docs/agent-driver.md`, and the driver's `mentions` note measures a rig on a
port the page policy does not name), so a dedicated free port is reachable and
reproducible; no `src/` file is touched.

**3. Build the renderer against that URL.** The build needs the four OAuth
values (`scripts/vite-plugins/replace-backend-config.ts` throws without them),
supplied as placeholders in the gitignored `.env`; the PostHog pair is left
unset so the schema's defaults apply (an EMPTY `VITE_PUBLIC_POSTHOG_HOST` fails
its `.url()` check and the renderer refuses to boot).

```sh
cd "$UI"
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18234 pnpm build
```

The shared `node_modules` needed the one link the driver's own note documents
for a cloned tree, or `electron-vite` dies in its bytecode step:

```sh
ln -sfn ../.pnpm/node_modules/@babel/plugin-transform-arrow-functions \
  node_modules/@babel/plugin-transform-arrow-functions
```

**4. Drive the real app.** Same command for both arms; only the daemon differs.

```sh
cd "$UI"
HOME="$RIG/home" TMPDIR="$RIG/tmp" LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  node scripts/renderer-driver.mjs --scene library-asset \
  --backend http://127.0.0.1:18234 \
  --backend-records "$RIG/config/run/serve" \
  --seed-onboarding-complete \
  --out "$RIG/frames"
```

The scene is reusable rather than a one-off: it takes any daemon this run owns
and the one asset in its listing (`--asset <id>` when a rig seeds several),
derives the subject's title and opening message from the config root
`--backend-records` names, and asserts the API and the DOM against them.

## What these frames prove, and what they do NOT

**Proves.** For a session whose `title.json` holds a generated name
(`user_set: false`), the fixed harness publishes that name in
`occurrences[0].session_title` on both the list and the detail route, and the
built app's details panel renders it; the base commit publishes the transcript's
first user message in the same field and the panel renders that instead. The
pair is one rendering replaced by another over one seeded store, not two
fixtures.

**Does not prove.** That the naming process RAN. The sidecar is written by the
harness's own writer (`resume.write_session_title`) with `user_set=False`, which
exercises the stored-title path and says nothing about the model call that would
have produced a name in a live session. It does not prove rename-after-index
refresh either — that is the harness's `rename` case, covered by
`tests/unit/library/test_index.py`; this set is the cross-repo rendering claim
only. Loading, empty and error states of the panel are not this claim and belong
to the Library UI's own evidence.

**Environment.** Isolated `HOME`/`LOCAL_OPERATOR_CONFIG_DIR`; synthetic session
id `b1a5e7c0d2f4`; a generated 8×6 PNG (hence the black preview thumbnail); no
operator config, daemon or data touched. Both daemons were started and stopped
by the run's own process group, and the driver's closing check
(`no process from this run outlived its boot`) passed on both arms.
