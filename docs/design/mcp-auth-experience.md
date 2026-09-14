# The MCP auth experience: finding a server, and fixing it where you found it

Implementation brief. Branch `feat/mcp-auth-experience`, cut from `origin/main`
`ef40c81e2`. This is the UI half of the operator's request; § 5 states which
parts are honestly not UI.

Author: architect subagent (local-operator-ui, lopdev team). Every claim below is
read from the tree named in the citation, or measured on this host.

Version bumps: **none anywhere in this PR.** `package.json` stays at the released
version; the release is its own PR (§ 6).

---

## 1. The problem as it actually is

### 1.1 The root cause is a shared cache key read two ways — not a missing query

`mcpKeys.list(sessionId)` is one key used by two surfaces that cache **different
shapes** and each read their own:

- `src/renderer/src/features/chat/components/run-details/use-mcp-servers.ts:159`
  keys the query and `:163-171` resolves `desktopResult<McpListPayload>(…)`,
  caching the **transport envelope** `{data: {servers, operations, cold?}}`
  (`McpListPayload`, `:150-152`; the read is `query.data?.data?.servers` at
  `:212`). `desktopResult<T>` returns `envelope.result`, i.e. the backend's whole
  `{"data": …, "replayed": …}` body (`shared/api/local-operator/desktop-api.ts:209-228`).
- `src/renderer/src/features/settings/components/mcp-management-section.tsx:94-96`
  exports that same key, and `:275-289` runs its own `queryFn` that unwraps:
  `.then((result) => result.data)`, caching `DesktopMcpState` `{servers,
  operations}`, read as `listQuery.data?.servers`.

Same key, one level apart. Whichever queryFn wrote the cache last decides what
the other reads, and the run panel's hook polls every 15 s while the panel is
closed (`use-mcp-servers.ts:85`, `:185-193`), so it is nearly always the last
writer. The failure is therefore ordering-dependent and looks like this:

- chat open, `/mcp hubspot` → the Settings section mounts, finds the hook's
  envelope fresher than its `staleTime: 10_000` (`:284`), does not refetch, reads
  `listQuery.data.servers` → `undefined` → `servers = []` →
  `listQuery.isSuccess && servers.length === 0` renders **"No MCP servers
  configured yet. Add one below."** (`:389-393`) with twelve servers configured.
- if the hook's last tick is 10-15 s old, the section refetches, gets its own
  shape, and the list appears.

That is "it brings me over to the settings but there's no hubspot listed there",
and it is the one defect in this report that makes the *whole* section useless
rather than a name unfindable. It is also invisible to any test that exercises
one surface at a time, which is why it shipped — the design doc's own claim that
the two surfaces share "one answer" (`docs/run-sidebar.md` § 7.4) is true of the
key and false of the value.

Cheap runtime proof for QA (no build needed beyond the usual app run): with a
conversation open, wait < 10 s after a panel tick, then open Settings →
Integrations — the empty list is the bug. Then wait 15 s and reload the section:
the list appears. § 6 has the matrix row.

### 1.2 The deep link's argument is used verbatim as a server name

`/mcp` is a backend-declared command whose destination is a navigate target
(`picker-registry.tsx:102-106`):

```
route: (args) => `/settings?section=integrations${args ? `&mcp=${encodeURIComponent(args)}` : ""}`
```

`slash-dispatch.ts:239-242` navigates on a `navigate` destination **before any
backend call**, so nothing ever validates the argument. `settings-page.tsx:411-414`
reads `?mcp=` into `mcpTarget`, `:1155-1159` passes it as `highlightServer`, and
`mcp-management-section.tsx:293-306` uses it as an exact `server.name`:

```
if (!servers.some((server) => server.name === highlightServer)) return;   // :300
```

consequences, all verified:

- `/mcp reauth hubspot` — the whole string `"reauth hubspot"` is the "name", it
  matches nothing, and the effect returns **silently**. No scroll, no colour
  step, no message. This is the exact string the operator's own remedy line
  suggested, and the backend's own grammar reserves that shape
  (`MCP_SUBCOMMANDS = ("list","add","remove","login","logout","reauth")`,
  `session/frontend_state.py:862`), so the panel was pointing at a command that
  cannot work.
- `/mcp hubspot` — works today, but only when 1.1 did not blank the list.
- The renderer holds **no** copy of the subcommand vocabulary (grep: `reauth`
  appears in the renderer only in the settings action union and the contract
  enums), so a verb in the argument is unparseable there by construction.

The backend does validate the shape — `routes/desktop_sessions.py:664-679`
refuses more than two parts or an unknown verb — but that path is only reached
when the command is **posted** (`sessions.command`), and the `navigate`
short-circuit means `/mcp` never is.

### 1.3 The only search the operator could find does not cover MCP servers

The screenshot the operator attached is the **provider grid**: `placeholder
"Search providers"`, empty state `"No providers match this search."` + `Clear
search` (`features/providers/provider-grid.tsx:121-146`, verbatim match on all
three strings). No surface in Settings searches MCP servers:

- the settings page's only searchable section is Backend settings, fed by
  `?filter=` (`settings-page.tsx:405-408`, `:1146`) and scoped to the backend
  settings registry;
- the MCP section has no filter at all;
- `/settings?filter=hubspot` selects no section (only `?section=` / `?setting=`
  do, `:570-578`), so a user who tries that lands on General and sees nothing.

So "hubspot" typed into the one search box on that page finds nothing, and the
correct reading of the operator's third clause ("missing a proper query for all
available MCPs") is *missing an affordance that enumerates and filters the
configured servers*, not a missing backend query — the read already returns all
of them (§ 1.5).

### 1.4 With no active session the section is a dead end

`McpManagementSection` gates on `sessionId = activeSessionId`
(`settings-page.tsx:342-344`), and without one renders a single line, "Open a
conversation to manage its MCP servers." (`mcp-management-section.tsx:355-367`).
That is a true statement about the wire — both MCP ops are session-scoped
(`shared/desktop-contract.ts:650-688`; routes `routes/desktop_lifecycle.py:107-155`)
and even the cold branch needs a session id, because it derives the config set
from that session's cwd (`:111-134`, `bridge.remote.frontend_state.cwd`). There
is **no list-all/sessionless read**, and the section says so in words but gives
the operator no way forward from a page whose whole purpose is "find your
servers".

This is a real gap even though it may not be what the operator hit (their chat
was open). It is cheap to close in the UI (§ 2.5), and leaving it means the
discoverability fix fails for anyone who opens Settings first.

### 1.5 What is *not* wrong

Measured on this host with the repo's venv, against the operator's real config —
the read enumerates everything, and the row model is adequate:

```sh
cd ~/local-operator && .venv/bin/python - <<'PY'
import json, os
from local_operator.mcp.config import load_all_mcp_configs, owned_scope_for_source
from local_operator.mcp.desktop import public_server_config
configs, sources = load_all_mcp_configs(os.path.expanduser("~"))
for name, cfg in configs.items():
    print(name, json.dumps(public_server_config(cfg)), owned_scope_for_source(sources.get(name), os.path.expanduser("~")))
PY
```

Twelve servers come back (`cloudflare datadog gitlab google-workspace hubspot
linear notion slack openaiDeveloperDocs launchdarkly minerva-qa`), each with
`owned_scope` (`project` for the `.mcp.json` ones, `null` for the
`.codex/config.toml` imports), `source`, `transport` and `tool_count`. `hubspot`
is `transport: http`, `transport_oauth_supported: null`; the stdio server
(`google-workspace`) is `false`. So no new backend query is needed for the
enumeration, and `mcp.list` is already cold-safe.

Two smaller things the read *does* settle for us, both measured:

- `transport_oauth_supported` is `null` for **every** http server, including one
  with an explicit `auth: {"type": "oauth"}` block — `public_server_config`
  returns `False` only when `server_rejects_oauth` says never, and `None`
  otherwise (`mcp/desktop.py:104-116`, `mcp/auth.py:1658-1681`). "Unknown" is
  therefore the normal state, and § 3.3 is written for it.
- `environment_keys` / `header_keys` come back as **names only** (`slack` →
  `header_keys: ["Authorization"]`) — enough to seed a key-entry form's field
  list, which matters for § 3.4.

---

## 2. Finding a server (discovery)

### D1 — One module owns the MCP list query, and both surfaces read the payload. **Fix 1.1 first; nothing else is trustworthy until it is done.**

New `src/renderer/src/shared/api/local-operator/mcp-list.ts` holding `mcpKeys`
(moved out of `mcp-management-section.tsx`), `type McpListPayload = DesktopMcpState`
(re-exported from `shared/desktop-control-contract.ts`, which already declares
`servers`, `operations`, `cold`), and

```ts
export const fetchMcpList = async (sessionId: string): Promise<DesktopMcpState> =>
  (await desktopResult<{ data: DesktopMcpState }>({ op: "mcp.list", sessionId })).data;
```

`use-mcp-servers.ts` drops its local `McpListPayload` and its inline `queryFn`
(`:150-152`, `:163-171`) and reads `query.data?.servers` / `query.data?.operations`;
`mcp-management-section.tsx` drops `mcpKeys` and its inline `queryFn`
(`:94-96`, `:275-289`) and calls the same helper.

- Cache key: **unchanged** (`["desktop","mcp",sessionId]`) — invalidation
  callers (`mcp-management-section.tsx:310`, `use-mcp-servers.ts:196-200`) keep
  working, and one key for one document is still right.
- Why a new file rather than exporting from the settings feature: the chat
  feature already imports **up** into settings (`use-mcp-servers.ts:81`), which
  is the direction that let two shapes drift. The key and the fetch belong in the
  shared api layer, where a third consumer cannot invent a third shape.
- Test that pins it: a `scripts/mcp-list-query.test.mjs` that runs both
  consumers' expectations against ONE fixture cache value (see § 6).
- **Trade-off accepted:** the panel now also carries `operations` in its row
  derivation, which is new behaviour (§ 3.5) — this is the same change, not a
  second one.

### D2 — `&mcp=` is resolved against the loaded list, not parsed as a grammar.

Keep the route shape exactly as it is (`picker-registry.tsx:102-106`), including
`&mcp=<value>` as one encoded value: PR #143 (`feat/composer-slash-parity`,
head `68aa1f13b`) adds an optional `inline` field to `DESTINATIONS` entries and
makes a click on a command row RUN the destination, and it does not touch this
route's shape. Two query params would also be a second thing to keep in sync.

Resolution lives in `mcp-management-section.tsx`, next to the list it needs:

1. if the value is exactly a configured server name → that server;
2. else, split on whitespace and take the **last** token that is a configured
   server name → that server (covers `reauth hubspot`, `login notion`, and any
   future verb);
3. else → the miss state (D3).

- **Rejected: parse the verb in the renderer.** It would mean a second copy of
  `MCP_SUBCOMMANDS` in the renderer, which `docs/desktop-controls.md` forbids
  in as many words ("the shared slash registry alone defines the command list;
  never author another list in the renderer") — and it still could not resolve a
  name the payload does not carry. Resolving against the payload needs no
  vocabulary at all.
- **Rejected: post the command to the backend and use the native action's
  `selection`.** `/mcp` resolves to a `navigate` destination
  (`slash-dispatch.ts:239-242`), so the round trip would exist only to hand back
  the same raw string (`server/utils/desktop_commands.py:147-153`).
- The deep link must **not** auto-start a grant: a navigation that deletes a
  stored credential and opens a browser tab is an action the user never
  confirmed, and it would auto-open the confirm dialog. Landing on the revealed
  row with the remedy control focused is the whole job.

### D3 — A miss is stated, never silent.

The effect's silent `return` (`:300`) becomes a state: when a `&mcp=` value is
present and no server matches it, the section renders one `text-body-sm
text-ink-muted` line above the list, naming what was asked:

> No MCP server matches "reauth hubspot".

(The interpolated value is the raw argument, `ink-muted`, quoted.) The list still
renders below it — the section's job is to show the servers, and the miss line is
the answer to the deep link. Sentence case, one sentence, terminal period, which
is this page's own voice (`"No providers match this search."`).

### D4 — The section gains its own filter, and the settings search index does not gain MCP servers.

A `Search`-icon `Input` with `placeholder="Search MCP servers"` /
`aria-label="Search MCP servers"` at the top of the section, filtering the
rendered rows by name client-side, with the provider grid's empty state shape
reused verbatim (`"No MCP servers match this search."` + a `Clear search`
button). It appears whenever the read returned at least one server — no
threshold — because "search for the name I know" is the gesture that failed.

- **Rejected: index MCP servers into the settings search.** `BackendSettingsSection`
  is a typed-editor registry over backend settings keys (`?filter=` feeds it), and
  MCP rows are a session-scoped live read with a runtime status column. Two data
  sources in one index is exactly the second-answer problem this section was
  built to avoid; it would also put a row that can be `auth-required` into a list
  whose rows are static.
- **Rejected: add MCP rows to the provider grid.** A provider is not a server;
  the operator's screenshot is evidence of the confusion, not of the fix.

### D5 — With no active session, read the newest conversation and say so.

When `activeSessionId` is null, the section calls the store's own
`fetchSessions()` (`shared/store/canonical-sessions-store.ts:471`, `:551`) — the
action the chat sidebar already uses (`chat-sidebar.tsx:172`) — and uses the
newest roster row's `session_id` (`CanonicalSessionRow`, `:27-40`, which carries
`title`) for the read, replacing the dead-end line with:

> Showing MCP servers for {title or first 6 chars of the session id}, your most recent conversation. Open a conversation to see its own list.

- **Why the fallback rather than a session picker:** the section's content is
  configuration, and the config set is cwd-derived but the *user* config is
  included for every cwd, so the newest conversation's list is the right answer
  for "which of my MCP servers exist" in every case that matters. A picker is a
  second navigation step in front of a list, for a page the operator reached to
  *look* at something.
- **Honesty requirement, and it is why the sentence names the conversation:**
  statuses are that conversation's runtime's, and `disconnect` is per-session —
  while a grant is not: `~/.local-operator/auth.db` is shared and
  `revalidate_auth_blocked` lifts a peer's block when the grant moves
  (`mcp/manager.py:3050-3075`), so a reauth from any conversation heals all of
  them. The note names the conversation; it must not imply the credential is
  that conversation's.
- The active-session path is unchanged, and the cold state still renders as § 7.2
  describes it ("No session is running — server status cannot be checked.").

---

## 3. Fixing a server from the run panel

The operator's second ask, and the amendment to § 7's "the panel is a VIEW"
(§ 4). Three things must be decided before the row can change: which action, what
the row looks like while it runs, and what happens when the action is impossible.

### 3.1 The row gains one control, and it is a link, not a filled button.

The remedy line (`run-detail-mcp.tsx:203-210`) stops being a sentence and becomes
the row's action line: a `Button variant="link" size="sm"` (button.tsx:176-180)
carrying the app's own control words, plus a `Cancel` in the same weight while a
grant is running.

- Why a link and not `secondary`/`ghost`: the row's geometry is pinned by
  `docs/run-sidebar.md` § 8 (32px, 48px with a remedy, up to 80px with the
  diagnosis), and a `size="sm"` button is `h-7` — it would push the control line
  from 16px to 28px and grow every problem row's height budget. A link keeps the
  20px line, is unmistakably a control (accent ink, underline on hover, the
  app's `outline` focus ring), and keeps the row itself un-hover-lit.
- Why not a clickable row: the row holds two possible actions (grant, reconnect)
  and a status, so "click anywhere" has no single meaning; and the row is not a
  control today (§ 7.2), so making it one would be a second interaction grammar
  in the same list.
- The remedy line's existing text remains for the states the panel cannot act on
  (§ 3.3), which keeps § 7.2's rule that a fix the reader cannot find is not a
  hint.

### 3.2 `auth-required` with a browser sign-in available: grant in place.

**The press.** Confirm first, because the backend's `reauth` is destructive
before it is constructive: `run_grant` deletes the stored row and disconnects
before it re-consents (`mcp/grants.py:193-211`), and the MCP control refuses
without `confirmed: true` (`mcp/desktop.py:59-60`). One `ConfirmationModal`
(`@shared/components/common`, `confirmation-modal.tsx:11-24`), held **once** at
the section (`RunDetailMcp`), not per row, so one confirm implementation exists in
the pane — this is the part of § 7.6 that still holds.

- Title: `Grant account access to {name}?`
- Message: `Your browser opens to approve access. A stored credential for this server is replaced.`
- Confirm: `Grant account access` (not dangerous-styled: the op is recoverable by
  completing the consent, and `DangerButton` is for the destructive-without-remedy
  class).

**The run.** `mcp.control {action: "reauth", name, confirmed: true}` returns the
operation (`mcp/desktop.py:230-259` → `{id, name, action, status, created_at,
credential_removed}`, 300 s budget, one grant per server and one grant per session
at a time: `:158-160`). **No `openAuthorization` call is needed and none may be
added:** the runtime opens the browser itself
(`mcp/auth.py:2317` in `redirect_handler`, via `open_browser_quietly`, `:626`);
the `openAuthorization` IPC resolves its URL from `auth.status`
(`main/desktop-ipc.ts:190`, `provider-detail.tsx:231`) and would fail for an MCP
operation id.

**Polling.** The list the panel already polls carries the operations:
`MCPDesktop.snapshot()` returns `operations` (`mcp/desktop.py:152`), so the row's
grant state is derived from the read that is already running at 5 s while the
panel is open (`use-mcp-servers.ts:87`, `:185-193`) — no second query, no timer.
`operations.status` per server, newest by `created_at`:

| operation state | the row's action line |
| --- | --- |
| `running` | `Waiting for your browser` + `Cancel` |
| `complete` | the line clears; the next read shows `connected` and the tool count |
| `failed` | `Sign-in failed` + `Try again` |
| `cancelled` | `Sign-in cancelled` + `Try again`; append `The stored credential was removed.` when `credential_removed` is true |

- `Cancel` posts `{action: "cancel", operation_id}` (`mcp/desktop.py:154-166`),
  which cancels the backend task; the `credential_removed` flag is why the
  cancelled copy must be able to say the credential is gone — `grants.py:168-175`
  records that a cancel between the delete and the reconnect leaves the server
  with no credential, and saying "cancelled" alone would send the user to a
  server that cannot connect.
- A **terminal** operation is only rendered while the row is still a problem and
  it is the newest operation for that name; otherwise it is the status-derived
  remedy again. Without that rule a `failed` op sits under a live `connected` row
  until the backend evicts it (64 ops, `mcp/desktop.py:222-228`).
- The POST's own response is used only for instant feedback; the list poll is the
  rendering source, because the pane must also show a grant started elsewhere
  (the TUI, another session).

### 3.3 The OAuth-vs-key decision, including the unknown case.

Decided from the row's payload, in this order, with no new op:

1. `transport === "stdio"` or `transport_oauth_supported === false` → **never**
   offer the browser control. This is `server_rejects_oauth`
   (`mcp/auth.py:1658-1681`): a stdio child, or a config that declares another
   `auth.type`, where a browser flow is a hard refusal
   (`mcp/desktop.py:196-201`). The row keeps words:
   `— Manage this server's credentials in Settings`.
2. `http` and `transport_oauth_supported === null` → the normal case (§ 1.5);
   **offer the control**. The press runs the confirm, then `reauth`. If that
   comes back refused (HTTP 409) and no operation is running, the panel runs
   **one `probe`** (`mcp/desktop.py:196-200`) to learn why, and shows either the
   1-case wording (probe false) or `This server refused the sign-in. Check its
   configuration.` (probe true). The probe result is remembered for that row in
   component state, so the next press goes straight to the right wording.
   - Why probe on the failure path only: the happy path pays one round trip, and
     the refusal is explained instead of quoted. There is nothing to quote but a
     guess: the runtime reduces every refusal to a bounded code
     (`{"code": "mcp_control_refused"}`, `session/runtime/serving.py:2931-2940`)
     and the route replaces it with one fixed sentence before it crosses HTTP
     (`routes/desktop_lifecycle.py:148-155`), so the renderer holds a status and
     that sentence and cannot tell "not an OAuth server" from "a grant is already
     running" — which is precisely the pair § 3.6 must keep apart. Printing it is
     the unhelpful-copy class `branding.md` § 8 refuses.
3. Any word this build has not been taught → no remedy (unchanged, § 7.2).

### 3.4 The key case: the popout SHIPS, and its write path is a backend dependency.

**Amended in the remediation round, because the original text below described a
different PR than the one that ships.** The operator overrode the deferral: the
popout is in this PR, in its own final commit so it can be split off. What
follows is what actually ships, then the original reasoning, which is still the
reason the write path is a dependency rather than a detail.

**What ships** (`run-details/mcp-key-dialog.tsx`,
`use-mcp-remedy.pressKey`, opened by the shared flow in `mcp-auth-dialog.tsx`):
one password field per **secret-reference ID the backend declares**
(`secret_refs: [{id, bindings}]`, `mcp/desktop.py` — metadata only, never a value
and never a template), written through a DEDICATED owner op
(`mcp.credentials.store` → `POST /v1/desktop/sessions/{id}/mcp/credentials`) into
the **encrypted secret store**, then the server reconnects through
`mcp.control {action: "connect"}`.

**Two corrections to what this document first described**, both from the
integration review round:

1. The fields are the reference IDs, not `environment_keys`/`header_keys`. Those
two are the config MAP KEYS — the destination a value is bound INTO — so a form
seeded from them wrote `Authorization` while the resolver read
`${HUBSPOT_TOKEN}`, and the save looked successful while the reference stayed
unresolved (R2-2). `secret_refs` is deduped by ID, and a backend that sends no
refs yields NO fields rather than a guessed binding.
2. The write is `mcp.credentials.store`, not `credentials.update`. The latter is
the PROVIDER credential surface, it writes the legacy plaintext
`credentials.env`, and it accepts any key name — which is precisely how the wrong
ID above could be stored at all (R2-3). The MCP op validates every submitted ID
against the server's own declared references BEFORE writing anything, requires
explicit confirmation to replace an existing (possibly shared) value, and the
legacy file is read-only compatibility for MCP references rather than a write
target.

**A save is never reported as a connection.** The sheet closes only on a
`connected` row; a refused, partial, unconfirmed or merely-saved-but-unauthenticated
outcome keeps the form mounted with the user's input intact and the backend's own
sentence beside it (R2-5).

**What it does NOT do:** it writes no configuration. No `add`, no `env`/`headers`
map, no scope — the panel's rule (`§ 7.2` amended) holds, and the op that a popout
*had* to avoid is exactly why: `mcp.control` accepts `env`/`headers` only on `add`
(`mcp/desktop.py:59-60`, `:62-88` — "Configuration fields are only accepted by
add"), and `add` refuses a name that already exists (`:174-176`).

**What it depends on, and how the copy stays honest on both backends.** Nothing
in `main` expands a `${NAME}` reference in the MCP path: the stdio child is built
as `get_default_environment() | CHILD_QUIET_ENV | dict(cfg.env or {})`
(`mcp/manager.py:747`), where `get_default_environment()` copies six allowlisted
variables (`manager.py:569-577`) and the config's map is merged last and wins — so
`{"TOKEN": "${TOKEN}"}` reaches the child as the literal string, and a repo-wide
grep for a resolver (expandvars, a `${…}` regex, a prefix strip) finds none. The
parallel backend change that enables it is `damianvtran/local-operator` **PR
#1125**.

Because that PR may land after this one, the surface claims nothing it cannot
keep: the dialog's line promises what it DOES ("Saved to the encrypted secret
store, then this server is reconnected"), and the OUTCOME is derived from the read
— `pressKey` judges the returned snapshot's own row rather than the request's
status (`manager.reconnect_server` swallows failures and returns `None`,
`manager.py:1671-1679`), so a backend that cannot resolve the reference says the
key was saved but the server is not connected, and the dialog stays open. A
backend too old to publish `secret_refs` and `mcp_auth` offers no key form at all
and says to update the backend for secure key entry, rather than falling back to
a plaintext write. `run-sidebar.md` § 13 carries the same coupling.

---

The original reasoning, kept as the record of why the write path is a dependency:

- The credential dialog (`credential-dialog.tsx`, `CredentialDialogProps:40-52`)
  is bound to `CREDENTIAL_MANIFEST` and writes the owner secret store
  (`sessions.credential`); it is not the config's `env`/`headers` map, and the
  section's own copy already tells the user secrets are "referenced from the
  credential manager".
- The config stores a *reference*: `public_server_config` publishes
  `environment_keys`/`header_keys` names only, and `desktop.py:85` requires
  `"${NAME}"`-shaped values (the paragraph above quotes the missing resolver),
  which is why the popout stores a credential the runtime only reads once PR
  #1125 lands.

- **The panel would notice if it changed:** `environment_keys`/`header_keys` are
  already on the row payload, and the popout is pre-seeded from them with no new
  read.

### 3.5 `disconnected`: reconnect, not reauth.

`disconnected` is transport-level, and the shipped control for it is
`connect` → `manager.reconnect_server` (`mcp/desktop.py:203-205`, awaited inline,
no operation, returns the snapshot). The row's action line becomes a `Reconnect`
link that posts it and writes the response into the cache
(`queryClient.setQueryData(mcpKeys.list(sessionId), …)`, the same shape D1
normalises), so the row settles without waiting for the next poll. Turning the
row's existing "Reconnect this server in Settings" into a control is the whole
change; no confirm (the op is not in the `confirmed` set, `mcp/desktop.py:58-59`).

### 3.6 Concurrent grants: the other rows' controls go disabled, not dead.

The backend allows one grant per session (`if self.running: raise … "Wait for the
active MCP grant or cancel it first"`, `mcp/desktop.py:158-160`), so while any
operation is `running`, every other row's remedy link is `disabled` — colour, not
opacity (`branding.md` § 6) — which is the disabled style the Button primitive
already carries. Why disable rather than let the press refuse: the refusal is the
opaque 409 of 3.3-2, and a dead control is a better answer than an unhelpful
sentence.

### 3.7 Plumbing, named exactly.

- `deriveMcpServers(rows, errors, operations?)` gains the operations list and
  fills two new `McpServerRow` fields: `oauthSupported: boolean | null`
  (from `transport_oauth_supported`) and `grant: McpGrantState | null`
  (`{id, action, status: "running"|"complete"|"failed"|"cancelled",
  credentialRemoved: boolean}`), plus `transport` for 3.3-1. All pure; pinned in
  `scripts/run-detail-model.test.mjs`.
- `McpServerRow.hint` becomes `remedy: {kind: "grant" | "reconnect" | "words",
  label?: string}` — one field, three cases, so a row cannot render a control and
  a sentence at once.
- New `use-mcp-remedy.ts` beside `use-mcp-servers.ts`: `{press(row), cancel(opId),
  pending, refusal}` over `desktopResult({op: "mcp.control", …})`, plus the
  `probe`-on-refusal path of 3.3-2. It reports into the same query key D1 owns.
- The confirm target and the pending press live in `RunDetailMcp` (one dialog,
  one state), because `RunDetailsPanel` and `RunPanel` are presentational and
  should stay so.
- `chat-page.tsx:263-291` calls both hooks and threads `onMcpRemedy` down
  through `ChatContent` → `RunPanel` → `RunDetailsPanel` → `RunDetailMcp`.

---

## 4. The design-contract amendment

`docs/run-sidebar.md` § 7 and its satellite entries currently refuse this control
by design: `run-detail-mcp.tsx:9-14` and `run-detail-model.ts:1386-1398` ("The
panel is a live VIEW: it must not grow a reauth button"), § 7.5's ratified "no
control on the row; a hint-not-control remedy" (line 139), § 7.6's row "A
`reauth` / `connect` control on the row" (line 1279), and § 13's "Restoring a
control (reauth / connect / reload) to the MCP row" (line 1822).

**Replacement text for the § 7.2 rule** (the bullet "The hint names the Settings
control, not the TUI's verb", lines 118-124, and the § 7.6/§ 13 entries):

> **The remedy is actionable in place, and the panel still does not own
> configuration.**
>
> A problem row's remedy is a control when this surface can carry it out: a
> browser sign-in (`mcp.control {action: "reauth", confirmed: true}`) and a
> reconnect (`{action: "connect"}`), plus `cancel` for a grant already running.
> Those three are operations the BACKEND owns and runs; the panel starts them,
> watches them in the read it already polls (`mcp.list` returns `operations`),
> and cancels one. It never writes configuration: no add, no remove, no reload,
> no scope, no credential — those stay where the configuration lives
> (`settings/components/mcp-management-section.tsx`), and the row's copy still
> names that surface for every state this control cannot fix.
>
> The rule the old refusal protected is kept, not repealed: **there is still one
> place that owns the confirmation, the scope and the error copy.** The
> confirmation is the shared `ConfirmationModal`, held once at the section rather
> than per row, and both surfaces' controls speak the same control vocabulary
> (`Grant account access`, `Reconnect`) so one state cannot acquire two
> spellings. What was refused before was a second PLACE to get those facts wrong;
> what changed is that the panel now holds the same place's copy, not a copy of
> its own.
>
> The remedy is a `link`-variant control on the row's second line, never a
> clickable row and never hover ground: the row still takes no hover step
> (`§ 4`), because its neighbour's hover means "this opens a page" and this one
> does not.
>
> Where the action is impossible — a stdio server or one whose config declares
> another `auth.type` (`server_rejects_oauth`), and any status word this build
> does not know — the row keeps the sentence, in the app's own control
> vocabulary. A fix the reader cannot find is not a hint, and a control that can
> only be refused is not a fix.

**Three satellite edits, same PR, so the doc has one voice:**

1. § 7.5's ratified list (line 139): strike "no hover ground and no control on
   the row; a hint-not-control remedy" and add instead "no hover ground on the
   row; the remedy is a link control under § 7.2's amended rule, and the
   confirmation is the shared modal, held once at the section."
2. § 7.6 (line 1279): replace the row "A `reauth` / `connect` control on the row"
   with the refusals that survive: a *configuration* control on the row (add,
   remove, reload, scope, credential entry) and a clickable row (they carry no
   single action).
3. § 13 (line 1822): delete "Restoring a control (reauth / connect / reload) to
   the MCP row", and record the key-entry popout as SHIPPED — with the backend
   reference-expansion change (`local-operator` PR #1125) it depends on. **The
   overridden deferral**: the operator's override for this PR put the popout in,
   so the row that was drafted here as a deferral is the shipped one (§ 3.4,
   amended).

---

## 5. Backend contract needs

**The PR is UI-only, and that is honest for everything the operator asked to
*use*:** the list read, the grant, the reconnect, the cancel, the probe, the
operations feed and the cold-safe read all ship today. The browser opening is the
runtime's own (`auth.py:2317`), so no new IPC is involved.

Four gaps are real, all in `~/local-operator` (a different repo, therefore a
different PR), and none of them blocks this one. Smallest fix each:

1. **`mcp.list` carries no reason.** The panel currently takes a problem row's
   diagnosis from the canonical projection (`use-mcp-servers.ts:126-149`,
   `run-detail-model.ts:1418-1441`) because the route sends none. The smallest
   fix is an `error` string per server in `MCPDesktop.snapshot()`, sourced from
   the manager's own last failure. Not needed for this PR; the projection path
   already renders a diagnosis.
2. **Every control refusal crosses as one opaque sentence.** `serving.py:2931-2940`
   collapses every `ValueError` to the bounded code `mcp_control_refused`, and the
   route then replaces even that with one fixed string, so a client sees a 409 and
   a sentence that fits none of the three causes (`routes/desktop_lifecycle.py:148-155`).
   The smallest fix is to carry a bounded reason token (e.g. `not_oauth`,
   `grant_running`, `unknown_server`) in the detail, so a UI can state the refusal
   instead of probing for it (§ 3.3-2) — with the copy staying the UI's problem,
   which is right.
3. **No write path for an existing server's `env`/`headers`.** `add` is the only
   action that accepts them and it refuses an existing name. The smallest fix is
   a `set-secret` (or widened `add` with `existing: true`) action accepting
   `${NAME}` refs and writing only an owned scope — this is what unblocks the
   operator's API-key popout, and it should come with the `${NAME}` reference
   actually being expanded at connect time (`mcp/manager.py:747`, § 3.4).
4. **No sessionless or cwd-scoped read**, so a Settings visit with no open
   conversation has to borrow the roster (D5). The smallest fix is a
   `GET /v1/desktop/mcp?cwd=…` reusing `MCPDesktop.snapshot`'s config branch
   (which already works without a runtime, `desktop_lifecycle.py:111-134`). Worth
   having; not worth blocking the UI on.

Recorded, not filed: this team does not open follow-up issues, so 1-4 live in the
PR thread as `deferred — <reason>` and in this brief's § 7.

---

## 6. One PR, and what each reviewer needs

**Split: one PR** (`feat/mcp-auth-experience`, the branch that already exists), in
five commits so review can go one at a time:

1. `fix(settings): read one MCP list shape from one shared query` — D1, plus the
   new `mcp-list-query.test.mjs`.
2. `feat(settings): resolve the /mcp deep link against the configured servers,
   and filter the list` — D2, D3, D4, D5.
3. `feat(run-panel): derive the MCP grant state from the list's operations` —
   model fields, `deriveMcpServers` third argument, model tests.
4. `feat(run-panel): grant, reconnect and cancel an MCP server in place` — the
   link control, the shared confirm, `use-mcp-remedy.ts`, plumbing, `probe` on
   refusal.
5. `docs(run-sidebar): the panel's remedy is actionable in place` — § 4, with the
   code comments in `run-detail-mcp.tsx` and `run-detail-model.ts` amended in the
   same commit.

Why not two PRs: the discoverability fix and the in-place fix are two halves of
one flow ("find the broken server, fix it where you saw it"), the deep link's
name resolution is shared by both, and a split would put the same
`deriveMcpServers` signature change in the second one anyway. Size is the cost;
the commit order is the mitigation.

### Quality gates before review

`pnpm lint`, `pnpm check-types`, `pnpm check-themes` (a new component with its own
fill/border must be added to `CONTROLS` in `scripts/contrast-contract.mjs` —
the link variant reuses the Button's, so likely nothing to add, but check), and
the narrowest suite that covers the change:
`node scripts/run-desktop-tests.mjs scripts/run-detail-model.test.mjs
scripts/picker-feedback.test.mjs scripts/mcp-list-query.test.mjs`. Full
`test:desktop` before merge. TUI-booting tests need
`env -u NO_COLOR TERM=xterm-256color`.

### Reviewer (code)

The diff plus the amended § 7; the one thing worth a hard look is D1 (a cache
shape change touches two surfaces and every invalidation caller) and the rule in
§ 3.2 for when a terminal operation stops being rendered. `### Agent review —
round <N>` with `Reviewer:` and `Scope:` lines, as always.

### QA (independent, real execution)

Isolated config dir (`LOCAL_OPERATOR_CONFIG_DIR`, the backend's own config root —
`local_operator/paths.py:26` — so nothing here touches the operator's real servers)
holding a fixture `mcp.json` with:
an OAuth http server pointing at a local test authorization server, a
header-auth http server, a stdio server, and a server whose command does not
exist (`/nonexistent/definitely-not-a-binary`, for the diagnosis line). Matrix
rows, each with surface, command, actual output and PASS/FAIL:

| # | surface | exercise |
| --- | --- | --- |
| Q1 | Settings → Integrations, chat open | the 1.1 ordering bug: open the section within 10 s of a panel tick — the list must render, not "No MCP servers configured yet" |
| Q2 | composer | `/mcp <name>` reveals and steps the row; `/mcp reauth <name>` does the same and starts nothing |
| Q3 | composer | `/mcp nosuchserver` states the miss line, list intact |
| Q4 | Settings, no conversation open | the newest-conversation fallback, with the note naming it |
| Q5 | Settings section | the filter narrows; `Clear search` restores the list; a filtered miss is a different line from the deep-link miss |
| Q6 | run panel, OAuth row | press → confirm → the browser opens (runtime's own) → row shows `Waiting for your browser` + Cancel → consent → row `connected` with a tool count |
| Q7 | run panel | cancel mid-grant → `Sign-in cancelled`; when the credential was deleted, the extra line; verify against `~/.local-operator/auth.db` that the row is gone |
| Q8 | run panel, header-auth row forced to `auth-required` | no browser control is offered; the row keeps the words and points at Settings |
| Q9 | run panel, two problem rows | while one grant runs, the other's link is disabled (colour, not opacity) |
| Q10 | run panel, stdio row `disconnected` | `Reconnect` reconnects and the row settles without waiting for the next poll |
| Q11 | run panel | a `failed`/`cancelled` operation is not rendered under a row that is `connected` |
| Q12 | regression | the 15 s closed / 5 s open cadence, the window-hidden stop, the single-tick-in-flight guard, the trigger dot and its acknowledgement set are unchanged; the settings section's connect/disconnect/reload/remove still work |

QA never edits the repo; verdict as `### QA report — round <N>`.

### Designer (user-visible)

Rendered frames, before and after, of: a problem row with the link at rest,
hovered and focus-visible; the row in all four grant states; the confirm dialog;
the Settings section with the filter, the deep-link miss, and the no-session
fallback — in `localOperatorLight` and `localOperatorDark` at minimum, and at the
320px pane floor as well as 420px. The panel's frames come from new fixtures in
`run-details.stories.tsx` (no transport mock needed — the panel is
presentational); the Settings section needs a new story file whose decorator
stubs `window.api.desktop.request` (`.storybook/preview.tsx` mocks `window.api`
but has no `desktop` member). Add every new story to `STORIES` in
`scripts/capture-evidence.mjs` — the list is the review surface, and a story
missing from it is a surface nobody looks at. `### Design review — round <N>`
with `D`-findings.

### UX-reviewer (interaction change)

The flow changed, so it walks the real flow: find a broken server from the panel
→ press → confirm → consent in the browser → back to a healed row; and the
Settings path with the deep link. `U`-findings.

### Where regression risk is highest

1. **`use-mcp-servers.ts` polling** — the module-level `ticksInFlight` guard
   (`:99`), the interval callback's two `false` returns (`:186-193`), and
   `staleTime`. Changing the queryFn must not change them; a longer queryFn (an
   extra unwrap) makes the guard more load-bearing, not less.
2. **The shared key's shape** — D1 is the whole point, and any future caller that
   reintroduces an envelope read breaks it silently again.
3. **`run-detail-model.test.mjs`** — the MCP half of this model is the most
   heavily commented code in the panel, and its assertions are behavioural
   (the negative predicate, the re-arm rule, the cold line, the verbatim word).
   Adding fields must not change those outcomes.
4. **The settings deep-link settle loop** (`settings-page.tsx:570-640`) — the
   ResizeObserver re-scroll is what makes any deep link land at all (UX U3); the
   miss state and the filter add a re-render inside that window, so the scroll
   must still settle on the section.
5. **#143's `inline` field** — a click on a command row RUNNING the destination
   must not turn `/mcp` into something that fires a grant. The route shape is
   unchanged (D2) and the mcp destination has no `inline`; if #143 adds one,
   `mcp` must stay a plain navigate.

---

## 7. Out of scope, explicitly

- **Any backend change**, in this repo or `~/local-operator`: the four gaps in § 5
  are recorded, not fixed here.
- **A credential/API-key popout** is IN this PR, in its own final commit so it can
  be split off if the parallel backend change slips (`§ 3.4`, amended: the popout
  ships, and the `${NAME}` resolution it needs is `local-operator` PR #1125). Its
  copy claims only what it does — store, then reconnect — and its outcome is read
  off the snapshot, so it is honest against a backend with that change and one
  without it.
- **Configuration in the panel**: no add, remove, reload, scope control, or
  transport editing on the run panel's rows.
- **Re-spelling the wire's status words.** `auth-required` stays verbatim
  (`mcp/manager.py:1330-1341`); the human words live on the remedy line only.
- **A push channel for MCP status**, per-server `error` on `mcp.list`, the
  sessionless read: all already deferred by § 13 and unchanged here.
- **A keyboard shortcut** for anything, and the advertised-but-unbound
  `⌘+Shift+C` (§ 13's own deferral).
- **The TUI.** `/mcp`, its subcommands and its band are unchanged.
- **Any version bump, tag or release.** Owned by the window's release owner; this
  PR merges, and the release is a separate one-file PR.

## 8. Risks to watch during rollout

1. **D1 changes two surfaces at once** — if the settings section and the panel
   pass their own tests but disagree in one live screen, the shape drifted again;
   the shared module plus the Q1 matrix row is the guard.
2. **A confirm dialog in a 320px pane** — the modal is elevated and outside the
   pane's flow, but the copy must survive the narrow width; that is a designer
   frame, not an opinion.
3. **The probe-on-refusal path adds a network call on a failure** — it must be
   bounded by the row's existing pending state and must not run for a server
   whose capability is already known false.
4. **One grant per session** — the disabled state must be derived from
   `operations` and not from local state, or a grant started in another surface
   leaves the panel's controls live and every press refuses.
5. **The cancelled-reauth copy** — `credential_removed` is the only thing that
   distinguishes "cancelled, try again" from "cancelled, and your credential is
   gone". Getting it wrong sends the user to a server that cannot connect; it is
   the one copy in this brief worth a test of its own.
