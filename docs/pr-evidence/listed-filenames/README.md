# Bare filenames listed under an introducing directory: before/after

Operator report (2026-10-27): an assistant turn ended

```
Files are in `~/Documents/Radient/`:
- Radient-IP-Scope-for-Counsel-2026-10-27.pdf
- Radient-IP-Scope-for-Counsel-2026-10-27 (editable).docx
```

and only the directory linked. The two deliverables were dead text.

The rule this PR adds: a listed name links only when the disk says
`<dir>/<name>` EXISTS. That holds for a whole item and for the head of an
annotated item (`<name> — <description>`). A name that is missing, unknown, or
a sentence stays plain text. Round 1 of review (F1/Q1) found that whole items
skipped that check, so the negative states below are part of the proof
(round 1, F4).

## What is photographed

The BUILT app was captured three times, once per tree, and every tree was built
the same way:
`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080` plus synthetic OAuth
placeholders, then `pnpm build`.

The trees:
- `before-*` is `origin/main` at `1a535a371c`.
- `round1-*` is the reviewed head `a895cf571b`, the defect review round 1 found.
- `after-*` is this branch at the remediation commit `ccffb32bd3`.

All three ran `capture.mjs` against the SAME isolated `local-operator serve`
(v0.90.19) on `127.0.0.1:8080`, with the SAME seeded sessions and fixture files.
The daemon had scratch HOME/config, `hosting: test`, `model_name: mock-model`, a
synthetic bearer and CMUX_*/LOP_* stripped. An unauthenticated request got
`401`. The app ran headless (`window-mode=headless`, never shown, never
focused), and one launch per tree photographed every session.

`seed.mjs` writes the sessions and these fixture files:
- `present/` holds both deliverables, plus `parse.ts`.
- `partial/` holds only the PDF.

No operator session was touched.

| Session | Text | `before` (1a535a371c) | `round1` (a895cf571b) | `after` (this branch) |
| --- | --- | --- | --- | --- |
| `final` | the reported message, `present/` | plain, plain | linked, linked | **linked, linked** |
| `screenshot-1227` | item 2 is `<name> — <description>` | plain, plain | linked, linked (head only) | **linked, linked (head only; description plain)** |
| `missing` | the reported message, `partial/` (no `.docx` on disk) | plain, plain | linked, **linked (dead link, Q1)** | **linked, plain** |
| `sentence` | `Changes in <present>/:` + `- Fixed the parser in parse.ts` + `- I wrote <pdf>` | plain, plain | **linked, linked (F1)** | **plain, plain** |

Each reading comes from the rig's own DOM read (`report-<label>.json`, `listItems[].linked`).
It is taken once six consecutive reads 500 ms apart agree, so the disk probe has landed.

| Frame pair | Shows |
| --- | --- |
| `before-final.png` / `after-final.png` | the operator's reported message: both deliverables become links |
| `before-screenshot-1227.png` / `after-screenshot-1227.png` | annotated form: only the name is the anchor |
| `round1-missing.png` / `after-missing.png` | a listed file that is NOT on disk: dead link before the fix, plain text after |
| `round1-sentence.png` / `after-sentence.png` | sentence items: linked as filenames before the fix, plain text after |
| `before-missing.png`, `before-sentence.png` | `origin/main` control for the two negatives (plain, as expected) |

## Round 2 (review R2-1): a cached "missing" must not suppress a link forever

The round-1 fix sent every listed name through the probe cache, and a NEGATIVE
was cached for the session's lifetime. So an agent that writes
`I'll write the deliverables to <dir>/:` + names BEFORE its tool runs poisoned
the final report that lists the same names after the files exist: both messages
stayed plain forever, and plain text has no failed click to evict the entry.

The fix is keyed on the DOCUMENT, not on a clock: the first pre-scan of a NEW
message re-asks the spellings it names that are cached as missing
(`claimFirstScan` in `link-actions.ts`, passed as `probeTargets`'s
`recheckMissing`). A remount of the same message re-asks nothing, an "exists"
answer is never re-asked, and the in-flight set still dedupes two documents
painting in one frame. The landing answer re-renders the earlier row through
`subscribeProbes`, so A and B link together.

`round2-r2-1-before.png` is message A painted before the files exist: both
names plain. The rig then writes `report.pdf` and `data.xlsx` and appends
message B to the same session. `round2-r2-1-after.png` is the result: four
anchors, both names in BOTH messages. `report-r2.json` is the rig's own DOM
read (`before[].anchor` null, `after[].anchor` set), taken once six consecutive
reads 500 ms apart agree.

### Reproduce the round-2 frame

Same isolated daemon as above (steps 1-2, with `pnpm build` run at THIS commit).
Then, with `$EV` the scratch directory and `<tree>` the worktree:

```bash
# 3. Seed ONE session whose directory does not exist yet, and capture A -> write -> B.
node docs/pr-evidence/listed-filenames/seed-r2.mjs "$EV/iso/config" "$EV/fx/final" 5eed1157aa04
(cd <tree> && LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  node docs/pr-evidence/listed-filenames/capture-r2.mjs \
    http://127.0.0.1:8080 "$EV/iso/config" "$EV/fx/final" 5eed1157aa04 "$EV/frames" r2)

kill "$BPID"
```

`capture-r2.mjs` is one launch-capture-kill command: it photographs A, writes
the two files, appends B, re-enters the route (the driver's `navigate` is a
no-op on an unchanged hash, hence the detour through `/`), and photographs the
pair. It writes `report-r2.json` to its output directory; the frames land in
the driver's scratch `frames/` directory, named by the report.

## Reproduce

These are the exact commands, run from a `local-operator-ui` worktree. `<tree>` is a
worktree at the commit under test, and `$EV` is a scratch directory.

```bash
# 1. Build the tree against the rig's port (the renderer inlines the URL; CSP allows 8080).
VITE_GOOGLE_CLIENT_ID=synthetic VITE_GOOGLE_CLIENT_SECRET=synthetic \
VITE_MICROSOFT_CLIENT_ID=synthetic VITE_MICROSOFT_TENANT_ID=synthetic \
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 pnpm build

# 2. Isolated daemon, seeded with synthetic sessions.
mkdir -p "$EV/iso/home" "$EV/iso/config"
printf 'values:\n  hosting: test\n  model_name: mock-model\n' > "$EV/iso/config/config.yml"
SESSIONS=$(node docs/pr-evidence/listed-filenames/seed.mjs "$EV/iso/config" "$EV/fx")
TOKEN=$(openssl rand -hex 32)
env -u LOCAL_OPERATOR_SCRATCHPAD HOME="$EV/iso/home" LOCAL_OPERATOR_CONFIG_DIR="$EV/iso/config" \
  LOCAL_OPERATOR_HOME="$EV/iso/home" LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  local-operator serve --host 127.0.0.1 --port 8080 --hosting test --model mock-model &
BPID=$!

# 3. Launch, read and capture every session, then reap, in ONE command per tree.
(cd <tree> && LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  node <this dir>/capture.mjs http://127.0.0.1:8080 "$SESSIONS" "$EV/frames" <label>)

kill "$BPID"
```

`capture.mjs` writes `report-<label>.json` to its output directory. The frames
land in the driver's scratch `frames/` directory, and the report names each
path.

## What it does NOT show: the canvas Files list

`after-files-panel-backend-ledger.png` reads `files 0`. That is not this change
failing.

On a daemon that advertises `session_files` (`local_operator/server/features.py`),
the canvas list is the BACKEND's ledger: `chat-content.tsx` sets
`allowLegacyFiles = !session_files`. The ledger's half of this rule is the
in-flight core PR damianvtran/local-operator#3041.

The renderer scan this PR extends (`mentioned-files.ts`) is the fallback for
older daemons. It has no oracle, so it admits only a whitespace-free
known-extension listed name. `scripts/link-targets.test.mjs` covers it
(`extractMentionedPaths`), but no frame here does.
