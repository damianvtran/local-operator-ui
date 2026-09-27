# The Radient account's verify-to-claim callout

Four states of the account section in Settings, in BOTH brand themes
(`localOperatorDark.webp` / `localOperatorLight.webp`), for the change that tells
an unverified account holder how to claim the signup grant:

| Directory | What it shows |
| --- | --- |
| [`verify-pending`](verify-pending/) | The callout: "Verify your email to claim $5.00 in free credits. Check your inbox for the link Radient sent." with an "Open verification page" action, between the account details and the sign-out block. The amount is the backend's own captured `verification.grant_amount`, rendered through the shipped section. |
| [`verify-expired`](verify-expired/) | The claim window lapsed: "The link to claim $5.00 in free credits has expired. Request a new one from the verification page." with a "Request a new link" action. It is the LINK that expired, not the grant - the verification service's `Reissue` mints a fresh link while the grant is unclaimed (agent-server `signup_verification_service.go`) - so the amount stays and the inbox instruction drops. |
| [`verify-none`](verify-none/) | No grant attached: "No signup grant is attached to this account. Open the verification page to check the account." with an "Open verification page" action, and no amount - the frozen contract attaches `grant_amount` only to pending/expired, and neither the fixture nor the copy invents one (UX round 1, U1). |
| [`claimed`](claimed/) | The ABSENCE. The verification block is present and says the grant is claimed (`email_verified: true`), and the section renders no callout at all — the frame exists so the absence is a photograph rather than a sentence. A backend that sends no `verification` block renders the same absence; that arm is asserted in `scripts/radient-verify-callout.test.mjs` rather than photographed, because the pixels are identical. |

## What produced these frames

`src/renderer/src/features/settings/components/radient-account-section.stories.tsx`
renders the SHIPPED `RadientAccountSection` inside the same `SettingsSection`
header the settings page gives it, against a stubbed desktop transport
(`window.api.desktop.request`, the bridge `desktop-api.desktopRequest` prefers -
`backend-settings.stories.tsx`'s pattern). The account envelope is the shape
`desktop_radient.py` forwards: the desktop `result` around the upstream
`{msg, result}` payload, with `verification` added.

```
node scripts/capture-evidence.mjs http://localhost:6417 \
  --only=settings-radient-account-- \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

Two themes, not the twelve-palette sweep: this is a copy-and-affordance surface,
and the palette contract is `pnpm check-themes`' business. The run is narrowed,
so the frames under this directory are this set's own and every other set's bytes
are left alone (`partialCapture` in the manifest records it).

## What to look for

- **The callout is quiet, and it is not a banner.** It is a hairline-bordered
  `surface` box with the info glyph, one sentence and a secondary button - the
  same register the transcript's own suggestion boxes use - so the account
  fields above it stay the page's subject.
- **The amount is the flow's own.** $5.00 is `constants.DefaultNewCredits`
  captured at issue; the prices endpoint's `default_new_credits` is only the
  fallback for a backend that reports no capture, and the words degrade to "your
  free credits" when neither exists (never to an invented number).
- **Claimed means absent.** No greyed-out teaser, no "already claimed" line:
  the prompt's whole job is asking for a step that is still owed.

ROUND 1 REMEDIATION (UX round 1, U1, 2026-09-27): `verify-expired` is RE-TAKEN
and `verify-none` is NEW. The expired arm no longer promises a claim the state
cannot show and no longer sends the reader to an inbox whose mail expired with
the window; the `none` arm no longer promises an amount the contract never
attaches to it. `verify-pending` (the main case) and `claimed` are untouched,
because their copy and pixels are.
