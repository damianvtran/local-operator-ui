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
 * `scripts/telemetry-consent.test.mjs`; `scripts/telemetry-allowlist.test.mjs`
 * runs the real posthog-js through the options' `before_send`.
 */

import type { SuperPropertyClient } from "./app-version";
import { scrubCaptureResult } from "./autocapture-privacy";
import { PRODUCT_EVENT_PROPERTIES } from "./product-events";
import { setTelemetryActive } from "./telemetry-state";

/** The one event that says "this install is active". */
export const APP_ACTIVE_EVENT = "app_active";

/**
 * WHAT MAY LEAVE, AS AN ALLOW-LIST (review round 1, Q1/R2; 2026-11-24).
 *
 * The first cut removed a list of known location keys. QA then found posthog-js
 * 1.235.6 also sends `$session_entry_url`, `$session_entry_pathname` and
 * `$initial_person_info` — the full `file://` URL with the `#/chat/<id>` route
 * and, on an unpackaged install, the user's name in the path — plus device
 * defaults (user agent, screen and viewport, timezone, language). A strip list
 * loses to every property a library upgrade adds; an allow-list cannot. So an
 * event leaves only if its NAME is enumerated here, and it keeps only the
 * properties enumerated here. Everything else, `$set`/`$set_once` included, is
 * dropped before posthog-js queues it.
 *
 * Kept, and why each is needed to count active users:
 *  - `token`, `distinct_id`: which project, and the anonymous install id.
 *  - `$lib`, `$lib_version`: PostHog's ingestion routes and parses by them.
 *  - `$time`, `$insert_id`: event time and ingestion de-duplication.
 *  - `$process_person_profile`: keeps `person_profiles: "identified_only"` in
 *    force at ingestion; without it the server would create a person profile.
 *  - `app_version`, `$os`, `$os_version`: the operator-approved dimensions.
 *  - each product event's own enumerated properties (`PRODUCT_EVENT_PROPERTIES`,
 *    closed vocabularies by construction — see `product-events.ts`).
 * `uuid` and `timestamp` are top-level fields of the capture result, not
 * properties, so they survive untouched.
 *
 * `$geoip_disable: true` asks PostHog's ingestion not to derive a location from
 * the request's IP. Whether the IP itself is retained is a project setting the
 * client cannot enforce, which is why the copy promises nothing about IPs.
 */
export const ALLOWED_BASE_PROPERTIES = [
	"token",
	"distinct_id",
	"$lib",
	"$lib_version",
	"$time",
	"$insert_id",
	"$process_person_profile",
	"app_version",
	"$os",
	"$os_version",
] as const;

const ALLOWED_EVENTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	[APP_ACTIVE_EVENT, new Set<string>(ALLOWED_BASE_PROPERTIES)],
	...Object.entries(PRODUCT_EVENT_PROPERTIES).map(
		([name, own]) =>
			[
				name,
				new Set<string>([
					...ALLOWED_BASE_PROPERTIES,
					...(own as readonly string[]),
				]),
			] as const,
	),
]);

type CaptureLike = {
	event: string;
	properties?: Record<string, unknown>;
	$set?: Record<string, unknown>;
	$set_once?: Record<string, unknown>;
};

/**
 * `before_send` step: drop any event not on the allow-list, and reduce an
 * allowed one to its allowed properties. Never throws (posthog-js runs
 * `before_send` without a catch): anything unexpected drops the event.
 */
export function restrictToActiveUserSignal<T extends CaptureLike | null>(
	event: T,
): T | null {
	try {
		if (!event) return null;
		const allowed = ALLOWED_EVENTS.get(event.event);
		if (!allowed) return null;
		const kept: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(event.properties ?? {})) {
			if (allowed.has(key)) kept[key] = value;
		}
		kept.$geoip_disable = true;
		// A new object rather than mutating: `$set`/`$set_once` (person
		// properties) are left out entirely, and nothing else rides along.
		const { $set: _set, $set_once: _setOnce, ...rest } = event;
		return { ...rest, properties: kept } as T;
	} catch {
		return null;
	}
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
 * recorder, surveys or toolbar scripts at all. `before_send` runs the
 * autocapture scrub as defence in depth, then the allow-list above, which is
 * the actual guarantee of what leaves.
 */
export function buildPosthogOptions(input: {
	apiHost: string;
	/** Runs inside `init`, before any event: `registerAppVersion` lives here. */
	loaded?: (client: SuperPropertyClient) => void;
}) {
	return {
		api_host: input.apiHost,
		/*
		 * NOT `opt_out_capturing_by_default` (measured on the real app,
		 * 2026-11-24): with it, `init` leaves posthog-js's batched request queue
		 * PAUSED, and `opt_in_capturing()` never un-pauses it (posthog-core.js
		 * 1.235.6, `_start_queue_if_opted_in` runs only from `_loaded`/DOM load),
		 * so an opted-in user's events queued forever. It is not needed either:
		 * `init` only ever runs from `start()`, i.e. after the user opted in.
		 */
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
		before_send: [scrubCaptureResult, restrictToActiveUserSignal],
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
	/** posthog-js internal (1.235.6); optional so a rename degrades, not throws. */
	_start_queue_if_opted_in?: () => void;
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
		if (client.has_opted_out_capturing()) {
			client.opt_in_capturing({ captureEventName: false });
			// A document that loaded with a persisted opt-out (an opt-out from an
			// earlier run, opted back in from another window) has a paused queue
			// that `opt_in_capturing` does not resume; see `buildPosthogOptions`.
			client._start_queue_if_opted_in?.();
		}
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

/** The slice of the preload bridge the boot needs. */
export interface TelemetryConsentSource {
	get(): Promise<{ effective?: boolean }>;
	onChange(listener: (state: { effective?: boolean }) => void): () => void;
}

/**
 * Start a document's telemetry from the LIVE consent, never from launch argv
 * (review round 1, R1).
 *
 * WHY. `--lo-telemetry` is composed into the window's `additionalArguments`
 * when the window is created, and Electron keeps those for the webContents'
 * whole life — so a reload (Cmd+R, sign-out's `location.reload()`) sees the
 * answer from window creation. Booting from it resurrected an opt-out made
 * since (and ignored an opt-in made since). Main's `get()` answers from its
 * current record, already AND-ed with the launch switch, so it is the only
 * input. Until it answers the document is OFF and says so (`setTelemetryActive
 * (false)` overrides `telemetry-state`'s argv fallback, so the feature-flag
 * provider and product events stay off too). A broadcast that arrives before
 * `get()` resolves is newer than it, so the late `get()` answer is ignored.
 * No bridge (Storybook, a bare renderer): stays off.
 */
export function bootTelemetry(
	controller: TelemetryController,
	source: TelemetryConsentSource | undefined,
): () => void {
	setTelemetryActive(false);
	if (!source) return () => undefined;
	let superseded = false;
	const off = source.onChange((state) => {
		superseded = true;
		controller.apply(state.effective === true);
	});
	void source.get().then(
		(state) => {
			if (!superseded) controller.apply(state.effective === true);
		},
		() => undefined, // unanswered: stay off
	);
	return off;
}
