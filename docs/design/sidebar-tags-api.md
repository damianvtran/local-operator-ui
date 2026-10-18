# Sidebar tags — client contract (desktop, TUI, mobile, relay)

**Status:** current as of the merged first slice (core `7c6db02983`, UI
`0c8a39a0e3`), plus the V2-1 `expected` precondition marked **target**. The
store is the single source of truth; no client keeps a second category
database. The agent `tags` tool is a V2-4 target, not shipped.

## Capability

`GET /v1/capabilities` (not `/v1/desktop/capabilities`) returns the standard
`{"status":200,"message":"…","result":{…}}` envelope. The key is:

```json
{"result": {"features": {"session_tags": 1}}}
```

A client that does not see `session_tags: 1` renders **no tag UI** and calls no
tag route. The key is additive; it does not gate the catalogue. The UI reads
`result.features`, not a top-level field.

## Catalogue rows

Every row from `GET /v1/desktop/sessions` (and every page/cursor shape) carries:

```json
{
  "session_id": "…",
  "tags": [{"id": "a1b2c3d4e5", "name": "Review"}],
  "primary": "a1b2c3d4e5"
}
```

- **Both fields are always present.** Untagged is `"tags": []` and
  `"primary": null`; an absent key is not a claim, and a merge-style client
  must let the empty value settle stale optimistic state.
- `primary` is always one of `tags[].id` or null. `tags` is the assignment
  order used for the oldest-surviving fallback; clients must not reorder it.
- Unknown/deleted category ids are omitted by the server on the next read.
- A row appears once. Clients render one primary bucket; they must not
  duplicate a row across its secondary tags.
- Remote/mesh rows carry `"tags": []`, `"primary": null`; the server refuses a
  remote assignment with 409 `session_is_remote`, and the UI does not offer
  tag actions on those rows.

## Category registry

```http
GET /v1/desktop/tags
→ {"status":200,"message":"…","result":{"tags":[
     {"id":"a1b2c3d4e5","name":"Review","order":0,"conversations":3}
   ]}}
```

`conversations` is the count of distinct existing session directories carrying
the category (archived/hidden included; deleted directories excluded). It is
the number a delete confirmation can name; it is not a promise about another
client's offline state.

```http
PUT /v1/desktop/tags
{"tags": [{"id": "a1b2c3d4e5", "name": "Review"}, {"name": "Project"}]}
→ same shape as GET
```

Full desired state, in display order. Entry semantics:

- `{name}` with no id reuses the live category with that exact case-insensitive
  name if one exists, else creates one.
- `{id, name}` with an existing id renames that category; assignments keep the
  id. An unknown id is 422, not an implicit create. Two entries with the same
  id, or a name colliding with a different id, are 422.
- Omitted categories are deleted; assignments become orphans and are pruned on
  the next read. Conversations are never deleted.
- Caps: 32 categories; names 1–24 characters; case-insensitive unique;
  `Untagged` reserved. A one-request delete + same-name re-add is not
  expressible; clients perform two writes when the user asks to delete and
  recreate the same name.

## Session assignment

```http
PUT /v1/desktop/sessions/{session_id}/tags
{"tags": ["a1b2c3d4e5", "f6e5d4c3b2"], "primary": "a1b2c3d4e5"}
→ {"result": {"session_id":"…",
              "tags":[{"id":"a1b2c3d4e5","name":"Review"},
                      {"id":"f6e5d4c3b2","name":"Project"}],
              "primary":"a1b2c3d4e5"}}
```

Desired state and retry-safe. `tags` is the full assignment (≤8, distinct known
ids); `primary` is one of them or null. Empty list + null clears. Delegated/
hidden session directories are taggable; mesh/remote writes are refused in the
first slice. A stale/deleted category id returns 422 with no partial write.

**Response is a post-write re-read, not a promise about concurrent deletion.**
The store re-reads the registry after the write; if another writer deletes a
category in that window, the response may legitimately be `tags: []` /
`primary: null` (or a subset). Clients treat that as a settled row and let the
next catalogue read reconcile it; it is not a failed write and must not be
retried as one.

### Optional `expected` precondition (V2-1 target, additive)

```json
{"tags": ["a1b2c3d4e5"], "primary": "a1b2c3d4e5",
 "expected": {"tags": ["a1b2c3d4e5"], "primary": "a1b2c3d4e5"}}
```

When `expected` is present, the server compares the current assignment under
the same store lock and returns **409 `tags_conflict`** with no write if it
differs. Undo and auto-tag use this to avoid clobbering a manual/agent edit.
Clients that omit `expected` keep the shipped last-writer-wins behaviour, so
this is backward compatible; mobile may omit it in its first slice. The
comparison is over tag ids in assignment order plus primary, not display names.

## Errors

| Status | Code | Meaning |
|---|---|---|
| 401 | — | missing/invalid desktop token |
| 404 | — | unknown session id |
| 409 | `session_is_remote` | remote/mesh target; tag writes are refused |
| 409 | `tags_conflict` | `expected` did not match the current assignment; no write |
| 422 | — | unknown category id, duplicate id, name collision, >8 assignments, primary not in tags, name/cap violation |

No client-side ID generation: ids come from the server. No client-side name
deduplication as authority: the server refuses duplicates. No auto-creation
from a misspelled name; creation is an explicit `create` operation (UI picker
or V2-4 agent `tags` tool).

## Agent tool (V2-4 target — not shipped)

The `tags` tool will be the agent-facing write path: `list`, `create(name)`,
`rename(id, name)`, `assign(session_id, tags[], primary?)`. It uses the same
store and validation as the routes; `assign` takes **category names only**,
matching the shipped `sessions spawn tags`, not a second id spelling. Every
result names the categories and the session, so the tool ledger is the audit
trail. Agents may create a category explicitly; they may never create one from
a failed spelling during assignment. The tool does not exist today; only
`sessions(op='spawn', tags=[...])` is shipped.

## Rendering rules

- The desktop UI may group by `primary` inside its Time sections when the user
  enables tags; off means no tag pixels. The TUI and mobile may render a
  compact primary-tag suffix (their own opt-in), never a second grouping store.
- Drag/drop, chips, and assignment dialogs are client interactions over these
  same writes; they do not invent a client-side assignment queue.
- A client that is offline keeps its last rendered catalogue and queues no
  hidden category vocabulary; on reconnect it re-reads the catalogue and lets
  the empty/null rows settle.

## Mobile relay (separate lane, owner session `4264c9a75553`)

Mobile cannot call `/v1/desktop/*` (different auth/transport). The relay
projects the same store:

- `GET /api/sessions` and the `sessions` SSE frame: every local row carries
  `tags: [{id,name}]` and `primary: string|null`, always present, assignment
  order preserved.
- `GET /api/tags` — read-only catalogue.
- `PUT /api/sessions/{id}/tags` — desired state, empty+null clears; no
  `PUT /api/tags` on mobile (creation/rename stays desktop/agent-only).
- Capability `capabilities.session_tags: {available: true}` on the mobile list
  frame, not the lifted `features.session_tags` (released relays can have the
  store flag without the routes).
- Remote/mesh rows `tags: []`, `primary: null`, writes refused.
- External writes are picked up by the relay's tag-store fingerprint on its
  existing 2 s scan tick; auto-tag adds no extra mobile call. Its additive
  `tags/revision` marker is relay-internal and does not change the desktop
  contract or `session_tags` semantics.
