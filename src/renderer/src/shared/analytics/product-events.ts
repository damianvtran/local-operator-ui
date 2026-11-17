/**
 * Named product events for the first-run funnel, through the ONE consent gate.
 *
 * WHY THESE EXIST. As of 2026-11-17 only 42% of external desktop users ever
 * send a message (PostHog project 145863, 30 days: 153 of 363), and the steps
 * between install and that message were visible only as autocaptured clicks and
 * console errors in replays. These events name the steps - provider setup,
 * local-model checks, the first message, a failed send, the server's start-up,
 * the tour - so the funnel is a query rather than a replay hunt.
 * `docs/analytics-events.md` is the catalogue a reader of the data should use.
 *
 * THE GATE. `telemetryEnabled` (`../config/telemetry.ts`) is the renderer's one
 * answer to "may this launch report": the launch's switch plus a build key,
 * fail-closed. When it is false the PostHog provider never mounts, nothing is
 * initialised, and `track` here returns without touching `posthog-js`. When it
 * is true the provider has initialised the default instance; an event fired
 * before that lands is dropped rather than queued, because a pre-init capture
 * on an uninitialised client is exactly the "client constructed when off" leak
 * the gate exists to prevent.
 *
 * NO PII, NO CONTENT. Properties are typed per event and every string property
 * is one of the closed vocabularies in `./first-run-reasons.ts`, a provider id
 * from the catalogue, or a step id the app defines. Nothing a user typed - no
 * message text, no key, no path, no URL - has a property it could ride in.
 *
 * NEVER THROWS. Analytics is never a reason for a send, a setup or the tour to
 * fail: every capture is wrapped and a failure is dropped silently.
 */
import posthog from "posthog-js";
import type {
	BackendStartupCategory,
	BackendStartupPhase,
} from "../../../../shared/backend-startup";
import { telemetryEnabled } from "../config/telemetry";
import type {
	LocalModelCheckReason,
	LocalModelCheckResult,
	ProviderSetupFailureReason,
	ProviderSetupMethod,
	SendFailureReason,
	TourStepOutcome,
} from "./first-run-reasons";

/** Every event and the exact properties it may carry. */
export interface ProductEvents {
	provider_setup_started: { provider: string; method: ProviderSetupMethod };
	provider_connected: { provider: string; method: ProviderSetupMethod };
	provider_setup_failed: {
		provider: string;
		method: ProviderSetupMethod;
		reason: ProviderSetupFailureReason;
	};
	local_model_check: {
		provider: string;
		result: LocalModelCheckResult;
		reason: LocalModelCheckReason;
	};
	first_message_sent: Record<string, never>;
	message_send_failed: { reason_category: SendFailureReason };
	backend_status: {
		state: BackendStartupPhase;
		reason: BackendStartupCategory | "none";
		/** Whole seconds since the start began, so a distribution can be read. */
		elapsed_s: number | null;
	};
	onboarding_tour_step: { step: string; outcome: TourStepOutcome };
}

export type ProductEventName = keyof ProductEvents;

/** The capture function, swappable so a test can observe without a client. */
type Sink = (name: string, properties: Record<string, unknown>) => void;

const defaultSink: Sink = (name, properties) => {
	// `__loaded` is posthog-js's own "init has run" flag: before it, a capture
	// would build state on a client the gate may never initialise.
	if (!(posthog as { __loaded?: boolean }).__loaded) return;
	posthog.capture(name, properties);
};

let sink: Sink | null = telemetryEnabled ? defaultSink : null;

/** Test seam: route captures to `next` (or restore the gated default). */
export function setProductEventSink(next: Sink | null | "default"): void {
	sink = next === "default" ? (telemetryEnabled ? defaultSink : null) : next;
}

/** Report one product event. A no-op when this launch may not report. */
export function trackProductEvent<N extends ProductEventName>(
	name: N,
	properties: ProductEvents[N],
): void {
	if (!sink) return;
	try {
		sink(name, { ...properties });
	} catch {
		// Never let analytics fail the action it describes.
	}
}

/**
 * The key marking that this install has already reported its first message.
 * In localStorage, not a store: it must survive restarts and must not ride in
 * any persisted store the quota handling may evict.
 */
export const FIRST_MESSAGE_FLAG = "lo.analytics.first-message-sent";

/**
 * Report `first_message_sent` once per install profile. The activation metric
 * is "ever sent", so the event's existence per person is the whole signal;
 * repeated sends add volume and nothing else.
 */
export function trackFirstMessageSent(
	storage: Pick<Storage, "getItem" | "setItem"> | null = safeLocalStorage(),
): void {
	try {
		if (storage?.getItem(FIRST_MESSAGE_FLAG) === "1") return;
		storage?.setItem(FIRST_MESSAGE_FLAG, "1");
	} catch {
		// A full or unavailable storage still reports - at worst twice.
	}
	trackProductEvent("first_message_sent", {});
}

function safeLocalStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}
