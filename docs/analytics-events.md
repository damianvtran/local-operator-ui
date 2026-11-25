# Product analytics events

Named PostHog events the desktop app reports, in addition to PostHog's own
autocapture, exceptions and session replay. They exist to make the first-run
funnel a query instead of a replay hunt: as of 2026-11-17 only 42% of external
desktop users ever send a message (project 145863, 30 days: 153 of 363).

## The gate

Every event goes through `trackProductEvent` in
`src/renderer/src/shared/analytics/product-events.ts`, which reports only when
`telemetryEnabled` (`src/renderer/src/shared/config/telemetry.ts`) is true: the
launch's telemetry switch plus a build key, fail-closed. A rig, a test host,
Storybook or a launch with telemetry off constructs no client and sends nothing.
A capture that throws is dropped; analytics never fails the action it describes.

## Every event names the app version

Every renderer event — the named events below, `$pageview`, `$autocapture`,
`$rageclick`, `$exception` — carries the super property `app_version`: the
installed app's version as Electron reports it (`app.getVersion()`, e.g.
`0.62.1`). Use it, not `$lib_version`, to split a funnel by release:
`$lib_version` is posthog-js's own version and is identical across app releases.
It is registered in posthog-js's `loaded` callback, before the initial pageview
(`src/renderer/src/shared/analytics/app-version.ts` has the route and the
ordering proof). A launch with no version to report sends no `app_version` at
all rather than a placeholder. Events sent by builds before this property
existed lack it.

## No PII, no content

Properties are typed per event. Every string is a provider id from the catalogue,
a tour step id the app defines, or a member of a closed vocabulary in
`src/renderer/src/shared/analytics/first-run-reasons.ts`. No message text, key,
path, URL or error sentence has a property to ride in. Adding a reason means
adding it to that file (one place, so two branches cannot spell the same fact
two ways).

## Autocapture and exceptions carry no user content

PostHog's own autocapture (`$autocapture`, `$rageclick`, `$dead_click`) and
exception capture run through ONE `before_send` hook,
`scrubCaptureResult` in `src/renderer/src/shared/analytics/autocapture-privacy.ts`,
wired in `src/renderer/src/main.tsx`. Analytics consent covers product usage, not
what users write or open; before this hook, 8 days of external desktop events
(project 145863, measured 2026-11-21) carried file paths and customer-named file
names (141 events, 19 users), emails, and element text up to 360 characters.

The rule, applied to `$el_text`, every text and attribute value in
`$elements_chain` and `$elements`, `$external_click_url` and `$selected_content`:

| A value that... | is sent as |
|---|---|
| contains a path (POSIX, `~/`, `./`, `a/b/c`, `C:\`, `\\host\`) | `[redacted:path]` |
| contains a file name (`name.ext`, extension starts with a letter) | `[redacted:filename]` |
| contains an email | `[redacted:email]` |
| contains a URL (`scheme://`, `www.`, `file:`, `mailto:`) | `[redacted:url]` |
| contains a 24+ character id mixing letters and digits (keys, UUIDs) | `[redacted:token]` |
| contains a line break or tab | `[redacted:multiline]` |
| is wider than 64 (a CJK character counts 2) | `[redacted:long-text]` |
| is anything else: a short control label | unchanged, byte for byte |

Links keep only an http(s) origin (`https://docs.example.com/[redacted:url]`) or
the first segment of an in-app route (`#/chat`). A chain that does not parse is
sent empty, never as captured.

Short free text (a session title, a word of a message) has no shape to catch, so
user-content regions carry `USER_CONTENT_CLASS` (`ph-sensitive ph-mask`): the
markdown renderer (messages, reasoning, asides) and Team Bridge message bodies,
tool details (arguments, the output body, the bridge raw block), code execution
output/log/error blocks, library and project file previews, run-child failure
text, the raw-information view, attachment chips, whole sidebar row boxes
(session, temporary and draft rows, with their pin, archive and discard acts,
whose labels quote the title) and the chat header title. Inside one, posthog-js
omits text and links, the hook drops every attribute except a structural
allowlist (`id`, `class`, `role`, `type`, `data-state`, `data-testid`,
`data-chat-row`, `data-tour-tag`, `aria-expanded`, `aria-pressed`...), and
session replay masks the text. The click itself is still counted, and a sidebar
row click still reads as one (`data-chat-row`, `data-tour-tag="chat-session-row"`).
A new surface that shows user content gets the class on its container, never on
a control whose label a funnel counts.

**Replay masks text, not attributes.** rrweb records every attribute inside a
marked region as captured: a transcript link's `href`, an image's `alt`/`src`, a
`title`. Autocapture is covered (the hook drops those attributes), replay is
not. Whether to block them in replay (`blockSelector` for region links, or
`maskTextFn`) is an open decision for the operator.

`$exception` replaces every exception `value`/`message` wholesale with the
fixed marker `[redacted:exception-message]`. Free-form exception prose can contain
arbitrary user content; no regex can reliably separate it from diagnostics.
Losing all exception message prose (even ordinary product errors) is an
intentional privacy tradeoff. Exception type/count metadata and existing
sanitized stack structure remain: stack frame paths lose the account name
(`/Users/[user]/...`). Named product events are unchanged. If the hook itself
fails, it strips every element property and every exception message
(`[redacted:unscrubbed]`) and still sends the event.

What this costs: labels that are themselves content-shaped are redacted too
("Node.js", a provider shown as `together.ai`, a "Data:"/"File:" prefix read as
a URL scheme, a `/command` or a `11/21/2026` date read as a path). A funnel that
needs one should use a named product event above, not a looser rule. Events
ingested before this change are not rewritten; deleting them is a separate
decision.

## Events

| Event | Properties | Fired from |
|---|---|---|
| `provider_setup_started` | `provider`, `method` (`sign_in` \| `api_key`) | `features/providers/sign-in-flow.ts` (start), `provider-detail.tsx` (key save) |
| `provider_connected` | `provider`, `method` | sign-in reached `succeeded`; key saved |
| `provider_setup_failed` | `provider`, `method`, `reason` (`PROVIDER_SETUP_FAILURE_REASONS`) | sign-in ended `cancelled` / `expired` / `failed`, start refused, key refused |
| `local_model_check` | `provider`, `result` (`reachable` \| `unreachable` \| `error`), `reason` | every local-provider reachability probe (`provider-detail.tsx`, including Check again) |
| `first_message_sent` | none | first successful send of this install profile (`chat-page.tsx`); flag `lo.analytics.first-message-sent` in localStorage |
| `message_send_failed` | `reason_category` (`SEND_FAILURE_REASONS`), `http_status` (`SEND_FAILURE_HTTP_STATUSES`, `none` or `other`), `error_code` (`SEND_FAILURE_ERROR_CODES`, `none` or `other`) | the composer's send catch (`chat-page.tsx`, `diagnoseSendFailure`) |
| `backend_status` | `state` (`ready` \| `failed`), `reason` (`BACKEND_STARTUP_CATEGORIES` or `none`), `after_ready` (boolean), `elapsed_s` | each settled start-up attempt of the app's own server, and a server that died after it was ready (`backend-startup-panel.tsx`, `useBackendStartupTelemetry`); once per attempt per renderer session (deduped in sessionStorage, so a reload does not report it again) |
| `onboarding_tour_step` | `step`, `outcome` (`shown` \| `skipped_missing_target` \| `completed` \| `cancelled`) | `use-onboarding-tour.ts`; skips from `guardTourTargets` in `tour-steps.ts` |
| `onboarding_step_viewed` | `step` (`connect_provider` \| `default_model` \| `search` \| `meet`), `provider` (catalogue id, optional) | the first-run stage (`onboarding-modal.tsx` via `onboarding-analytics.ts`), once per step per visit; `provider` is omitted on view |
| `onboarding_step_completed` | `step` as above, `provider` (optional) | the same wizard when the user leaves a step FORWARD (Continue, Meet Aida, Finish). `connect_provider` carries the first connected provider id (Radient when connected); `search` carries `free` \| `radient` \| `keys` as `provider`; Skip and Back report nothing, so drop-off is `viewed(step) - completed(step)` |

`backend_status.elapsed_s` is the start-up duration distribution: measure it
before changing the readiness budget (`READINESS_BUDGET_MS`, 30 s), which this
change does not touch.
Rows with `after_ready: true` are a server that started, worked and then exited
non-zero; their `elapsed_s` is null. Exclude them from start-up analysis and
read them as mid-session crashes.

`message_send_failed` gained `http_status` and `error_code` in the release
after 0.59.2. Before it, `backend_unreachable` also counted main's no-token
refusal (`pairing.*`), the request deadline (`deadline_exceeded`) and a daemon
that answered but could not reach the runtime (`runtime_unreachable`, which is
also how a missing provider or model arrives); those now report `unauthorized`,
`transport` and `runtime_unavailable`. Every other row keeps its old category,
so compare across that release by `error_code`, not by `reason_category` alone.
Both new properties are closed allowlists: an unlisted value reports `other`,
never itself, and no message text is read.

`first_message_sent` is "first send since this release", not "first send ever":
the once-per-install flag did not exist before, so every existing install
reports it once on its first send after upgrading. The flag is also written
when telemetry is off, so turning telemetry on later does not report an old
first send as new. Read the activation funnel from the release date onward.

`onboarding_tour_step{outcome: "shown"}` counts a step the tour REACHED; a step
whose target never appeared within the wait (`TOUR_TARGET_WAIT_MS`) is then
also reported `skipped_missing_target`. The rest of its group
(`TOUR_STEP_GROUPS`) is skipped with it and not reported separately: one skip
row per group. A tour whose skips ran past its last step reports `cancelled`
and is not marked done.

## Helpers for other surfaces

- `categorizeSendFailure(error, backendReachable?)` maps a caught send failure to
  a `SendFailureReason` from the error's type, HTTP status and the transport
  classifier. Call it from any surface that reports a failed send (for example a
  Send again press) rather than inventing a category.
- `categorizeProviderFailure(error, "start" | "key")` does the same for provider
  setup.
