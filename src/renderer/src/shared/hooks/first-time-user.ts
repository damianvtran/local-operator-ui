/**
 * The first-time-user decision, as a pure function.
 *
 * Kept free of React and of the query hooks so the rule can be exercised by
 * `scripts/provider-state.test.mjs` with the exact inputs the hook feeds it,
 * and so the hook stays a thin adapter with nothing of its own to get wrong.
 *
 * Why the provider census and not the legacy `/v1/credentials` key list: that
 * list is the `credentials.env` file. Since the backend moved provider auth
 * into its own store (`~/.local-operator/auth.db`), a user signed in to
 * OpenAI, Anthropic and Kimi through the backend's OAuth has NO key in that
 * file -- it holds Google tokens, AWS keys, a Radient key -- so the old rule
 * ("no keys, therefore first run") opened setup over an existing agent list
 * and asked the user to connect providers they were already signed in to.
 *
 * Why three outcomes and not a boolean: "not yet known" is a real state. The
 * old hook treated a query that had not run (the connectivity gate disables
 * it until `/health` answers) as "no credentials", which flashed onboarding
 * while the backend was still starting. Nothing is decided until a source
 * has actually answered.
 */

/** The one fact about a provider the decision reads. */
export type CensusProvider = {
	local: boolean;
	credential_optional: boolean;
	configured: boolean;
	has_credential: boolean;
};

export type CensusInput =
	| { status: "loading" }
	/** The backend predates the census, or the app is not paired to it. */
	| { status: "unavailable" }
	/**
	 * The backend advertised the census and then failed to serve it. That is
	 * not "no providers" and not "old backend": inventing first_time here
	 * would open setup over a signed-in machine whose census 5xx'd.
	 */
	| { status: "failed" }
	| { status: "ready"; providers: CensusProvider[] };

export type LegacyCredentialsInput =
	| { status: "loading" }
	| { status: "error" }
	| { status: "ready"; keys: string[] };

export type FirstTimeDecision = "pending" | "first_time" | "returning";

/**
 * A provider counts as connected only when it is NOT a local server and
 * carries a credential. Local providers (Ollama, LM Studio, ...) report
 * `configured: true` unconditionally because they need no key; that is not
 * evidence the user has set anything up, so they never satisfy "returning".
 */
export function hasConnectedProvider(providers: CensusProvider[]): boolean {
	return providers.some(
		(provider) =>
			!provider.local &&
			!provider.credential_optional &&
			(provider.configured || provider.has_credential),
	);
}

export function decideFirstTimeUser(input: {
	onboardingComplete: boolean;
	census: CensusInput;
	legacy: LegacyCredentialsInput;
}): FirstTimeDecision {
	if (input.onboardingComplete) return "returning";

	if (input.census.status === "loading") return "pending";
	if (input.census.status === "failed") return "pending";
	if (input.census.status === "ready") {
		return hasConnectedProvider(input.census.providers)
			? "returning"
			: "first_time";
	}

	// Census not offered (old or unmanaged backend): the open credentials
	// list is the only source that does not go through the desktop bearer,
	// which 503s every non-capabilities op without a token. Empty keys is
	// first-time; a key means they have already set something up.
	// A probe that failed is a backend that is not answering, and setup
	// cannot run against a backend that is not answering either -- the
	// connectivity banner owns that fact, so this stays undecided rather
	// than guessing.
	if (input.legacy.status !== "ready") return "pending";
	return input.legacy.keys.length === 0 ? "first_time" : "returning";
}
