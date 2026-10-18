# Sidebar tags — client contract (desktop, TUI, mobile, relay)

**Status:** current as of the merged first slice (core `7c6db02983`, UI
`0c8a39a0e3`), plus the V2-1 `tags_revision`/`expected_revision` precondition
marked **target**. The store is the single source of truth; no client keeps a
second category database. The agent `tags` tool is a V2-4 target, not shipped.

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

Every **local** row from `GET /v1/desktop/sessions` (and every page/cursor
shape) carries:

```json
{
  "session_id": "…",
  "tags": [{"id": "a1b2c3d4e5", "name": "Review"}],
  "primary": "a1b2c3d4e5",
  "tags_revision": "7f3c…"
}
```

- **All three fields are always present.** Untagged is `"tags": []`,
  `"primary": null`; an absent key is not a claim, and a merge-style client
  must let the empty value settle stale optimistic state. `tags_revision` is an
  opaque, monotonic per-session token; clients compare it, never order or parse
  it.
- `primary` is always one of `tags[].id` or null. `tags` is the assignment
  order used for the oldest-surviving fallback; clients must not reorder it.
- Unknown/deleted category ids are omitted by the server on the next read.
- A row appears once. Clients render one primary bucket; they must not
  duplicate a row across its secondary tags.
- Remote/mesh rows may omit `tags`/`primary` in the merged list (the shipped
  `remote_session_rows` does not add them). Clients normalize absent keys to
  `[]`/`null` for display and do not offer tag actions; the server refuses a
  remote assignment with 409 `session_is_remote`.

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
  name if one exists, else creates one. **Exception:** if that live id is
  explicitly claimed by another entry in the same PUT, the name-only entry
  gets a newly minted id instead of reusing it. That is how a rename plus a
  fresh category with the old name is expressed in one desired-state write;
  delete-and-recreate of the same name still needs two writes.
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
              "primary":"a1b2c3d4e5",
              "tags_revision":"8a41…"}}
```

Desired state and retry-safe. `tags` is the full assignment (≤8, distinct known
ids); `primary` is one of them or null. Empty list + null clears. Delegated/
hidden session directories are taggable; mesh/remote writes are refused in the
first slice. A stale/deleted category id returns 422 with no partial write.
The response's `tags_revision` is the revision the write produced; Undo
captures it.

**Response is a post-write re-read, not a promise about concurrent deletion.**
The store re-reads the registry after the write; if another writer deletes a
category in that window, the response may legitimately be `tags: []` /
`primary: null` (or a subset). Clients treat that as a settled row and let the
next catalogue read reconcile it; it is not a failed write and must not be
retried as one.

### Optional `expected_revision` precondition (V2-1 target, additive)

```json
{"tags": ["a1b2c3d4e5"], "primary": "a1b2c3d4e5",
 "expected_revision": "7f3c…"}
```

When `expected_revision` is present, the server compares the session's current
revision under the same store lock and returns **409 `tags_conflict`** with no
write if it differs. The revision increments on any actual assignment change,
not only a value change: a human add-then-clear changes it twice, so a
value-only comparison is not sufficient. Undo sends the revision its own write
returned; auto-tag records the revision at the start of the naming call when the
row was empty and writes only if it is unchanged. Clients that omit
`expected_revision` keep the shipped last-writer-wins behaviour, so this is
backward compatible; mobile may omit it in its first slice. The store's own
compare-and-set uses the same revision; the route field is its client-facing
expression, not a second mechanism.

## Errors

| Status | Code | Meaning |
|---|---|---|
| 401 | — | missing/invalid desktop token |
| 404 | — | unknown session id |
| 409 | `session_is_remote` | remote/mesh target; tag writes are refused |
| 409 | `tags_conflict` | `expected_revision` did not match the current revision; no write |
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

- The desktop UI may group by `primary` inside its existing sections when the
  user enables tags; off means no tag pixels. The TUI and mobile may render a
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
  global `tags/revision` marker is relay-internal projection state and is not
  the desktop per-session `tags_revision`.
- The mobile first slice may omit `tags_revision`/`expected_revision` and keep
  last-writer-wins; if it offers Undo, it must expose and compare the
  per-session revision rather than a value-only snapshot. It does not change
  the desktop contract or `session_tags` semantics.
