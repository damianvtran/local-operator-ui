# The provider sign-in, the Providers page, first run and the empty chat

Thirty-four states, each captured in BOTH brand themes (`localOperatorDark.webp` and
`localOperatorLight.webp`), for the change that makes a provider reachable from the
app: the
Providers settings page (a first run, connected, and a row's overflow menu open),
the sign-in panel in every state it has, the three first-run steps, and the two
surfaces that tell a user with nothing connected what to do about it.

The panel's states are the point of the set, because the defect it fixes was a
state machine rather than a layout: `idle`, `waiting-first-click-released-backend`
(the RELEASED backend's sequence, where the authorization URL arrives on the first
POLL - the sequence the blocked first click was measured on) and
`waiting-url-on-start-reply` (the newer backend, where it is on the POST reply),
`device-code`, the optional-paste flow with its disclosure shut and open, a paste
that IS the flow, `succeeded-with-default` with the backend's defaults receipt,
`expired`, `gone-404`, `failed`, `cancelled-superseded` (another window replaced
this sign-in - a NEUTRAL state, not a failure), `api-key`, `invalid-key`,
`key-saved`, `key-saved-unchecked`, and a local runtime's probe.

Two more exist because a round-1 finding proved they could not be reached: a paste
that is required BEFORE the flow has any URL at all
(`paste-required-no-url`, QwenCloud's Token Plan), and `waiting-launch-url`, the
same waiting screen reached with `launch_url` set beside `auth_url` - it must be
byte-identical to `waiting-url-on-start-reply`, because the backend's loopback
alias must not change a pixel, and `scripts/evidence-sign-in-states.test.mjs` holds
that equality. The first-run set carries the blocked step-2 path as well
(`onboarding-step-2-choose` with a catalogue, `-2-choose-blocked` without a model
chosen).

Three more are the VERDICT REGISTER, which the design rounds added after finding the
settled view could be photographed as a success: `refused-verdict` (the subject of
this frame is the verdict itself, which is why `scripts/capture-evidence.mjs` waits
for `data-verdict="attention"` rather than for the clock, U19), and design round 6's
D2 pair - `succeeded-unconfirmed`, the state a first run actually reaches after a
sign-in the backend will not confirm (`data-verdict="neutral"`), and
`key-refused-verdict`, the API-key route under a refused verdict, which is the route
that contradiction survived on. The count above is measured from this directory
(`ls -d */`), which is the only claim in this file a reader can re-run in one
command - and in the re-run's own words the three are the directories
`panel-refused-verdict`, `panel-succeeded-unconfirmed` and `panel-key-refused-verdict`,
which is why the state names above are the short forms. THE `panel-` PREFIX IS NOT
UNIVERSAL HERE, and the sentence that stood in this place claimed it was: the re-run
prints 34 directories of which 22 carry the prefix, and the 12 that do not are the
onboarding steps and the provider-list states around them (`onboarding-step-1` through
`onboarding-step-3`, `providers-*`, `connect-dialog`, `empty-chat-card`). What is true,
and what the short forms rest on, is that all THREE verdict-register directories carry
it - so a reader looking for the state names in the `ls` output knows to look for the
prefixed ones, rather than for every name in the set (agent review round 2, MINOR 4).

These frames come from `scripts/capture-evidence.mjs` driving Storybook, which is
the committed and re-derivable route. The exact command that wrote them:

```
pnpm exec storybook dev -p 6217 --ci --quiet     # 6017 was another worktree's
node scripts/capture-evidence.mjs http://localhost:6217 \
  --only=provider-sign-in-onboarding-- \
  --themes=localOperatorDark,localOperatorLight --allow-backend --theme-settle-ms=90000
```

`--allow-backend` because these stories stub the whole desktop transport
(`window.api.desktop.request`), so a live backend on 1111 cannot reach a pixel of
them - and the frames this set replaced were taken the same way. The run is
narrowed, so it writes this set and leaves every other set's bytes alone, which is
what `partialCapture` in the manifest records.

Two themes, not the twelve-palette sweep: every state is photographed in the
brand pair a reader compares (dark and light), so a claim about contrast or a
colour step can be checked in both, while the twelve-palette contract stays
`pnpm check-themes`' business rather than this directory's. Per theme the run is
narrowed with `--only=provider-sign-in-onboarding--`, which is what the
`partialCapture` record in the manifest logs.

BEFORE: the surfaces this set replaces are the committed ones of the previous
provider-setup pass - `../onboarding-providersetup/` (the 18-card grid in the
onboarding dialog and in the Settings column) - and, upstream of that pass,
`../provider-setup-ux-before/`.

The design audit that named these states, with the matching BEFORE frames and the
per-state target spec, is the design round's own document on the PR; this
directory is the re-derivable half of it.
