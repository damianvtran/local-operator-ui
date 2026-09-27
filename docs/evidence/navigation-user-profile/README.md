# The sidebar's account row, honest about a failed read

Three states of `UserProfileSidebar`'s foot row, in BOTH brand themes
(`localOperatorDark.webp` / `localOperatorLight.webp`), for the change that stops
a local session with an unreadable account from painting as a generic "User":

| Directory | What it shows |
| --- | --- |
| [`account-reconnect`](account-reconnect/) | The defect's replacement. A local Radient session exists and the account read FAILED (the `isRadientAccountFailure` arm): the row's name line reads "Account unavailable" and its second line is "Reconnect Radient" in the accent ink, because the row's press now goes to the provider surface with Radient preselected instead of the plain settings page. Before this change the same state painted "User" with a blank email. |
| [`account-checking`](account-checking/) | The restoring state, unchanged: the row holds its place while the read is in flight, so a slow read is not mistaken for an empty one. |
| [`account-ready`](account-ready/) | The healthy state, unchanged: the account's name and email. Photographed so the reconnect frame is a delta against a known-good neighbour rather than an isolated opinion. |

## What produced these frames

`src/renderer/src/shared/components/navigation/user-profile-sidebar.stories.tsx`
renders the SHIPPED `UserProfileSidebar` with the props the rail passes it. The
account states come from the production hooks (`use-radient-auth` over
`use-radient-user-query`) running against a stubbed desktop transport
(`window.api.desktop.request`, which `@shared/api/local-operator/desktop-api`
prefers — `backend-settings.stories.tsx`'s pattern), so the frame judges the
state the app actually derives, not a story-shaped stand-in.

```
node scripts/capture-evidence.mjs http://localhost:6417 \
  --only=navigation-user-profile-- \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

The frames are 260x360 viewport captures of the sidebar column (its own width),
two themes, narrowed so every other set's bytes are left alone (`partialCapture`
in the manifest records it).

## What to look for

- **The second line is the affordance, not decoration.** "Reconnect Radient" is
  the accent register this system uses for "there is something to do", and the
  row's press follows it: the same two facts (what is wrong, where the fix is)
  the operator had to infer from a bare "User" before.
- **The row is honest about who is speaking.** "Account unavailable" does not
  claim the session is gone (it is not - the local session exists, which is why
  the row is not the anonymous one) and does not invent a name.
- **Nothing else moved.** The glyph plate, the chevron, sizing and the foot's
  single row are the committed geometry; the delta is the second line and the
  destination.
