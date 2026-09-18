# Any-daemon attach — the desktop app as a client of a server it did not start

Status: **design contract, implementation not included.** One implementer follows
this document. No backend change is required (§ 1.3), and the one main-process
behaviour this design needs beyond open PR #375 is named in § 6.2.

Written against UI head `853c054c6` (`fix/daemon-any-attach`, cut from
`origin/main`) and backend head `76d5875052` (tag `v0.59.5`, `local-operator`
`origin/main`). UI citations are `file:line` against that head. Backend citations
name the file and are read at that tag. Open PR #375
(`fix/daemon-refusal-blocks-repair`) is read at `0b182527f`; its overlap with
this work is stated in § 6.1 rather than assumed to be sufficient.

Read with: `docs/branding.md` § 8 (one sentence, one remedy), `docs/desktop-controls.md`
(the negotiation contract § 4.4 amends), `src/shared/backend-status.ts` (the state
vocabulary), and `docs/evidence/daemon-attach-live-app/README.md` (the frames the
states below are photographed in).

---

## 0. The problem as I found it

Two requirements from the operator:

R1. **The app must work with any installed `lop` daemon it can authenticate to**,
and must not require a backend the app itself manages.
R2. **The app must not require the daemon to be the same version**, and must not
block the core reads on version skew.

The screenshot that prompted this shows three surfaces disagreeing at once, and
each is a *different* defect:

- (a) the compatibility banner: *"This app is not paired with the running Local
  Operator server, so provider sign-in, settings, slash commands and MCP
  management are unavailable. Restart the app so it can manage its own server."*
  (`backend-error.ts:243`). The diagnosis is true. The remedy instructs the user
  to make the app own the server, which is the model R1 rejects — and the banner's
  only control is a `Retry` that invalidates the capabilities query
  (`backend-compatibility-banner.tsx:61-63`), which cannot change pairing, because
  a public route answers identically before and after.
- (b) the chat pane, centred: *"Update the backend to use canonical chats. Your
  existing histories are unchanged."* (`chat-page.tsx:2221`, with a `Retry` that
  refetches the same public route, `:2226`). This is the `else` branch of
  `!enabled`, where `enabled = desktopFeatureEnabled(capabilities.data,
  "session_catalogue", 2)` (`chat-page.tsx:2070-2073`). The user is being told
  their **server is old** when the fact is that **this app holds no credential for
  it**.
- (c) the sidebar line *"Desktop controls require a backend started by the desktop
  app."* — the daemon's own refusal prose
  (`local_operator/server/desktop.py:223`), rendered as though it were the app's
  diagnosis. It reaches the UI because `desktopResult` adopts the response body's
  `detail` as the thrown `Error` message (`desktop-api.ts:253-262`), and any
  surface that renders a caught desktop error prints the daemon's words
  (`chat-sidebar.tsx:512`).

**One correction to the framing I was handed.** (c) is not a status *line*: the
sidebar renders a caught desktop failure in exactly one place, the mark-all-read
toast (`chat-sidebar.tsx:512`), and its neighbouring status line renders the
transport's sentence, not the daemon's (`chat-sidebar.tsx:1551` renders
`capabilities.error.message`, and the capability op never reaches the daemon's
503). The class and the fix are identical either way — no daemon-authored `detail`
may be rendered as the app's diagnosis (§ 5) — but the surface list a fix must
cover is the one in § 5.1, not "the sidebar line". What would settle which one the
operator photographed: the app's own backend log for that window, which records
the `POST /v1/desktop/presence` refusals and the capability asks separately.

**The one thing already true, and it is most of the requirement.** The app already
discovers and adopts a daemon it did not start:
`adoptFirstUsableDaemon` → `attachIfUsable` (`backend-service.ts:1253`, `:1297`)
reads the candidate's `claim_key` from its 0600 serve record and claims the plane
through `POST /v1/desktop/claim` (`:1322`), adopting with `{ owned: false }`
(`attachTo`, `:1470-1483`). The operator's own machine proves the ordinary case:
`~/Library/Application Support/Local Operator/logs/backend-service.log` records
`Claimed the desktop plane on http://127.0.0.1:1111` at 18:12:17 and eight earlier
adopts of an external uv-tool daemon out of `~/.local/share/lop/generations/…`.

So this is not a feature to build. It is one behaviour gap, one missing verb, and
three copy decisions.

---

## 1. Ground truth that shapes the design

Each item was read, not recalled.

1. **An attached app can be unpaired in exactly three ways, and only one of them
   is reachable from a healthy attach.** The gates are `attachIfUsable`'s two
   credential branches: `!key && !this.desktopToken` → "publishes no claim key and
   this app holds no pairing token for it" (`backend-service.ts:1304-1317`), and
   the claim verdicts (`:1322-1356`, mapped in `discovery.ts:1113-1131`). Every
   other path requires a bearer the daemon *accepted* in `probeCandidate`
   (`:1429`), so an app that reached `attached` was paired at that moment. Pairing
   afterwards breaks only if the process under the app is replaced — a `lop` build
   swap mints a fresh key and shuts the plane — which is precisely what #375
   fixes. The other two (no key published; a daemon predating the handshake) never
   attach, so they are *never* "attached but unpaired": they are the `wedged` /
   `unattachable` family, already worded by `serverBannerCopy`
   (`shared/backend-status.ts:170-186`) and by `observeOriginOccupancy`
   (`backend-service.ts:2525-2561`).
2. **A daemon that can be claimed always has the catalogue, and the whole
   version-tolerance requirement therefore rests on one question.** Measured from
   the backend's own tags: `session_catalogue: 2` was added by `f914a55c`, first
   released **v0.51.27** (2026-09-08); serve records by `09edc58b`, first released
   **v0.54.38**; the `/v1/desktop/claim` route by `405d2031`, first released
   **v0.54.40** (2026-09-13). `git show v0.54.40:local_operator/server/routes/capabilities.py`
   carries `session_catalogue: 3` **and** every one of the app's seven required
   features (`auth`, `settings`, `commands`, `catalogues`, `lifecycle`, `mcp`,
   `radient`, all at 1) — they were all present already at v0.51.27. **So the
   reachable set of "pairs, but lacks a capability the app demands" is exactly:
   a daemon whose plane this app governs through its own environment token or its
   persisted token** (`backend-service.ts:333-334`, `:694`, `:1839`) — i.e. a
   daemon *this app spawned* — built from either the resolved global install
   (`checkLocalOperatorExists`, `:1119`) or the app's own venv
   (`backend-installer.ts:364-395` writes and runs a generated install script;
   `src/main/backend/scripts/macos-install-script.sh:238` is the line that decides
   what lands in it: `python -m pip install --upgrade --verbose local-operator`,
   **unpinned**, so an old app install can hold a build from any past release).
   No daemon the app *adopts* can be in that set: pairing through the claim route
   implies ≥ v0.54.40, which implies the catalogue.
3. **The app already tells the truth about this in one place and lies in another,
   and the lie is structural.** `desktopFeatureEnabled` answers one boolean for
   two conditions: `!capabilities || !capabilities.desktop_available → false`, then
   `features[key] >= minimum` (`desktop-hooks.ts:321-327`). Fail-closed is right
   for *enabling*; it is wrong for *explaining*, because every surface that reads
   the boolean alone must guess which half closed. Two of them guess differently:
   `sidebar-catalogue-gate.ts:143-165` selected on the plane and was corrected to a
   single sentence (review round 3, MINOR-2, in its own comment), while
   `chat-page.tsx:2218-2225` still renders the version sentence for both halves.
4. **Main's pairing bit is sticky-true, which is a second, independent defect.**
   `DaemonStateMachine.setDesktopAvailable` is called with `true` in exactly three
   places and never with `false` (`backend-service.ts:1503`, `:1610`, `:2051`;
   `daemon-status.ts:185`), and `attach()` does not reset it (`daemon-status.ts:164-172`).
   So after a swap to an unclaimed successor, `DaemonStatusSnapshot.desktopAvailable`
   (`daemon-status.ts:470`) still reads `true` while the renderer's own capability
   answer reads `desktop_available: false`. Two surfaces, one condition, opposite
   statements — the rule this repository already states ("one condition, one
   statement") broken by a stale flag rather than by copy. #375 does not touch this.
5. **The record already publishes the discriminator for "somebody else governs
   this plane", and nothing reads it.** `ServeRecord.desktop` is `true` exactly when
   the plane is governed — by the app's environment token, or by an accepted claim
   (`local_operator/server/registry.py:283-296`) — and `claim_key` is `""` in that
   same state (`registry.py:412`). The app parses it (`discovery.ts:304`) and no
   decision reads it: `grep '\.desktop\b' src/main/backend/*.ts` returns only the
   parse line. Today `desktop: true, claim_key: ""` and "a build predating the
   handshake" collapse into one sentence (`backend-service.ts:1306-1313`), and they
   need different sentences and different controls.
6. **The claim refusals are already distinguishable and the app throws the
   distinction away.** `claimDesktopPlane` keeps `409` (already governed),
   `401` (wrong key), `unreachable`, and lumps *everything else* into
   `refused` with `detail: "claim refused with <status>"` (`discovery.ts:1119-1126`).
   **`404` — the route is absent, so the daemon predates the handshake — is the one
   refusal that a status names unambiguously, and it is the one this design needs.**
   The daemon's own contract for the same route lists 403/400/409/503/401
   (`local_operator/server/desktop.py:347-363`), so `404` is free to mean "no such
   route".
7. **The daemon's prose becomes the app's error message.** `desktopResult`
   (`desktop-api.ts:250-268`) throws `DesktopControlError(status, envelope.detail)`,
   i.e. the *server's* string becomes `error.message`, and
   `userFacingMessage` then treats that message as authored copy
   (`desktop-api.ts:222-240`). The repository's own answer to this problem already
   exists one layer over: `desktop-stream-notice.ts` declares the transport's
   detail strings as a *machine vocabulary* that is "never rendered", with one
   translator composing the product sentence (`desktop-stream-notice.ts:1-27`,
   `:126-133`). The desktop-control refusals have no such layer.
8. **The app-owned framing is not one sentence; it is a family of five.**
   `backend-error.ts:101/108/109` ("Restart the app so it can start its own
   server."), `:243` (the banner's unpaired sentence), `desktop-stream-notice.ts:97`
   (the NOT_PAIRED conversation sentence), `desktop-transport.ts:74` and
   `desktop-media.ts:169` (a synthesised 503 whose detail is
   *"Restart with a desktop-managed backend to use these controls."*), and
   `mcp-failure.ts:115` (the same string as a classified remedy). The last four are
   the ones that reach a user whose daemon is healthy and simply not theirs.
9. **The connector's floor is not version-checked, which is the reachable old-daemon
   route.** `start()` mints the token (`backend-service.ts:1839`) and spawns either
   the resolved global console (`resolveGlobalConsole`, `:1680`) or the app's own
   venv; neither path compares the build it is about to spawn against anything the
   app requires. That is deliberate and correct for R1 — but it is where a
   *genuinely* old daemon can still appear, and it is the only place the version
   sentence in (b) is true.
10. **The rule this design must confirm or correct is stated in two places, in two
    different shapes.** The backend states the good rule on `session_search`
    ("a client renders the catalogue perfectly well against a backend whose search
    route does not exist, and gating the list on the search version would hide a
    working surface because a newer one is missing"). `docs/desktop-controls.md:29-33`
    states the bad one for the whole transport: *"A missing/unsupported capability
    requires a visible backend update/setup action"* — an absolute that makes the
    update the answer to every absence, including absences an update cannot fix.

---

## 2. Decision A — the state model

**Rule applied: one condition, one statement on one surface, one control that
actually changes the condition.** The controls named below are *verbs on main*, not
query invalidations; a refetch of a public route is not a control for any state in
this table, because it succeeds identically in every one of them.

| # | State | True cause (evidence) | Surface that owns the statement | Statement | Control(s) that remedy it |
| - | ----- | --------------------- | ------------------------------- | --------- | ------------------------- |
| S1 | Replaced under the app: attached, plane refuses | The process answering is not the one attached to (`probeAttachedDaemon` → `identity-mismatch`, `backend-service.ts:2695-2707` on #375's head `0b182527f`) | compatibility banner | "The Local Operator server was replaced while this app was running. Pairing with the new one." | none required (main re-discovers within 3 probes); `Retry` = main's reconnect verb |
| S2 | Governed by another program | Record exists with `desktop: true, claim_key: ""` (§ 1.5) and this app holds no token | compatibility banner (primary); the connectivity banner's `detail` line names the cause | "The Local Operator server on this machine is already managed by another program, so this app cannot use its settings, provider sign-in, slash commands or MCP management." | **none exists** — say so; do not offer |
| S3 | Daemon predates the handshake | No serve record at all (`noRecordsAtAll` → `legacyFixedPortAdoption`, `:1557`), or a record whose claim is refused **404** (§ 1.6) | compatibility banner | "The Local Operator server on this machine is older than the pairing handshake this app uses, so this app cannot drive its controls." | Update the server — **only** where the app owns the serving install (`servingInstall().owned`) |
| S4 | Credential refused on a gated route | 401/403 from a `/v1/desktop/` route with a live identity | compatibility banner | "This app's credential for the running Local Operator server was refused, so provider sign-in, settings, slash commands and MCP management are unavailable." | `Retry` = main's reconnect verb (re-claim is the repair) |
| S5 | Unpaired, cause not yet established | `desktop_available: false` with no pairing record from main (§ 5) | compatibility banner | "This app is not paired with the running Local Operator server, so provider sign-in, settings, slash commands and MCP management are unavailable." | `Retry` = main's reconnect verb |
| S6 | Paired, capability absent | `desktop_available: true` and `features[key] < minimum` (§ 1.2 narrows this to the app-owned daemon) | the surface that lost the capability, plus the banner's feature list | existing per-feature sentences | Update the server (app-owned only) |
| S7 | No usable daemon at all | `detached` / `wedged` / `unreachable` | connectivity banner (unchanged) | unchanged (`serverBannerCopy`) | unchanged; S7 is explicitly *not* restated by the compatibility banner |

Three consequences worth stating plainly, because they are the decisions:

- **S1–S5 are pairing states and none of them is a version state.** The banner's
  `unpaired` branch must therefore not be reachable from a version cause, and the
  chat pane's version sentence must not be reachable from a pairing cause. That is
  the whole of the copy fix for (a) and (b).
- **S2 has no remedy and must offer no control.** The operator's requirement and
  the daemon's invariant (`desktop.py` module docstring: *"a second claim is
  refused even when it presents the correct key"*) agree. A state with no available
  action renders a statement and no button
  (`desktop-stream-notice.ts:24-26` states this rule already).
- **One new surface is owed: S2.** Today the only thing that says "a server is
  running and this app is not attached to it" is the connectivity banner, whose
  `wedged` title is correct but whose detail is generic
  (`shared/backend-status.ts:172-176` renders main's `detail`). S2's sentence
  belongs in the compatibility banner (it is the surface listing the lost
  capabilities). The connectivity banner keeps its title unchanged; only main's
  `detail` sentence is sharpened to name which of S2/S3 it is
  (`backend-service.ts:1306-1317` currently says the same thing for both).

**The control, decided.** The renderer already has the right verb and does not use
it here: `BACKEND_RECONNECT_CHANNEL` → `backendService.reconnectNow()`
(`shared/backend-status.ts:53`, `main/index.ts:2417`, `backend-service.ts:2796`),
which is what the connectivity banner's Retry calls. It clears the recovery pacing
and runs main's re-discovery, i.e. the *claim* path, which is the only thing that
can change S1/S4/S5. The compatibility banner's `Retry` must call that verb, not
`invalidateQueries` (`backend-compatibility-banner.tsx:61-63`). This is a
renderer-only change, and on #375's head it is already effective, because
`recoverFromDetachment` no longer returns early on a live contradicted pid
(`backend-service.ts:2916-2930` on that branch). **Without #375 the verb is inert
in S1/S4** (the early return at `:181`), which is why § 6.2 wants the same
re-discovery reachable when main already knows the pairing is broken, independent
of the probe verdict.

---

## 3. Decision B — the unpaired copy

Replace the app-managed clause wherever the condition is *pairing*. Five sentences,
one per cause, all in `backend-error.ts` beside the classification (the module's
own rule: one authority, two surfaces cannot drift). The strings in § 2's table are
the contract; the notes below are why each is worded that way.

1. **What the app is doing, not what the user must fix.** S1/S4/S5 say "this app is
   not paired" and offer a control that makes the app *try to pair*. The current
   sentence instead issues an ownership instruction — "Restart the app so it can
   manage its own server" — which converts a client's failure into a demand that
   the user re-architect their machine. R1's sentence: the app is a client of
   whatever daemon is running; pairing is the app's job and the retry is the app's.
2. **S2 must name the other principal without naming it as an error.** The fact the
   app can prove is the record's `desktop: true, claim_key: ""` plus the absence of
   a token: *somebody* governs it. The sentence names the state, not the actor,
   because the app cannot know who — and it must not imply the user can clear it.
3. **S3 must name the age, because age is the fixable part, and must say what
   still works.** "Older than the pairing handshake" is true of both sub-cases (no
   record at all, and a record whose claim is refused 404). Because the daemon
   answered `/health` and its own routes, the app can prove — and should say — that
   nothing is lost on the daemon's account: the CLI, the TUI and the daemon's own
   clients are unaffected. Saying it is a decision rather than an implication: the
   current unpaired sentence offers a reassurance ("your existing histories are
   unchanged") for a *different* condition, and that one moves to S6 with the
   version sentence.
4. **The update control is offered only where the app may update the serving
   install.** `backendUpdateIsRemedy` currently refuses the update for every
   unpaired backend (`backend-error.ts:185`), which is right for S2/S5 and
   wrong for S3-with-an-app-owned-daemon, where install+restart is exactly the
   remedy and the ownership predicate for it already exists
   (`servingInstall().owned`, and the drift repair's own decision at
   `update-service.ts:4971-4990`). Decision: `backendUpdateIsRemedy` takes the cause
   and answers `true` only for S3 with `servingInstall().owned === true`. The
   ownership answer must come from main; the renderer may not guess it from
   `installKind`.
5. **The synthesised refusals stop being prose.** `desktop-transport.ts:71-77` and
   `desktop-media.ts:169` write a user-facing sentence into a `detail` field. Those
   become machine strings beside the fixture they describe, translated once, exactly
   as `desktop-stream-notice.ts` already does for the stream — see § 5.

**Do not weaken the one-app-owns-the-daemon invariant.** Nothing in this change
asks the daemon to accept a second claim. If a future requirement needs two app
instances to share a plane, that is a separate, flagged proposal with a security
consequence (§ 9.2), not a consequence of R1.

---

## 4. Decision C — version tolerance, surface by surface

The rule this design **confirms**, from the backend's own capability comments and
`desktop-hooks.ts`'s key rationale: *a new route gets its own key; an existing
surface keeps working against a backend that lacks it.* The one place the repo
states the opposite — `docs/desktop-controls.md:29-33`, "a missing/unsupported
capability requires a visible backend update/setup action" — is corrected in this
change to the rule the rest of this section applies (`docs/desktop-controls.md` is
the file to touch, § 6.3).

| Surface | Capability floor | Behaviour when absent | Owed sentence | Update offered? |
| ------- | ---------------- | --------------------- | ------------- | --------------- |
| Chat list (sidebar) | `session_catalogue >= 2` (`chat-sidebar.tsx:366`); `profile_catalogue`, `team_catalogue` per section | degrade: keep the last-known rows mounted, one notice | the gate's one sentence (`sidebar-catalogue-gate.ts:162-165`), **re-selected on the pairing cause** (§ 2) | S6 only |
| Transcript + composer | `session_catalogue >= 2` — the whole pane (`chat-page.tsx:2070`) | refuse the pane | **split by cause**: S2/S4/S5 pairing sentence, S6 version sentence | S6 only |
| Plain-text send | nothing beyond the plane: `sessions.message` ships with the catalogue contract | n/a (inside the pane) | n/a | n/a |
| Slash commands | `commands >= 1` (`slash-commands.tsx`, `slash-dispatch.ts`) | the affordance is absent; typed prose still sends (backend policy `commands: 2`) | existing per-absence copy | S6 only |
| Provider sign-in | `auth >= 1` (+ `catalogues` for the model pickers, `setting-combobox.tsx`) | refuse the surface | shared diagnosis + remedy (`backend-error.ts`) | S6 only |
| Settings | `settings >= 1` (`backend-settings-section.tsx:38`) | refuse the surface | shared | S6 only |
| MCP management | `mcp >= 1`, `mcp_auth >= 1` | refuse; the auth dialog never opens | shared | S6 only |
| Draft pane readings | `draft_preview >= 1`, `draft_selection >= 1` | omit the strip; chips stay inert | "this server cannot report that yet" | S6 only |
| Machine feed | `desktop_feed >= 1` | fall back to the 5 s poll, `chat-sidebar.tsx:285-290` | the feed's own `ink-dim` line | no |
| Per-control extras (`session_move` 2 + `frontend_replace`, `session_interrupt`, `session_variables`, `session_search`, `diagnostics`, `completion_ack_bulk`, `subagent_transcript`, `attention.seen`, `references`) | own key each | the control is **not rendered** (fail-closed), never a control that 404s | the surface's own note where something remains to show | no |

**The over-gating the operator is hitting, named exactly.** It is not a gate; it is
the *conjunction inside one predicate* (§ 1.3) — `desktopFeatureEnabled` answers
one boolean for pairing-or-version, so an EXISTING surface (`chat-page.tsx`'s pane,
`chat-sidebar`'s list) reports a NEW capability's absence as a *version* problem
when the real condition is pairing. **The fix is the tri-state, not more
conditions**: one exported decision beside `desktopFeatureEnabled` returning
`"enabled" | "unpaired" | "below-version" | "unknown"`, with
`desktopFeatureEnabled` kept as its `=== "enabled"` projection so no existing call
site changes meaning and no fifth copy of the predicate appears. Every surface then
selects its sentence from the same enum, which is how "one condition, one
statement" becomes structural rather than a review checklist — the shape
`sidebar-catalogue-gate.ts` already established for one of the two surfaces.

**What this buys R2, stated as a falsifiable prediction.** Because pairing implies
≥ v0.54.40 (§ 1.2), after this change: *no string in the app may tell a user to
update the server while the app is attached to a daemon it did not spawn.* A
frame or a test that produces that combination is a defect in this design, not a
version skew to tolerate.

**Non-goal, explicitly.** The app does not gain a version-minimum check on attach.
Refusing a daemon for being old would break R1 for exactly the daemons R1 is about;
the capability answers are the mechanism the backend already provides for this, and
they are per-surface by design.

---

## 5. Decision D — where the app's status stops echoing the daemon's refusal

Two halves, because there are two ways the daemon's prose becomes the app's.

**5.1 The transport's detail stops being copy.** `desktopResult` throwing
`envelope.detail` as the message (`desktop-api.ts:253-262`) is the mechanism behind
the photographed line. Fix, following `desktop-stream-notice.ts` verbatim in shape:

- the pairing-family refusals (a 401/403/503 whose op maps to a `/v1/desktop/`
  route) are classified into a machine code — `pairing.refused`,
  `pairing.plane-closed`, `pairing.stale` — carried on `DesktopControlError.code`
  (the field already exists, `desktop-api.ts:196`) rather than smuggled in
  `message`;
- one translator composes the product sentence from the code, and the daemon's
  string is retained only where a surface already shows machine-voice detail;
- the surfaces that render a caught desktop error are then asserted by test to
  render the translator's output, not the message: `chat-sidebar.tsx:512`,
  `chat-page.tsx:889`, `chat-page.tsx:1265` and `:1359`,
  `canonical-sessions-store.ts:1137`, `move-session.ts:205`,
  `canvas-variables-viewer.tsx:560/644`, `publication-failure.ts:587`. Those are
  the nine call sites of `userFacingMessage` that can receive a desktop
  `DesktopControlError`; the fix is the translator plus a test that each renders it,
  not nine edits — `userFacingMessage` is already the one place that knows which
  messages are authored (`desktop-api.ts:222-240`), so it is the seam.

**5.2 Main's status carries the cause as data, not as prose.** The renderer cannot
word S1–S5 from a boolean, and main must not hand it a sentence it then renders.
Decision: `DaemonStatusSnapshot` gains a `pairing` record — `{ available: boolean;
cause: "successor" | "governed-elsewhere" | "pre-handshake" | "credential-refused" |
null }` — produced where the facts are still in hand (`attachIfUsable`'s claim and
probe branches, `backend-service.ts:1297-1410`; the record read at
`discovery.ts:304`). It replaces `desktopAvailable` as the pairing truth, so § 1.4's
sticky bit cannot recur: the same assignment points set it on every outcome, and
`attach()` resets it. `desktopAvailable` stays as a derived read for the existing callers
(`use-palette-sources.ts:232` is a live reader of that exact field, so it is the
first call site to migrate) or is retired with them — the implementer may choose,
provided no surface reads a value that can be stale.
`detail` stays main's own sentence, which is what `serverBannerCopy` legitimately
renders today.

---

## 6. Where the change lands (smallest set that works)

**6.1 What #375 already covers, precisely.** PR #375 (branch
`fix/daemon-refusal-blocks-repair`, head `0b182527f`) changes
`src/main/backend/backend-service.ts`, `src/main/backend/daemon-status.ts`,
`src/main/desktop-transport.ts` and three test files, and **no renderer file**. It
separates "this answer proves liveness" from "this answer proves the pairing"
(`desktopAnswerProvesPairing`, keyed on the `/v1/desktop/` prefix and a 2xx), adds
the `contradicted` observation for an answered identity mismatch, and lets recovery
reach discovery on a contradiction even while the replaced pid is alive. It fixes
**S1's automatic repair** and it fixes the reason the app could not re-pair itself.
It does **not** touch: any copy (§ 3), the banner's control (§ 2), the chat pane's
cause collapse (§ 4), main's sticky pairing bit (§ 1.4 / § 5.2), or the daemon's
prose reaching the renderer (§ 5.1).

**6.2 The one behaviour this design needs from main beyond #375.** Make
re-discovery reachable when main already knows the pairing is broken — a
`retryPairing()` path, or `reconnectNow()` consulting the pairing record before the
early return at `backend-service.ts:181`. Two reasons it is not optional: the
banner's Retry must do something the moment a user presses it rather than waiting
out three probes, and S2/S3 must not be retried at all (nothing to retry), which is
a decision the renderer can only make if main's answer says which cause it is.
Keep the ordering rule #375 added: a live *owned* child is never replaced, and this
path may only re-discover, never spawn over a live process.

**6.3 Files.** Main: `src/shared/backend-status.ts` (the `pairing` field, additive —
main and renderer ship in one app, so there is no skew to preserve),
`src/main/backend/daemon-status.ts`, `src/main/backend/backend-service.ts`,
`src/main/backend/discovery.ts` (surface a 404 claim refusal as its own cause —
`ClaimOutcome`, `:1065-1069`; and read `record.desktop` where the no-key branch
needs to say *governed* rather than *keyless*, `:304`), the `capability`
observation's detail at `backend-service.ts:1306-1317`, `src/main/desktop-transport.ts`,
`src/main/desktop-media.ts`. Renderer: `src/renderer/src/shared/api/local-operator/backend-error.ts`
(the cause table and the copy authority), `…/desktop-hooks.ts` (the tri-state),
`…/desktop-api.ts` (the refusal codes), `…/shared/components/common/backend-compatibility-banner.tsx`
(copy + the reconnect verb + the ownership-gated update),
`…/features/chat/components/chat-page.tsx` (split the `!enabled` branch),
`…/features/chat/sidebar-catalogue-gate.ts` (take the tri-state),
`…/features/chat/components/chat-sidebar.tsx` (the one toast line),
`…/features/chat/components/run-details/mcp-failure.ts`. Shared copy:
`src/shared/desktop-stream-notice.ts` (NOT_PAIRED). Docs:
`docs/desktop-controls.md:29-33`. No backend change; no new op; no version bump.

---

## 7. Test and evidence plan

**Node-runner (the decisions are callable, so pin them there, not in copy):**

- `scripts/backend-error-surfaces.test.mjs` — the banner and the providers grid
  agree by calling both shipped selectors, per cause; a cause's sentence never
  contains "manage its own server" (§ 3), and S2/S3/S6 select the update control
  they are entitled to.
- `scripts/sidebar-catalogue-gate.test.mjs` — the gate's sentence for each cause of
  the tri-state; the registry's sentence is unchanged for S6.
- `scripts/daemon-health-state.test.mjs` — the pairing record is set on **failure**
  as well as success, and reset by `attach()` (§ 1.4).
- `scripts/daemon-observation.test.mjs` — real loopback daemons: a successor whose
  plane is shut (S1), a record with `desktop: true, claim_key: ""` (S2), and a claim
  route answering 404 (S3) each produce their own cause; and the retry verb
  re-discovers and claims in S1 without a restart.
- `scripts/daemon-discovery.test.mjs` — a 404 claim refusal is classified as
  "no handshake", distinct from 401/409/403.
- `scripts/reconnect-page-gap.test.mjs`, `scripts/desktop-renderer-transport.test.mjs`,
  `scripts/desktop-contract.test.mjs` — the refusal codes, and that
  `userFacingMessage` renders a composed sentence for each rather than the daemon's
  string.

**Live end-to-end (the shapes the unit tests cannot reach), extending the existing
rig rather than adding a second one** — `scripts/attach-frame-evidence.mjs`, whose
scenes already carry an isolated HOME, config dir, `--user-data-dir` and ports, an
allowlisted environment, `--window-mode=headless`, and
`VITE_DISABLE_BACKEND_MANAGER=true`:

1. **Any-daemon attach, really.** `LOCAL_OPERATOR_CONFIG_DIR=<scratch> lop serve
   --port 0` started *outside* the app, then boot the rig against it. Proof: the
   daemon's own access log shows `POST /v1/desktop/claim` → 200 and the app's log
   shows `Claimed the desktop plane on …`; the frame shows the chat list populated.
   This is R1's direct evidence and it does not exist today.
2. **Post-swap re-pair.** Kill that daemon, start a successor on the same port with
   the same config dir (fresh `claim_key`, plane shut). Proof: within ~30 s the app
   re-claims without any user action, and the banner never claims the server is old.
   Frames before/during/after.
3. **Reduced-feature fixture daemon.** The rig's stub (`createServer`) with the
   plane *open* via the env token and `session_catalogue` absent. Proof: the pane
   shows the version sentence, and `Update backend` appears **only** when the rig's
   serving install is app-owned.
4. **Another principal's daemon.** Stub 503-ing every `/v1/desktop/` route plus a
   serve record with `desktop: true, claim_key: ""`. Proof: S2's sentence, no
   control offered, and the connectivity banner still says a server is running.
5. **The photographed triple, re-shot.** One launch reproducing (a), (b) and (c)
   against the same daemon, with the frames for every state this document changes
   committed under a new
   `docs/evidence/any-daemon-attach/` directory and stamped into
   `docs/evidence/manifest.json` (`pnpm check-evidence` is the gate; the frames
   are of the *built* app, not Storybook, because these states are main's and the
   renderer's together).

**What a reviewer can re-run**, from the worktree: `pnpm test:desktop` (the
node-runner set above is inside it), `pnpm check-types`,
`pnpm lint`/`LINT_SINCE=<base> pnpm lint:scripts`, `pnpm check-evidence`, and
`node scripts/attach-frame-evidence.mjs --out <dir> --label <tree> --scene all` for
the frames. The live scene needs a `lop` on `PATH`: name the version it used in the
evidence README, as the existing one does.

---

## 8. The check that falsifies § 4 before any UI code is written

With a daemon the app *did not* spawn running on `:1111` (this machine's ordinary
state) and the app attached and paired:

```sh
curl -s http://127.0.0.1:1111/v1/capabilities | python3 -m json.tool
```

Expected: `desktop_available: true` and `session_catalogue >= 2` — false means the
app is not paired and § 1.2's premise does not hold in that launch at all.

Then try to falsify "pairing implies the catalogue" from the other side, which is
the only way it could be false: `uv tool install local-operator==0.50.0` (any build
before `v0.51.27`), start it on the configured port on a scratch
`LOCAL_OPERATOR_CONFIG_DIR`, and ask the app to attach to it. Falsified if the app
reports itself **paired** to that daemon. Two admissible outcomes and both confirm
§ 1.2: the app declines (no record for a build that predates records, and no token
it can be handed — `legacyFixedPortAdoption`'s `canAuthenticate()` gate,
`backend-service.ts:1557-1564`), or the app spawns that old build *itself* and pairs
with it through its own environment token — which is exactly the app-owned case S6
describes, and the one place the version sentence stays reachable.

If the falsifier does fire, § 1.2 is wrong and the version sentences must stay
reachable for adopted daemons too — a materially different design (a per-surface
version floor with an honest update path for a daemon the app does not own), and the
place to look is the claim path, not the copy.

---

## 9. Non-goals, and one flagged separate proposal

1. **Not a backend change.** The daemon's claim contract, the one-app invariant and
   the record format are used as they are.
2. **Flagged, not proposed here: handover of a governed plane.** Two app instances
   on one machine (dev and packaged is the ordinary case) currently produce S2 for
   whichever instance did not spawn the daemon. Making that shareable means a
   second claim path — a transfer verb keyed on something other than the record,
   since the record holds no key for a governed plane. Security consequence: the
   plane's whole authorization story is "read the 0600 record", and a transfer verb
   must not admit a principal that cannot already read that record *and* must not
   let a page-shaped caller take a plane another principal is driving
   (`desktop.py`'s `Sec-Fetch-Site` rule exists for exactly that). **Recommendation
   for this change: do not.** The honest sentence is the answer, and the operator's
   requirement does not ask for it.
3. **Not the remote/`VITE_LOCAL_OPERATOR_API_URL` configuration.** A configured
   remote backend is adopted through `legacyFixedPortAdoption`
   (`backend-service.ts:1557`) and inherits everything above unchanged.
4. **Not the connectivity banner's states** (`degraded`/`detached`/`wedged`) or the
   drift/update machinery, beyond the ownership-aware update decision in § 3.4.
5. **Left to #375:** the automatic re-pair and the liveness/pairing predicate split.
   If #375 lands first, § 6.2's main change shrinks to "do not wait out three
   probes when the user pressed Retry".

---

## 10. Risks to watch during rollout

1. **A user's `lop` is their tool, not the app's.** Any sentence that offers to
   update it must be true of that install kind, which is why § 3.4 reads ownership
   from main. Watch: an update offered for a daemon the app did not spawn.
2. **A refused Retry is worse than no Retry.** The banner must not offer a control
   in S2/S3 where nothing can happen; the test in § 7 asserts the absence.
3. **The pairing record must not resurrect the sticky bit in a new shape.** The
   failure mode to watch is a `cause` left set after a successful re-pair, which
   would keep the banner up over a working app.
4. **Copy drift between the two surfaces.** `REQUIRED_BACKEND_FEATURES` and the
   per-surface gates are separate lists by design; the tri-state must be the single
   predicate they both read, or the pane and the list will disagree again (the
   defect `sidebar-catalogue-gate.ts:148-160` already removed once).

---

## 11. Items the manager must hold the reviewers to

1. **One cause, one sentence**: the five sentences in § 2 exist once, in
   `backend-error.ts`, and both the pane and the list select from the same exported
   decision. A sixth copy of the pairing predicate is this change's own defect.
2. **No inert control**: every state that offers `Retry` calls
   `BACKEND_RECONNECT_CHANNEL`; a `queryClient.invalidateQueries` left as a control
   for S1/S4/S5 fails review, and S2/S3 render no control at all.
3. **The production claim** (§ 1.2) is re-measured, not restated: `v0.51.27` and
   `v0.54.40` re-derived from `~/local-operator` tags, and the falsifying check in
   § 8 run.
4. **The sticky bit is fixed as data** (§ 1.4 / § 5.2): no surface reads a pairing
   value that only ever moves to `true`.
5. **The daemon's prose is not the app's sentence** (§ 5.1): the frames show the
   composed sentence where the photographed one was the server's.
6. **The live scene is run**, not described: a `lop serve` started outside the app,
   claimed by it, and re-claimed after a swap — with the daemon's own access log as
   the instrument.
7. **`docs/desktop-controls.md:29-33` is corrected in this change**, not left
   adjacent to a design that contradicts it.
8. **No version bump in the PR**, and no new `CONTROLS` row unless a new visual
   surface actually appears (`AGENTS.md`).
