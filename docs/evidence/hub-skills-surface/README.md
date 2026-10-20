# Hub Skills surface — independent QA pass

Independent real-path QA of the Hub Skills surface across three surfaces that
must agree: the **built Electron app** (`damianvtran/local-operator-ui` #1269),
the **real core** (`local-operator` #2711 + #2713), and a **stub hub** serving
real HTTP. Every claim in the matrix below was produced by running the command
shown; the commands' actual answers are in `receipts/`. The frames are rig
output: they live in the ignored `docs/evidence-frames/` tree, not here, because
the repository's structure gate refuses a committed frame (see
`scripts/check-evidence-structure.mjs`). Their filenames are named in the tables
below so a captured checkout can be read beside this record.

Run: 2026-10-20, on the operator's machine, one reviewer session.

## Verdict at a glance

| # | Surface / state | Verdict |
|---|---|---|
| 1 | Skills tab beside Agents and Teams; cards from the hub | **PASS** |
| 2 | Card opens the detail: description, files, revision | **PASS** (local path absent for the stated reason — no copy) |
| 3 | Download creates the local copy | **BLOCKED in the app** (signed out); **PASS at the HTTP boundary** with the source spelling the core requires |
| 4 | Subscribe without pulling leaves no files on disk | **PASS at the HTTP boundary**; BLOCKED in the app |
| 5 | Waiting update is distinct from applied; applying updates the copy | **PASS at the HTTP boundary**; BLOCKED in the app |
| 6 | Forced failure shows a retryable failure that succeeds on retry | **PASS at the HTTP boundary**; BLOCKED in the app |
| 7 | Unsubscribe keeps files; unpull removes them but keeps the link | **PASS at the HTTP boundary**; BLOCKED in the app |
| 8 | Private-scope negatives | **PARTIAL** — public-list absence and the identical 404 proven; an *authenticated non-member* 404 is not drivable here |
| 9 | Dark path: a core without `hub_skills` | **PASS** |

**One release-blocking cross-repo finding (F1)** is described under Findings: the
app sends a `hub_source` the core refuses, so a *signed-in* Download would fail
with `origin-conflict`. The core's own behaviour is correct and is demonstrated
with the versioned spelling.

## Environment

| Piece | Identity |
|---|---|
| Core | `qa/hub-skills-integration-r2` @ `903b523e5a` = #2711 `ab0d17ba72` + #2713 `9432b6c261`; `/health` says `0.73.16`, `install_kind: editable`; `/v1/capabilities` advertises `hub_skills: 1` |
| Core config | `values.radient_base_url: http://127.0.0.1:8127` (so its approved hub root is `http://127.0.0.1:8127/v1`) |
| UI | worktree `hub-skills-state` @ `69f40fee2e` (= PR #1269 head), built `out/`, `node_modules` symlinked to the primary checkout |
| Hub stub | `harness/stub-hub.mjs` on `127.0.0.1:8127` — valid SKILL.md frontmatter, revision bump, failure injection |
| App launch | `scripts/renderer-driver.mjs` exports via `scripts/hub-skills-surface.mjs`; Electron `--window-mode=headless`, `LOCAL_OPERATOR_DESKTOP_TOKEN=rig` |
| Viewport | requested 1380x900; measured renderer 1380x900 at DPR 2 → PNGs are 2760x1800 |
| Dark path core | installed `lop` 0.84.0, generation `20261020T154014Z-0.84.0`, isolated `HOME`, port 8132 |

### The integration core had to be rebuilt (F2)

The worktree handed over (`qa/hub-skills-integration`) was **not** a valid
integration: it still had `MERGE_HEAD`, unmerged index entries, and
`local_operator/hub_sync/service.py` contained conflict markers. The app booted,
but hub_sync was dead:

```
2026-10-20 14:14:22,993 [WARNING] local_operator.server: hub update runner could not start
  File ".../local_operator/hub_sync/service.py", line 3330
    >>>>>>> 9432b6c261c36f4a828d633d6fa06f8a97ba747f
SyntaxError: invalid decimal literal
```

It was rebuilt at `~/local-operator/.worktrees/hub-skills-qa-r2` (branch
`qa/hub-skills-integration-r2`). A clean three-way merge has exactly **one**
conflict in `service.py` and three in `desktop_hub.py`; every hunk's merge-base
segment is empty except the `typing` import line, so the faithful resolution is
the **union** of both sides plus a name-union import. The resolution was proved,
not assumed: of 714 distinct lines #2711 adds and 328 #2713 adds, **0 are
missing** from the resolved file (the only two "missing" lines are the two
import spellings, intentionally replaced by the union import), and both files
compile. This branch exists only to give QA a bootable core; it is not proposed
for merge.

## Reproduce

```sh
# hub stub
node docs/evidence/hub-skills-surface/harness/stub-hub.mjs --port 8127

# real core (from the integration worktree), isolated HOME
HOME=$S/core-home XDG_CONFIG_HOME=$S/core-home/.config \
LOCAL_OPERATOR_CONFIG_DIR=$S/core-home/.lop LOCAL_OPERATOR_DESKTOP_TOKEN=rig \
PYTHONPATH=. ~/local-operator/.venv/bin/python -m local_operator.cli serve --host 127.0.0.1 --port 8131

# the HTTP matrix (writes receipts/http-transcript.txt)
CORE=http://127.0.0.1:8131 HUB=http://127.0.0.1:8127 TOKEN=rig CFG=$S/core-home/.lop \
  sh docs/evidence/hub-skills-surface/harness/http-matrix.sh

# the app, against the real core
LOCAL_OPERATOR_DESKTOP_TOKEN=rig QA_BACKEND=http://127.0.0.1:8131 \
QA_FRAMES=$S/frames node scripts/hub-skills-surface.mjs

# the dark path, against installed 0.84.0
LOCAL_OPERATOR_DESKTOP_TOKEN=rig node scripts/renderer-driver.mjs --scene hub-skills \
  --skills-adapter-absent --skills-expect public \
  --backend http://127.0.0.1:8132 --backend-records $S/dark-home/.lop/run/serve \
  --out $S/frames-dark --theme localOperatorDark
```

**Build-output change, recorded because it is not source.** `out/renderer/index.html`
(gitignored) had its `connect-src` widened by `http://127.0.0.1:8127`; without it
the renderer refuses the stub with "Refused to connect because it violates the
document's Content Security Policy", and the library renders empty. No `src/`
file was touched (`git status` shows only `scripts/hub-skills-surface.mjs` and
`docs/evidence/hub-skills-surface/`).

## Matrix

### 1. Skills tab beside Agents and Teams, cards from the hub — PASS

Command: `node scripts/hub-skills-surface.mjs` against the real core.

```
tabs: ['Agents', 'Teams', 'Skills']
cards: 2
cardTexts: [
  "release-notesDraft release notes from a merged PR list.PublicNot downloaded",
  "transcript-auditAudit a transcript for policy contradictions.PublicNot downloaded"
]
sourceLine: "Public"
```

Name, description and an **honest source line** ("Public" — the row carries no
publisher, and the UI says so rather than inventing one) all render.
Frame: `frames/02-cards-from-stub-hub.png`.

### 2. Detail — PASS (local path correctly absent)

```
detail.description: "Draft release notes from a merged PR list."
detail.alias: "release-notes"
detail.fileSummaries: ["SKILL.md", "references/notes.md", "scripts/run.sh"]
detail.localPath: null
panel: "Not downloaded · Remote revision: 1 · \"rev-pub-1\""
```

Description, reference/script file list and the opaque revision all render.
`localPath` is null because no copy exists — the task's "after a pull" clause is
covered by row 3, which the signed-out app cannot drive.

### 3–7. Copy lifecycle — BLOCKED in the app, PASS at the HTTP boundary

**Why blocked in the app.** The Download and Subscribe controls require an
account, and there is no signed-in Radient account on this machine:

```
download: { present: true, disabled: true, label: "Download once" }
subscribeButton: { present: true, disabled: true }
noCredentialSentence: "Sign in to the hub before trying this action."
```

Source: `hub-skills-library.tsx` — `disabled={!signedIn || !ready || ...}`. So
every pull/subscribe/unpull UI flow is **BLOCKED** on an access limit, not
inferred. It is also why no UI frame shows a downloaded, subscribed, waiting or
failed row: those states cannot be reached signed out. Frame:
`frames/04-download-subscribe-gated-signed-out.png`.

**What the core actually does** (`receipts/http-transcript.txt`). Each case below
is a real request against the real core with the stub hub.

| Case | Request | Actual answer |
|---|---|---|
| 3 | `POST /v1/desktop/hub/skills/pull`, `hub_source: …:8127/v1` | `200`, `content_state: "present"`, `local_path: …/skills/transcript-audit`; three files on disk (`SKILL.md`, `references/notes.md`, `scripts/run.sh`) |
| 4 | `POST …/subscribe`, same versioned source | `200`, `"content_state":"absent"`, `"local_path":null`, `"baseline_state":"subscribe"`, `eligibility.reason: "content-absent"`; **`config_dir/skills` did not exist at all** after the write |
| 5 | bump stub → `content_revision 2`; `POST …/updates/check` then `…/updates/apply` | check: `state: "available"`, `classification: "remote-only"`; apply: `outcome: "merged"`, `applied: true`; `SKILL.md` then ends `Body at content revision 2 (the stub was bumped).` |
| 6 | stub answers `500` to the next detail read; `…/updates/check`; then clear and `…/updates/retry` | check: `outcome: "unavailable"`, `error_class: "hub-error"`, `last_error: "could not reach the hub: Could not pull the skill from the Radient Agent Hub (HTTP 500)"`, `next_retry_at` set; retry after clearing: `outcome: "merged"`/`"up-to-date"`, `error_class: null` |
| 7 | `PATCH /v1/desktop/hub/links/{id}` `subscribe:false` → files listed → `POST …/skills/unpull` | unsubscribe `200`, `subscribe:false`, files still present; unpull `200`, `content_state: "absent"`, `local_path: null`, `subscribe: false` **retained**, `baseline_state: "merge-pull"` retained, directory gone |

Two behaviours worth naming:

* **One remote skill is one local link.** Pulling `skill-release-notes` under a
  second alias was refused: `origin-conflict / this skill is already linked as
  'release-notes'`. Correct, and observed.
* **The policy PATCH is revision-guarded.** The scripted run's first PATCH
  answered `409 policy-revision-changed` because the background runner rewrote
  the baseline between the read and the write; the documented reload-and-retry
  then returned `200`. Five serialized read→write cycles returned `200` five
  times, so this is the CAS working, not a write that refuses.

### 8. Private-scope negatives — PARTIAL

```
public list ids: ['skill-release-notes', 'skill-transcript-audit']   # org row absent
GET /v1/skills/skill-org-playbook    -> {"msg":"not found"} 404
GET /v1/skills/skill-no-such-id      -> {"msg":"not found"} 404   # byte-identical
POST …/subscribe visibility=org      -> 401 "organization operations need a signed-in Radient account. Run `lop login radient`."
POST …/pull      visibility=org      -> 401 (same)
links after both attempts: [('skill','release-notes'), ('skill','transcript-audit')]
config_dir/skills/org-playbook: does not exist
POST /v1/desktop/radient {"operation":"org_skills.list","payload":{}} -> 422
```

What this proves: an org row is absent from the public list, its detail is
**indistinguishable** from a nonexistent id, no link or local baseline is created
by the attempts, and `org_skills.list` without a tenant is refused before any
read.

What it does **not** prove, and I am not claiming: the task's "an unauthenticated
**outsider** gets 404" case needs a **signed-in non-member**. With no account at
all the core refuses at the credential step (401) before it ever asks the hub, so
the 404-for-foreign-row path was not exercised through the core. The identical
404s above are the *hub* boundary (my stub), which is the shape the core relies
on but not the core's own answer.

### 9. Dark path — PASS

Installed `lop` 0.84.0 on an isolated HOME, app pointed at it. The shipped scene
`--scene hub-skills --skills-adapter-absent --skills-expect public` passed all 16
checks, including:

```
[PASS] released-core fallback retains selected Agents and hides Skills entry/actions
[PASS] released-core fallback starts zero remote Skills list/detail queries
[PASS] fallback panel geometry is observable without horizontal overflow
[PASS] window mode is headless and the window is never shown or focused
[PASS] no process from this run outlived its boot
ALL CHECKS PASSED
```

The backend side, measured directly: `/v1/capabilities` has **no `hub_skills`**
(only `hub_updates:1`, `hub_links:1`); `POST /v1/desktop/hub/skills/subscribe`
answers **404** on 0.84.0 while `…/pull` exists (422 for an empty body) and
`…/links` answers 200. That is exactly the "backend that has the old pull but not
the new adapter" case: the app hides the entry and keeps Agents/Teams working.
Frame: `frames/09-dark-0840-no-skills-tab.png` (the "Connect an AI account"
dialog is the signed-out state on that isolated HOME; Agents and Teams are both
present and the Skills tab is not).

## Findings

### F1 — BLOCKER: the app sends a `hub_source` the core refuses

The app builds every skill request from `apiConfig.radientBaseUrl`, which is
`VITE_RADIENT_SERVER_BASE_URL` verbatim (`src/renderer/src/shared/config/api-config.ts:46`),
i.e. the **unversioned** origin (`https://api.radienthq.com` by default;
`http://127.0.0.1:8127` in this build). The core approves only
`configured_radient_base_url(...)`, which `normalize_radient_api_base_url`
**completes to `/v1`** (`local_operator/env.py:70-88`), and
`approve_source` compares the normalized paths exactly.

The result, with the exact body the hook composes
(`use-hub-skills.ts:169/209`):

```
POST /v1/desktop/hub/skills/subscribe {"hub_source":"http://127.0.0.1:8127", ...}
-> {"detail":{"code":"origin-conflict","message":"hub source is not configured or approved"}}  HTTP 422

POST /v1/desktop/hub/skills/pull      {"hub_source":"http://127.0.0.1:8127", ...}
-> {"detail":{"code":"origin-conflict","message":"hub source is not configured or approved"}}  HTTP 422
```

The same requests with `http://127.0.0.1:8127/v1` succeed (rows 3–7). The seam is
unpinned on both sides: the core's route tests use `BASE = "https://api.radienthq.com/v1"`
(`tests/unit/server/test_desktop_hub_skills.py:42`) while the UI has **no** test
asserting `hubSource` at all, and `desktop-contract.ts` declares it as a bare
`z.string().min(1).max(2048)`. Neither PR's suite spans the boundary, and each is
internally consistent.

This never showed up in the app during this pass only because Download is
disabled while signed out. A signed-in user pressing Download would hit it.
Not a defect in either PR's own logic; a defect in what they agree on. Fix at one
end (send the versioned base, or approve the unversioned one) **and pin it with a
test that runs both halves together**.

### F2 — The handed-over integration branch was unbuildable

See Environment above: unresolved merge + `SyntaxError`, while the app still
booted and advertised `hub_skills: 1`, because `features.py` is a static dict and
hub_sync is imported lazily. "It boots and advertises `hub_skills:1`" is true and
is not evidence that the adapter works.

### F3 — An updates row keeps a non-failed `state` with an error attached

After a failed check the row reads `state: "available"` (or `"applied"`) **with**
`error_class: "hub-error"`, `last_error` set and `next_retry_at` set; the
inventory's `counts.failed` stays `0` throughout. The UI compensates — its mark
logic is `update.state === "failed" || update.error_class`
(`hub-skills-library.tsx:139`) — so the user sees the failure. Not a user-visible
break, but any other consumer reading `state`/`counts.failed` will miss it.
Recorded, not scored as a blocker.

### F4 — The old rig's skill fixtures are not valid documents for the real core

`docs/evidence/hub-links/harness/stub-daemon.mjs` serves a SKILL.md with no YAML
frontmatter. The real core refuses it: `invalid-remote-manifest / the remote skill
manifest is invalid: SKILL.md requires strict YAML frontmatter`. That rig was
built when the *stub* was also the backend, so nothing ever parsed its payload as
a manifest. `harness/stub-hub.mjs` here emits frontmatter whose `name` and
`description` match the row exactly, which the core accepts. This is a gap in the
previous evidence, not a product defect.

## Frames

All captured by the app's own `capturePage` through the driver; viewport
1380x900, DPR 2 (PNG 2760x1800).

| File | Shows |
|---|---|
| `frames/01-tabs-skills-present.png` | Agent hub with **Agents / Teams / Skills**, Skills selected |
| `frames/02-cards-from-stub-hub.png` | two cards: name, description, "Public", "Not downloaded" |
| `frames/03-detail-description-files-version.png` | detail: description, revision `1 · "rev-pub-1"`, 3 files, alias |
| `frames/04-download-subscribe-gated-signed-out.png` | "Download once" and "Subscribe" **disabled**, "Sign in to the hub before trying this action." |
| `frames/09-dark-0840-no-skills-tab.png` | 0.84.0: Agents + Teams only, no Skills tab |

## Limitations

* **No signed-in account.** Rows 3–7 cannot be driven *in the app*: the controls
  are disabled by design while signed out. They are proved at the core's HTTP
  boundary instead, with the source spelling the core demands. Any claim about
  the UI's downloaded/subscribed/waiting/failed *rendering* is therefore absent
  from this pass — the earlier fixture rig (`hub-skills-library/`) covers that
  shape and is not a substitute for the real core.
* **Publication (#2711) was not exercised.** It needs an authored local skill;
  this matrix is about the browse/state surfaces. Not covered, not implied.
* **Org scope through the core.** No account means 401 before any hub read; an
  authenticated non-member's 404 was not reproducible here (row 8).
* **One build, no rebuild.** `out/` was already built at the PR head; only the
  gitignored CSP line changed. No dependency installs.
* **Driver scene noise.** `--scene hub-skills` against the real core reports two
  failures that belong to the fixture assumption, not the product: a "row press
  hit test" (the sign-in dialog) and "every renderer request went to the stub
  origin" (the backend here is 8131 by design). Its pull step correctly observed
  the gated control instead of a write. `receipts/driver-hub-skills-scene-real-core.txt`.

## Rig hygiene

* Hub stub, core, 0.84.0 core and every app boot were terminated by exact pid /
  job; final state has **no listener on 8127, 8131 or 8132** and no app process
  (`receipts/` records the runs; verified with `lsof` after teardown).
* No dependency installs, no second UI build, no browser engine, no
  `screencapture`.
* Product source untouched: `git status` in the UI worktree lists only
  `scripts/hub-skills-surface.mjs` and `docs/evidence/hub-skills-surface/`.

## Round 2 — F1 and F3 re-verification on the fix heads

Focused re-run after the two fix commits. The round-1 matrix above was **not**
re-run; only F1, F3 and the session guard were exercised.

### Build under test

| Piece | Identity |
|---|---|
| Integration | `qa/hub-skills-integration-r2` @ `f8ae74c561` — octopus merge of the round-1 integration `903b523e5a` with #2711 `b6dccc50d9` (`fix(hub): complete an unversioned hub source before approval`) and #2713 `d2caf06fc1` (`fix(hub): a carried error is failed in the updates projection`) |
| Delta from round 1 | `git diff 903b523e5a..f8ae74c561` is exactly the two fix commits: 9 files, +234/−5 (the F1 identity gate + route tests; the F3 projection + session-guard allow-list) |
| Core | worktree-owned `.venv` (Python 3.12.13, editable; `.venv/bin/python -c "import local_operator"` resolves to the worktree), `local-operator serve` on `127.0.0.1:8138` |
| Core config | isolated `HOME`/`LOCAL_OPERATOR_CONFIG_DIR`; `RADIENT_API_BASE_URL=http://127.0.0.1:8137` (unversioned, what the renderer composes); `RADIENT_ORG_ALLOW_NONCANONICAL_BASE=1`; synthetic desktop bearer (never printed); synthetic Radient OAuth row in the isolated `AuthStore` for the publish arm |
| Hub | purpose-built fake Radient hub on `127.0.0.1:8137`; real HTTP, per-skill revision/body/error state; logs Authorization **presence** only |
| Port note | `8127` was owned by a different session's live UI rig (`design1269/stub-states.mjs`), so the substitution is `8137`. The spelling under test is unchanged: a bare unversioned root, exactly what `VITE_RADIENT_SERVER_BASE_URL` composes |
| Session guard | worktree venv, not the shared venv |

### F1 — renderer-composed unversioned `hub_source`

| Request | ACTUAL output | Verdict |
|---|---|---|
| `POST /v1/desktop/hub/skills/pull` with `{"hub_id":"sk-pull","hub_source":"http://127.0.0.1:8137","visibility":"public","local_alias":"qa-pull",…}` | `HTTP 200`; `result.link.hub_source = "http://127.0.0.1:8137/v1"`; `result.link.name = "qa-pull"`; `reports[0] = {"outcome":"merged","applied":true,"direction":"pull"}`; `skills/qa-pull/SKILL.md` and `references/extra.md` written | **PASS** |
| `POST …/skills/subscribe` with the same unversioned source | `HTTP 200`; `result.link.hub_source = "http://127.0.0.1:8137/v1"`; `result.link.content_state = "absent"`; no `skills/qa-sub` directory | **PASS** |
| `POST …/skills/publish` dry run (configured base is the unversioned env value) | `HTTP 200`; `preview.hub_source = "http://127.0.0.1:8137/v1"`; `preview.can_confirm = true`; preview receipt issued | **PASS** |
| `POST …/skills/publish` confirm with the preview receipt | `HTTP 200`; `result.link.hub_source = "http://127.0.0.1:8137/v1"`; `local_link_receipt.state = "complete"`; `publication.revision = "\"hub-rev-pub-1\""`; fake-hub log records `POST /v1/skills/publish` `authorization_present:true`, `authorization_scheme:"Bearer"` | **PASS** |
| `POST …/skills/pull` with `hub_source":"http://127.0.0.1:9999"` | `HTTP 422`; `{"detail":{"code":"origin-conflict","message":"hub source is not configured or approved"}}`; hub call count unchanged (delta `0`) | **PASS** |

The F1 fix is the identity gate: `approve_source` now completes both sides with
`normalize_radient_api_base_url` only for a path-less root, then keeps the exact
equality check. A custom gateway path is untouched, host/scheme are never
rewritten, and a different origin still refuses nondisclosingly before any
network call.

### F3 — failed state, count, and retry

**Projection.** Forced skill failure (`POST …/updates/apply` with
`replace:"local"`, `confirm_replace:true` on a content-absent link):

```
-> HTTP 422 {"detail":"there is no local copy to keep: this link is subscribed without content"}
GET /v1/desktop/hub/updates
-> {"counts":{"available":0,"failed":1,"updating":0,"up-to-date":0,"applied":0},
    "items":[{"kind":"skill","name":"qa-f3","state":"failed","error_class":"merge-refused", …}]}
```

**PASS** — the row reports `state:"failed"` and is counted in `counts.failed`;
the old head reported `state:"available"` with `error_class` set and
`counts.failed:0`.

**Retry.** Forced hub failure on a subscribed skill (`sk-f3c` answers 404), then
cleared and retried:

```
POST /updates/check -> HTTP 200; report {"outcome":"unavailable","error_class":"hub-item-missing"}
GET /updates        -> counts.failed:1; qa-f3c {"state":"failed","error_class":"hub-item-missing"}
POST /updates/retry -> HTTP 200; report {"outcome":"skipped","error_class":null,"skipped_reason":"install-requires-pull"}
status in the retry answer -> counts.failed:0; qa-f3c {"state":"available","error_class":null}
GET /updates        -> counts.failed:0; qa-f3c {"state":"available","error_class":null}
```

**PASS** — retry clears a forced check failure and the count returns to zero.

### New finding — Q-R2-1 (minor): Retry cannot clear a `merge-refused` row whose content is absent

The same retry does **not** clear the `merge-refused` variant when the link's
content is absent and the remote is back at the subscribed revision:

```
POST /updates/retry {"kind":"skill","name":"qa-f3"}
-> HTTP 200; report {"outcome":"skipped","error_class":null,"skipped_reason":"install-requires-pull"}
   row still {"state":"failed","error_class":"merge-refused"}, counts.failed unchanged
```

Cause: a content-absent link's check reports `available`; the retry's unattended
apply is skipped as `install-requires-pull`; `clear_failure` is only called on a
`would-merge` outcome, and `apply_check` only clears
`hub-item-missing`/`no-credential` on an `available` verdict. A pull is the real
remedy and does clear it (verified: `POST …/skills/pull` for `qa-f3`, then a
check → row `up-to-date`, `error_class:null`). Not a release blocker; Retry is a
dead end for this row shape until Pull.

### Session guard (CI terms)

```
cd ~/local-operator/.worktrees/hub-skills-qa-r2
.venv/bin/python -m pytest tests/unit/session/test_no_session_deletion.py -q
-> 468 passed, 30 warnings in 36.93s
```

Focused fix coverage on the same head:

```
.venv/bin/python -m pytest tests/unit/hub_sync/test_identity.py \
  tests/unit/hub_sync/test_skill_state.py \
  tests/unit/server/test_desktop_hub_skills.py \
  tests/unit/server/test_desktop_hub_skill_publish.py \
  tests/unit/server/test_desktop_hub.py -q
-> 136 passed, 117 warnings in 3.75s
```

### Limits

* The real-cloud Radient hub was not used. The publish credential was a
  synthetic OAuth row in the isolated store; the hub was local. No production
  data or operator credential was read or sent.
* No signed-in account, so the app's Download/Subscribe controls remain disabled
  and no new UI frames were captured. The F1 fix is core-side; the round-1
  screenshots and design/UX evidence still apply.
* Private-scope row 8 stays **PARTIAL** for the reason given in round 1: an
  authenticated non-member's 404 needs a real signed-in non-member, which this
  machine does not have. The identical public/hub 404s are not that answer.
* The round-1 matrix's rows 1–2, 5, 7, 8 and 9 were not re-run; the session-guard
  file was run once on the new head.

### Rig hygiene

* The fake hub (`pid 43192`) was terminated by exact pid; the core job
  (`pid 41487`, job `23d6a489fd0b`) had already exited and its job group was
  reaped. No listener remains on 8137 or 8138 from this rig (verified with
  `lsof`).
* Only the worktree's own `.venv` was created; no dependency installs into a
  scratchpad, no browser engine, no `screencapture`.
* `~/local-operator` (shared checkout) was not written: the integration work
  happened in `~/local-operator/.worktrees/hub-skills-qa-r2`, and this README is
  in the UI worktree already listed as untracked evidence.

### Posted to the PRs

The core matrix was posted as `### QA report — round 1` on both core PRs:

* https://github.com/damianvtran/local-operator/pull/2711#issuecomment-6298595389
* https://github.com/damianvtran/local-operator/pull/2713#issuecomment-6298595981

The app matrix, with the core-boundary F1/F3 re-verification, was posted on the
UI PR (same heading; UI head `69f40fee2e`, with the head-drift limit stated):

* https://github.com/damianvtran/local-operator-ui/pull/1269#issuecomment-6302778070

## Remediation capture (design/UX round 1)

Re-capture of the remediated build, 2026-10-20, against the same commit series
as the review (branch `feat/hub-skills-state`, UI head `42e022ab9a` plus this
evidence commit). Frames in `docs/evidence-frames/hub-skills-surface/frames-remediation/` (ignored, not committed), captured by the same driver
in headless window mode (`capturePage()`, 1380x900 requested).

```
$ VITE_RADIENT_SERVER_BASE_URL=http://127.0.0.1:8127 pnpm build
$ node docs/evidence/hub-skills-surface/harness/stub-hub.mjs --port 8127
$ node docs/evidence/hub-links/harness/stub-daemon.mjs --port 8131 --skills-adapter
$ QA_BACKEND=http://127.0.0.1:8131 QA_FRAMES=$PWD/docs/evidence/hub-skills-surface/frames-remediation \
    LOCAL_OPERATOR_DESKTOP_TOKEN=rig node scripts/hub-skills-surface.mjs
```

| Frame | What it shows |
|---|---|
| `surface-tabs.png` | Skills tab beside Agents and Teams |
| `surface-cards.png` | The browse scaffold: one heading (the tab), the Teams-style icon search, "Publish a skill" as a toolbar action, "2 skills in Public hub", and cards in the agent card's anatomy (16px name, 13px description, provenance line, hairline, footer state) on the 17.5rem / 24px grid |
| `surface-detail.png` | The detail as a modal in view: full description, "Not downloaded · Version 1", files, one primary (Download) and one secondary (Subscribe), and the support sentence for the unlinked state |

**Accommodations of the rig, not of the app.** The hub stub now answers CORS
and Private Network Access preflights (the real hub does; without them the
renderer's fetch from a `file://` page fails exactly like a dead hub). The
built `out/renderer/index.html` had `http://127.0.0.1:8127` added to
`connect-src` for this run only — `out/` is gitignored and `src/` is untouched,
the same accommodation `renderer-driver.mjs` documents for `frame-src`.

**What this capture does not show.** Signed-in writes (Download/Subscribe press,
unpull, publish preview/confirm) and the waiting/applied card states: the stub
desktop daemon's skill link identity (`hub-skill-release-notes`, `https://hub.radient.local`)
does not join this stub hub's catalogue (`skill-release-notes`, loopback), and no
account exists on this machine. Those states are covered by
`scripts/hub-skill-state.test.mjs` (state derivation and mark precedence) and by
the design round's own fixture; the QA HTTP receipts cover the core boundary.

## Scene re-run after code-review round 2 (`bf0a44a269`)

The `hub-skills` driver scene reads the shipped dialogs again after the
remediation restored its hooks. It runs the app's own real `hub.skillPull` and
`hub.skillPublish` writes against the repo's stub desktop daemon and the stub
hub above, in headless window mode.

```
$ node docs/evidence/hub-links/harness/stub-daemon.mjs --port 8131 \
    --records <scratch>/serve-record --skills-adapter --source http://127.0.0.1:8127/v1
$ node scripts/renderer-driver.mjs --scene hub-skills \
    --backend http://127.0.0.1:8131 --backend-records <scratch>/serve-record
```

Result, at `bf0a44a269` (full transcript in
`receipts/hub-skills-scene-bf0a44a269.txt`): **28 PASS, 0 FAIL, `ALL CHECKS
PASSED`, exit 0.** The checks now cover the shipped surface: the source line
("2 skills shared with Minerva"), the card press opening the dialog, the detail's
files, the real pull succeeding ("Downloaded minerva-deploy from Minerva ·
Private"), the link's Subscribe and Auto-push controls mounting after that pull,
the publication dialog opening from its toolbar action, its preview rendering the
server-projected payload, the confirm settling ("Published release-notes-copy to
Minerva · Private"), and zero CSP violations or off-origin renderer requests.

Frames: `docs/evidence-frames/hub-skills-surface/scene-b3ed64c2c0/` (ignored, not
committed), seven screenshots including `-populated`, `-detail`, `-policy`,
`-pull-success`, `-publish-preview`, `-publish-complete`, `-search-empty`, plus
the geometry JSON.

What this scene does not show, as before: no Radient account exists here, so the
org read goes through the daemon's proxy rather than a real tenant; the auto-push
switch renders disabled with its reason because the stub destination is not
verified for automatic publication.

## Round 3 — freshness at UI `85e1115289`

Focused app-only freshness pass after the UI moved from the round-1 head
`69f40fee2e` to `85e1115289`. No new matrix: the five items below were re-driven
and re-shot through the real built Electron app (headless window mode), the real
core at the fix heads, and the stub hub. The write flows remain un-drivable
without a signed-in account; they are still covered at the core HTTP boundary,
not through the app.

### Build and environment

| Piece | Identity |
|---|---|
| UI | worktree `hub-skills-state` @ `85e1115289` (= #1269 head at run time), `pnpm build`; headless Electron, 1380x900 requested, 2760x1800 PNG at DPR 2 |
| Build note | `pnpm build` regenerated `out/renderer/index.html`; the source CSP does not name the stub origin, so the documented **gitignored build-output** accommodation was reapplied (`connect-src` + `http://127.0.0.1:8127`). Without it the renderer refuses 8127 and the Skills catalogue reads `"Skills from Public could not be loaded."` — a rig wiring failure, not a product result. `src/` is untouched; the production origin (`https://api.radienthq.com`) is already in the CSP |
| Core | `qa/hub-skills-integration-r2` @ `f8ae74c561` (= #2711 `b6dccc50d9` + #2713 `d2caf06fc1` + round-1 integration), worktree venv, fresh isolated `HOME`/`LOCAL_OPERATOR_CONFIG_DIR`, `LOCAL_OPERATOR_DESKTOP_TOKEN=rig`, `RADIENT_API_BASE_URL=http://127.0.0.1:8127`; `127.0.0.1:8139`, signed out (`POST /v1/desktop/radient {"operation":"account"}` → `409 radient_no_credential`) |
| Hub | `docs/evidence/hub-skills-surface/harness/stub-hub.mjs --port 8127`; two public rows |
| Dark core | installed `lop` 0.84.0 generation `20261020T154014Z-0.84.0`, isolated `HOME`/`LOCAL_OPERATOR_CONFIG_DIR`, `127.0.0.1:8132`; `/v1/capabilities` has `hub_skills: null`, `hub_links: 1` |
| Inventory failure | a throwaway `127.0.0.1:8140` proxy forwards everything to 8139 except `GET /v1/desktop/hub/links`, which answers `500`; the app is pointed at 8140 |

Commands:

`QAUI` below is this run's scratch root; `frames/`, `frames-dark/`,
`frames-inventory/`, logs and the two probe scripts live under it, not in the
repository. The frame names in the sections below are relative to that root.
```sh
cd ~/local-operator-ui/.worktrees/hub-skills-state
pnpm build

# stub hub (foreground/background as convenient)
node docs/evidence/hub-skills-surface/harness/stub-hub.mjs --port 8127

# real core, fresh isolated store, signed out
HOME=$QAUI/core-home LOCAL_OPERATOR_CONFIG_DIR=$QAUI/core-home/.local-operator \
LOCAL_OPERATOR_DESKTOP_TOKEN=rig RADIENT_API_BASE_URL=http://127.0.0.1:8127 \
~/local-operator/.worktrees/hub-skills-qa-r2/.venv/bin/local-operator serve --host 127.0.0.1 --port 8139

# app against the real core
LOCAL_OPERATOR_DESKTOP_TOKEN=rig QA_BACKEND=http://127.0.0.1:8139 QA_FRAMES=$QAUI/frames \
  node scripts/hub-skills-surface.mjs

# dark path against installed 0.84.0
LOCAL_OPERATOR_DESKTOP_TOKEN=rig node scripts/renderer-driver.mjs --scene hub-skills \
  --skills-adapter-absent --skills-expect public --backend http://127.0.0.1:8132 \
  --backend-records $QAUI/dark-home/.lop/run/serve --out $QAUI/frames-dark --theme localOperatorDark

# inventory failure (proxy on 8140 in front of 8139, links → 500)
LOCAL_OPERATOR_DESKTOP_TOKEN=rig QA_BACKEND=http://127.0.0.1:8140 QA_FRAMES=$QAUI/frames-inventory \
  node scripts/hub-skills-surface.mjs
```

### 1. Skills tab, cards and the count line — PASS

```
tabs: ["Agents", "Teams", "Skills"]
skillsTabPresent: true
cards: 2
libraryText: "2 skills · Public hub
  release-notes — Draft release notes from a merged PR list. — Public hub — Not downloaded
  transcript-audit — Audit a transcript for policy contradictions. — Public hub — Not downloaded"
sourceLine: "Public hub"
```

Frames: `surface-tabs.png`, `surface-cards.png`.

### 2. Card opens the dialog in view: description, files, version, state — PASS

The detail dialog's own text (it is portaled, so the surface driver's
section-scoped read misses it; a small probe read `[role="dialog"].innerText`):

```
release-notes
Public hub
Not downloaded · Version 1
Draft release notes from a merged PR list.
Files included
3 files included
SKILL.md
references/notes.md
scripts/run.sh
Sign in to the hub before trying this action.
Download
Subscribe
Follows future revisions. Downloads nothing now.
```

`detailOpened: true`; `detail.localPath: null` (no copy); `fileSummaries:
["SKILL.md","references/notes.md","scripts/run.sh"]`.
Frame: `surface-detail-version-state.png`.

### 3. Signed-out gate: Download/Subscribe disabled with a reason — PASS

```
download:  { present: true, disabled: true, label: "Download" }
subscribe: { present: true, disabled: true, label: "Subscribe" }
reason:    "Sign in to the hub before trying this action."
```

Frame: `surface-download-state.png` (the control and the sentence in the same
view). The write flows are still **not drivable in the app**; the core HTTP
boundary remains the coverage for pull/subscribe/unpull/publish.

### 4. Dark path against installed 0.84.0 — PASS

```
capabilities: {"hub_skills": null, "hub_links": 1}
[PASS] released-core fallback retains selected Agents and hides Skills entry/actions
[PASS] released-core fallback starts zero remote Skills list/detail queries
[PASS] window mode is headless and the window is never shown or focused
[PASS] no process from this run outlived its boot
16 PASS, 0 FAIL — ALL CHECKS PASSED
```

Frame: `frames-dark/09-dark-0840-no-skills-tab.png` (Agents + Teams only; the
Connect-an-AI-account dialog is the isolated signed-out state, not a Skills
regression).

### 5. Inventory-unknown — PASS

The desktop inventory `GET /v1/desktop/hub/links` was forced to `500` through
the proxy while the hub catalogue stayed healthy. Cards still render from the
catalogue, and each footer must state the unknown inventory rather than claim
"Not downloaded":

```
libraryText: "2 skills · Public hub
  release-notes — … — Public hub — Link state unavailable.
  transcript-audit — … — Public hub — Link state unavailable."
cardTexts: [same two lines]
```

The detail dialog's state line carries the same `Link state unavailable.`
Frame: `frames-inventory/surface-inventory-unknown.png`.

### Round-3 verdict

| # | Item | Verdict |
|---|---|---|
| 1 | Skills tab present, cards and count line | **PASS** |
| 2 | Card opens the dialog with description/files/version/state | **PASS** |
| 3 | Signed-out Download/Subscribe disabled with a reason | **PASS** (write flows still un-drivable in the app) |
| 4 | Dark path against installed 0.84.0 (no `hub_skills`) | **PASS** |
| 5 | Inventory-unknown state under a forced links failure | **PASS** |

### Limits

* **No signed-in account.** Download/Subscribe/Unpull/publish were not pressed in
  the app; their behavior is covered by the core HTTP boundary, not by this pass.
* **No real cloud.** The hub is the local stub; the core is the integration
  worktree; the 0.84.0 dark core is the installed generation. No production data
  or operator credential was used.
* **Build-output CSP patch.** The stub origin was admitted by editing the
  gitignored `out/renderer/index.html`, exactly as round 1 documented. The source
  tree and the production CSP were not changed.

### Rig hygiene

Hub (`27791`), core (`28084`), dark core (`39671`) and proxy (`40893`) were
terminated by exact pid; `lsof` shows no listener on 8127, 8139, 8132 or 8140,
and no Electron process from this worktree remains. No dependency installs, no
second UI build beyond the requested `pnpm build`, no browser engine, no
`screencapture`.

### PR comment

Posted as `### QA report — round 2` on UI #1269:

* https://github.com/damianvtran/local-operator-ui/pull/1269#issuecomment-6303613439
