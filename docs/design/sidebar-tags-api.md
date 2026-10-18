# Sidebar tags — client contract (desktop, TUI, mobile, relay)

**Status:** current as of the merged first slice (core `7c6db02983`, UI
`0c8a39a0e3`). This is the contract other surfaces consume; the store is the
single source of truth and no client keeps a second category database.

## Capability

`GET /v1/desktop/capabilities` includes `session_tags: 1` when the backend has
the store and routes. A client that does not see the key must render **no tag
UI** and must not call the tag routes. The key is additive; it does not gate
the catalogue.

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

## Category registry

```http
GET /v1/desktop/tags
→ {"result": {"tags": [
     {"id": "a1b2c3d4e5", "name": "Review", "order": 0, "conversations": 3}
   ]}}
```

`conversations` is the count of distinct existing session directories carrying
the category (archived/hidden included; deleted directories excluded). It is
the number a delete confirmation can name; it is not a total across other
clients' offline state.

```http
PUT /v1/desktop/tags
{"tags": [{"id": "a1b2c3d4e5", "name": "Review"}, {"name": "Project"}]}
→ same shape as GET
```

Full desired state, in display order. An entry without `id` reuses the live
category with the same case-insensitive name if one exists; a rename keeps the
id; omitted categories are deleted (assignments become orphans and are pruned
on the next read, conversations are never deleted). Caps: 32 categories,
names 1–24 characters, case-insensitive unique, `Untagged` reserved. A
one-request delete + same-name re-add is not expressible; clients perform two
writes when the user asks to delete and recreate the same name.

## Session assignment

```http
PUT /v1/desktop/sessions/{session_id}/tags
{"tags": ["a1b2c3d4e5", "f6e5d4c3b2"], "primary": "a1b2c3d4e5"}
→ {"result": {"session_id": "…",
              "tags": [{"id": "a1b2c3d4e5", "name": "Review"},
                       {"id": "f6e5d4c3b2", "name": "Project"}],
              "primary": "a1b2c3d4e5"}}
```

Desired state and retry-safe. `tags` is the full assignment (≤8, distinct
known ids); `primary` is one of them or null. Empty list + null clears.
Delegated/hidden session directories are taggable; mesh/remote writes are
refused in the first slice. A stale/deleted category id returns 422 with no
partial write. The response resolves names from the same registry snapshot the
write used; a later category deletion is reflected by the next catalogue read,
not by a false failure.

## Errors

| Status | Meaning |
|---|---|
| 401 | missing/invalid desktop token |
| 404 | unknown session id |
| 422 | unknown category id, duplicate id, >8 assignments, primary not in tags, name/cap violation |

No client-side ID generation: ids come from the server. No client-side name
deduplication as authority: the server refuses duplicates. No auto-creation
from a misspelled name; creation is an explicit `create` operation (UI picker
or agent `tags` tool).

## Agent tool (V2-4)

The `tags` tool is the agent-facing write path: `list`, `create(name)`,
`rename(id, name)`, `assign(session_id, tags[], primary?)`. It uses the same
store and validation as the routes; every result names the category ids/names
and the session, so the tool ledger is the audit trail. Agents may create a
category explicitly; they may never create one from a failed spelling during
assignment.

## Rendering rules

- The desktop UI may group by `primary` inside its Time sections when the user
  enables tags; off means no tag pixels. The TUI and mobile may render a
  compact primary-tag suffix (their own opt-in), never a second grouping store.
- Drag/drop, chips, and assignment dialogs are client interactions over these
  same writes; they do not invent a client-side assignment queue.
- A client that is offline keeps its last rendered catalogue and queues no
  hidden category vocabulary; on reconnect it re-reads the catalogue and lets
  the empty/null rows settle.
