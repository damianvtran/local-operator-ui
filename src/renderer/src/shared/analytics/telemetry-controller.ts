/**
 * The renderer's analytics client lifecycle: started, stopped and restarted
 * LIVE as the user opts in or out (2026-11-24).
 *
 * WHY THIS EXISTS. Telemetry is default-off and opt-in (`src/main/
 * telemetry-consent.ts`). The old renderer mounted `posthog-js`'s
 * `PostHogProvider` once at start-up on a launch-time constant, so a change
 * could only take effect after a restart, and the provider's options carried
 * session replay, autocapture and exception capture. The user's toggle must
 * take effect immediately in both directions, so the client is driven here
 * instead of by a mount:
 *
 *  - ON for the first time in this document: `init` with the minimal options
 *    below, explicit opt-in, then ONE `app_active` event — the active-user
 *    signal this whole feature exists for.
 *  - OFF: `reset()` (drops the anonymous id and persisted super properties)
 *    THEN `opt_out_capturing()`. The order matters: in posthog-js 1.235.6
 *    `reset()` calls `consent.reset()`, which would erase an opt-out written
 *    before it. After this, `capture` is a no-op inside posthog-js and the
 *    product-event sink drops events at its own gate as well.
 *  - ON again: `opt_in_capturing` (no `$opt_in` event) and `app_active` again.
 *
 * The client is injected (structural type) so node tests can drive the
 * lifecycle with a fake and never load posthog-js — see
 * `scripts/telemetry-controller.test.mjs`.
 */

import type { SuperPropertyClient } from "./app-version";
import { scrubCaptureResult } from "./autocapture-privacy";
import { setTelemetryActive } from "./telemetry-state";

/** The one event that says "this install is active". */
export const APP_ACTIVE_EVENT = "app_active";

/**
 * Properties posthog-js adds by default that can name WHAT the user is doing:
 * the in-app hash route carries a conversation id (`#/chat/<id>`), the title can
 * carry a file or session name, and referrers carry URLs. Counting active users
 * needs none of them, so they are removed from every event before it is queued.
 */
export const LOCATION_PROPERTIES = [
	"$current_url",
	"$pathname",
	"$host",
	"$title",
	"$referrer",
	"$referring_domain",
	"$initial_referrer",
	"$initial_referring_domain",
	"$initial_current_url",
	"$initial_pathname",
	"$initial_host",
	"$prev_pageview_pathname",
	"title",
] as const;

type CaptureLike = {
	properties?: Record<string, unknown>;
	$set?: Record<string, unknown>;
	$set_once?: Record<string, unknown>;
} | null;

/** Strip location/title properties (and their person-property copies). */
export function stripLocationProperties<T extends CaptureLike>(event: T): T {
	if (!event) return event;
	for (const bag of [event.properties, event.$set, event.$set_once]) {
		if (!bag) continue;
		for (const key of LOCATION_PROPERTIES) delete bag[key];
	}
	return event;
}

/**
 * The posthog-js options: the minimum needed to count active users.
 *
 * Each disabled capability is restated explicitly rather than left to a
 * posthog-js default, so a library upgrade or a project's REMOTE config cannot
 * switch it on: `capture_exceptions: false` in particular is required, because
 * `undefined` defers to the project's server-side "autocapture exceptions"
 * setting (`extensions/exception-autocapture/index.js`, `requiredConfig`).
 * `disable_external_dependency_loading` stops posthog-js fetching the
 * recorder, surveys or toolbar scripts at all. `before_send` keeps the
 * autocapture scrub as defence in depth even though autocapture is off.
 */
export function buildPosthogOptions(input: {
	apiHost: string;
	/** Runs inside `init`, before any event: `registerAppVersion` lives here. */
	loaded?: (client: SuperPropertyClient) => void;
}) {
	return {
		api_host: input.apiHost,
		// Belt and braces: the client starts opted OUT and the controller opts it
		// in explicitly, so a persisted state from an older build can never make
		// it send before the controller has decided.
		opt_out_capturing_by_default: true,
		persistence: "localStorage" as const,
		autocapture: false,
		capture_pageview: false,
		capture_pageleave: false,
		capture_exceptions: false,
		capture_heatmaps: false,
		capture_dead_clicks: false,
		capture_performance: false,
		rageclick: false,
		disable_session_recording: true,
		disable_surveys: true,
		disable_web_experiments: true,
		disable_external_dependency_loading: true,
		save_referrer: false,
		person_profiles: "identified_only" as const,
		before_send: [stripLocationProperties, scrubCaptureResult],
		...(input.loaded ? { loaded: input.loaded } : {}),
	};
}

/** The slice of the posthog-js client this needs. */
export interface TelemetryClient {
	__loaded?: boolean;
	init(key: string, options: Record<string, unknown>): unknown;
	capture(name: string, properties?: Record<string, unknown>): unknown;
	opt_in_capturing(options?: { captureEventName?: string | false }): void;
	opt_out_capturing(): void;
	has_opted_out_capturing(): boolean;
	reset(): void;
}

export interface TelemetryController {
	/** Converge the client on `effective` (launch allows AND user opted in). */
	apply(effective: boolean): void;
}

export function createTelemetryController(input: {
	client: TelemetryClient;
	/** The build's key; blank means this build can never report. */
	projectKey: string;
	options: Record<string, unknown>;
}): TelemetryController {
	const { client } = input;
	let active = false;

	const start = () => {
		if (!client.__loaded) client.init(input.projectKey, input.options);
		if (client.has_opted_out_capturing())
			client.opt_in_capturing({ captureEventName: false });
		client.capture(APP_ACTIVE_EVENT);
	};

	const stop = () => {
		if (!client.__loaded) return; // never started: nothing to stop
		client.reset(); // must precede the opt-out; see the module comment
		client.opt_out_capturing();
	};

	return {
		apply(effective) {
			const next = effective && input.projectKey.trim() !== "";
			if (next === active) return;
			active = next;
			// Published BEFORE start so product events and the feature-flag
			// provider agree with the client; and before stop, so nothing slips in.
			setTelemetryActive(next);
			try {
				if (next) start();
				else stop();
			} catch {
				// Analytics must never break the app; an opt-out that threw still
				// left the gate above closed, so nothing is captured by our code.
			}
		},
	};
}
