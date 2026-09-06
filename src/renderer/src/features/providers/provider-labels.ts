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
	/**
	 * The full statement when `label` had to be short. The badge cannot wrap
	 * or shrink (it is `whitespace-nowrap` by contract), and a 300px card
	 * cannot hold a provider name beside a seven-word badge -- the two
	 * overlapped and the badge clipped at the card edge. The grid renders
	 * this as the badge's `title` so the long form is still reachable.
	 */
	detail?: string;
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
			label: "No key needed",
			detail: "No key needed - needs a running server",
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
 * Whether the hosting picker may offer this provider without a "requires
 * additional credentials" warning. Same fact the grid uses: anything that
 * would not say "Needs sign-in" (signed in, or a local server that needs
 * none). A second predicate here is how the picker drifted onto the env
 * file and labelled Anthropic unusable while the grid said Signed in.
 */
export function hostingProviderSelectable(provider: {
	local: boolean;
	credential_optional: boolean;
	has_credential: boolean;
	configured: boolean;
}): boolean {
	return providerReadiness(provider).group !== "Needs sign-in";
}

/** Census ids the hosting picker may offer. Same predicate as the grid. */
export function readyHostingIds(
	census: Array<
		{
			id: string;
		} & Parameters<typeof hostingProviderSelectable>[0]
	>,
): Set<string> {
	return new Set(
		census
			.filter((provider) => hostingProviderSelectable(provider))
			.map((provider) => provider.id),
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
