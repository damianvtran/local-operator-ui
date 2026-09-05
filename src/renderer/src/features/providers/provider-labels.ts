/**
 * Provider method labels, derived per provider from its registry row.
 *
 * The label states what THIS provider actually supports — never a universal
 * OAuth claim. A provider with only an `api_key` method says "API key"; one
 * with browser sign-in plus a key says "Sign in or API key". Saying more than
 * the registry row supports is how the old two-gate setup promised Radient
 * sign-in for providers that have no such flow.
 */

import type {
	AuthOperation,
	ProviderMethod,
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

/** Terminal states after which polling an auth operation must stop. */
export function isTerminalAuthState(state: AuthOperation["state"]): boolean {
	return (
		state === "succeeded" ||
		state === "failed" ||
		state === "cancelled" ||
		state === "expired"
	);
}
