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

## No PII, no content

Properties are typed per event. Every string is a provider id from the catalogue,
a tour step id the app defines, or a member of a closed vocabulary in
`src/renderer/src/shared/analytics/first-run-reasons.ts`. No message text, key,
path, URL or error sentence has a property to ride in. Adding a reason means
adding it to that file (one place, so two branches cannot spell the same fact
two ways).

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
