/**
 * Provider method labels, derived per provider from its registry row.
 *
 * The label states what THIS provider actually supports — never a universal
 * OAuth claim. A provider with only an `api_key` method says "API key"; one
 * with browser sign-in plus a key says "Sign in or API key". Saying more than
 * the registry row supports is how the old two-gate setup promised Radient
 * sign-in for providers that have no such flow.
 */

import {
	type AuthOperation,
	DesktopControlError,
	type ProviderMethod,
} from "@shared/api/local-operator/desktop-api";

export function providerMethodLabel(
	methods: ProviderMethod[],
	local: boolean,
): string {
	if (local) return "Local";
	const kinds = new Set(methods.map((method) => method.kind));
	const canSignIn = kinds.has("browser") || kinds.has("device");
	const canKey = kinds.has("api_key");
	if (canSignIn && canKey) return "Sign in or API key";
	if (canSignIn) return "Sign in";
	if (canKey) return "API key";
	return "Unavailable";
}

/**
 * Prefer interactive sign-in as the primary method when offered: a browser or
 * device flow keeps a secret out of a text field. The key method remains
 * selectable below.
 */
export function primaryMethod(
	methods: ProviderMethod[],
): ProviderMethod | null {
	return (
		methods.find((method) => method.kind === "browser") ??
		methods.find((method) => method.kind === "device") ??
		methods.find((method) => method.kind === "api_key") ??
		null
	);
}

/**
 * What the app can honestly say about a provider WITHOUT contacting it.
 *
 * The grid used to render `configured` as a green "Connected" badge, but
 * `configured` is `is_usable()` -- "has a credential, or needs none". For the
 * five local providers it is unconditionally true, so five rows claimed a
 * connection to servers that were not running (design D1, UX U1). Reachability
 * is not knowable without a probe, and probing on render is forbidden, so the
 * label states the credential fact only and says what is still required.
 */
export type ProviderReadiness = {
	label: string;
	tone: "success" | "neutral";
	/** Grouping bucket, shared with the model picker so both surfaces agree. */
	group: "Ready to use" | "Needs a running server" | "Needs sign-in";
};

export function providerReadiness(provider: {
	local: boolean;
	credential_optional: boolean;
	has_credential: boolean;
	configured: boolean;
}): ProviderReadiness {
	// A local server needs no key, and that is ALL this says. "No key needed"
	// is checkable; "Connected" was not.
	if (provider.local || provider.credential_optional) {
		return {
			label: "No key needed - needs a running server",
			tone: "neutral",
			group: "Needs a running server",
		};
	}
	if (provider.has_credential || provider.configured) {
		return { label: "Signed in", tone: "success", group: "Ready to use" };
	}
	return { label: "Needs sign-in", tone: "neutral", group: "Needs sign-in" };
}

/**
 * What to tell the user when the provider list fails to load.
 *
 * The grid used to assert "the backend may need an update" for every error,
 * including a backend that was not running at all. That is the wrong remedy:
 * updating cannot start a stopped process, and it sends the user through a
 * several-minute install to arrive back at the same failure. This draws the
 * same distinction the compatibility banner already draws from the same field,
 * so the two surfaces never disagree about what is wrong.
 *
 * 404 is the only status an update fixes: the route is absent, so the backend
 * predates the desktop contract. `null` means no backend was reached (rejected
 * IPC, dead dev proxy, or the transport's stalled-request deadline) and 503 is
 * the main process's own "could not complete this request". Any other status
 * keeps the generic sentence rather than guessing at a remedy.
 */
export function providerLoadErrorMessage(error: unknown): string {
	const status = error instanceof DesktopControlError ? error.status : null;
	return status === null || status === 503
		? "Providers could not be loaded. The backend is not answering. Retry once it has started."
		: "Providers could not be loaded. The backend may need an update.";
}

/** Terminal states after which polling an auth operation must stop. */
export function isTerminalAuthState(state: AuthOperation["state"]): boolean {
	return (
		state === "succeeded" ||
		state === "failed" ||
		state === "cancelled" ||
		state === "expired"
	);
}
