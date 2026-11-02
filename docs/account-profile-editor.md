# Human Radient profile editor

Settings > Radient account contains a borderless Personal profile panel before
the existing account details, verification reminder, phone access and sign-out.
It edits the supported human account service; no agent id, agent storage or
agent photo hooks participate. Pronouns are deliberately not exposed.

## Transport and account lifetime

The typed `account.profile*`/`account.avatar*` media operations map to fixed
`/v1/desktop/account/profile` and `/v1/desktop/account/avatar` routes. Main owns
the desktop bearer; core owns Radient OAuth. JSON is never a base64 image tunnel
and the renderer cannot name an upstream URL/method/header.

Native reads require `features.account_profile = 1`. Older daemons expose only
an explicit browser handoff to `https://console.radienthq.com/dashboard/account`;
no browser opens on mount. Sensitive email, identity and password administration
always uses that explicit secure browser action.

A loaded snapshot carries an opaque backend login-incarnation receipt. Writes
also pin the existing renderer account authority epoch and captured surrounding
organization-view preference, checking before dispatch and before admitting
results. Auth/view changes unmount the editor, release its bitmap, and prevent
stale success/cache writes. Backend checks capture the exact OAuth row/account
and durable incarnation before refresh and again immediately pre-HTTP/after
response. Post-dispatch rejection cannot undo an already committed cloud write.

## Drafts and transactions

Text sends only dirty fields. Absence is unchanged; an empty string clears a
field. Unicode code-point bounds match upstream. Timezone uses the existing
searchable selection control with no custom-submit path.

Text and photo saves are independent. A photo response never replaces the text
draft. Text is frozen during its own save and adopts the normalized server
response only after success. Failed saves retain the draft. Cancel asks before
discarding changed text; cancelling a crop does not discard text.

The current app uses plain HashRouter, without a shared route blocker. Leaving
and returning retains only dirty text in one bounded, in-memory slot per
QueryClient, keyed by account authority epoch, view and backend receipt. The
slot is cleared synchronously on every auth transition (including A→B→A), view
replacement, successful save or explicit discard. No personal draft is written
to localStorage. Closing/reloading with changes uses beforeunload. This is
**retained-draft behavior, not a navigation-discard confirmation**. Pending
photos/bitmaps are never retained beyond their component; navigation cancels
the crop and releases its decoded image.

## Photos and shared crop seam

The picker accepts PNG/JPEG/WebP up to 1 MiB. Container headers are read before
bitmap decoding to reject edges over 4096 or more than 16 million pixels; the
decoded dimensions are checked again. The cloud repeats full decode, trailing
data rejection and metadata-stripping re-encoding.

`shared/components/avatar-cropper.tsx` owns only interaction/geometry/canvas:
keyboard arrows pan, +/- zoom, 0/recenter resets; drag/wheel/slider are equivalent.
The human caller supplies human labels, a neutral preview and 256px output. The
existing agent wrapper retains its localized labels, exact preview sizes,
AgentAvatar frame, keyboard/zoom behavior and 512px default. Geometry remains in
the already-audited shared helper. The crop fits narrow panels; pointer deltas
are converted back into its logical coordinate space. Framing is frozen during
encoding/upload.

Removing a photo is a separate explicit confirmation, never an automatic side
effect. It states the upstream slot semantics: removing uploaded may reveal
saved provider; removing provider may reveal uploaded; otherwise initials.

## Own-human Bridge affordance

Only the active observed account matching the card's member id, under the
base card's human/agent distinction, gets Edit profile. Message permission does
not establish identity. Unknown viewer, another person and agent cards expose
no edit action. The card closes before the native Settings handoff; its focus
restore is suppressed while the guarded profile section receives focus after
loading. No composer, Bridge page or caller migration is included. The separate
avatar lane's required explicit `kind` contract must be preserved on convergence.

## Evidence boundary

`Settings/Personal profile` stories cover populated/empty/narrow/loading/error,
save/saving/failure/discard, provider removal and crop/failure states.
`Team Bridge/Own profile edit` stories cover exact own/other/agent/unknown
identity and focus handoff. They use synthetic data and no operator account.

`scripts/account-profile.test.mjs` covers transport/dirty fields, pixel admission,
account/view races and draft retention. Existing `agent-avatar.test.mjs` is a
direct regression neighbor. Source/unit checks are not rendered/native evidence;
independent current-head browser design/UX, real HTTP fixture QA, localization
audit receipts and CI remain merge gates. Live cloud integration requires an
explicitly authorized disposable account and is not implied by fixtures.
