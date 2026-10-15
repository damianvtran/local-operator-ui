# One session-file inventory, three readers

The desktop Finder Files view consumes the backend `session_files: 1` contract
(#2393, `docs/DESKTOP_API.md` in local-operator). Membership, family containment,
highlights and materialisation belong to that service, not to the desktop UI.
The renderer never unions transcript-scan rows into a capable inventory. The
transcript scanner is only a capability-absent fallback, disabled during feature
negotiation and for capable error/building/unsupported answers.

## Desktop

`use-session-files.ts` owns pagination/backfill and cancels stale commits on
session/authority changes or explicit refresh; client-side sort does not restart
pagination. A revision-reset page replaces all privately assembled prior pages;
opaque cursors are never interpreted locally. Polling a building index is bounded
and exposes Continue/Retry, not an indefinite hidden timer. A terminal turn
invalidates the index. Only complete ready generations become visible membership;
initial loading shows indexed-pass progress with no thumbnails, while refresh
keeps the former complete rows until an atomic replacement is ready.

The Finder presentation has Highlights first, working-file disclosure, kind
sections, deterministic mixed-height virtualization, and one roving button/list
keyboard model. It is not an ARIA grid or listbox. Sort, grouping, disclosure and
type filter live in the existing per-user profile store (v4); search is ephemeral.
A persisted filter stays visibly active with a Reset filter action. Pointer/focus
engagement defers new stat/member ordering until the reader leaves the list.

Thumbnail reads are viewport-gated and queued (four concurrent). Only downscaled
PNG thumbnails, bounded to 640 pixels and 150 warm entries, survive virtualization
unmounts. Original image bytes are resolved on explicit lightbox/copy/save actions.
Video bands deliberately do not fetch entire clips just to make a poster: they
reserve the band geometry and say Open to play. This trades a decorative first
frame for bounded I/O on large generated clips; the canvas player remains the
existing full-media viewer. The relay's 32 MiB ceiling is unchanged.

Artifact path actions materialise through the backend only when chosen. Child
attachments retain `session.child_id` and use the parent's children attachment
route; they are never reinterpreted as a local path or guessed child session.

## Mobile / TUI parity (implementation boundary)

Both readers should reuse `local_operator.session_files.service`, not implement
filesystem traversal, transcript parsers or another materialisation routine.
Mobile should consume the same paged `/files` result and capability negotiation.
TUI can consume the service's `display=True` projection for cwd-relative/`~/`
paths; those display spellings are labels, never new identities.

A remote or unresolved index is a remote/unresolved state, not an invitation to
stat the supplied paths on the local machine. Desktop's capable unsupported/409
answer produces no file rows and makes no local probes. Mobile/TUI follow-ups
must preserve that boundary. This PR changes the desktop reader only; it does
not claim rendered mobile/TUI parity or wire `display=True` into a new route.
