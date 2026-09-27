/**
 * The one place the chat decides that a failure names a provider account the
 * reader can act on, and where that action goes.
 *
 * WHY THIS EXISTS. A run that dies because a provider refused the account - out
 * of credits, rate-limited into a wall, or holding a credential that no longer
 * works - renders as the harness's own incident line, and the line is where
 * the report used to stop. The reader is told what happened and left to find
 * the surface that fixes it. The settings page's provider grid is that surface,
 * and this module is how a chat row reaches it.
 *
 * STRUCTURED FIRST, TEXT SECOND, and the order is the property. An incident row
 * arrives carrying the harness's own classification (`category`) and the
 * provider its head names (`provider`), so those decide whenever they can. The
 * text families are the fallback for rows that carry no classification - a
 * notice, an `unknown` incident, an older backend - and they are deliberately
 * narrow: a matcher that fired on the word "credit" would decorate half the
 * transcript.
 *
 * The fallback families, each a text this product or its backend actually
 * produces:
 *  - "insufficient credits" - Radient's own 402 body (the runtime already
 *    classifies the same phrase for dictation, `transcription.py`);
 *  - "rate limit or quota" - the relayed provider refusal the runtime renders
 *    as a `rate-limit` incident;
 *  - "credit balance is too low" - Anthropic's wording for the same account
 *    state, quoted verbatim in `desktop-session-contract.ts`'s failure
 *    summary;
 *  - "sign in to Radient" - the desktop plane's own sentence for a missing or
 *    refused Radient credential.
 *
 * WHAT IT MUST TOLERATE. The runtime owns the incident text and may add
 * guidance of its own to it later. Nothing here reads that guidance, so the
 * affordance is exactly as present or absent as the failure classes above
 * decide, whatever prose sits around them.
 */

/** The affordance a classified failure earns, and where it opens. */
export type ProviderErrorAction = {
	/** The action's own words. */
	label: string;
	/** The settings deep link to open. */
	to: string;
};

/*
 * The settings deep links, written as LITERALS so
 * `scripts/settings-section-routes.test.mjs` can bind the section against the
 * settings page's own refs, and so the `provider=` parameter preselects the
 * Radient row in the grid exactly the way `/login radient` does.
 */
const PROVIDER_SETTINGS = "/settings?section=providers";
const RADIENT_PROVIDER_SETTINGS =
	"/settings?section=providers&provider=radient";

/** The desktop plane's sentinel sentence for a refused Radient credential. */
const RADIENT_SIGN_IN = /sign in to radient/i;

/** The out-of-credit family, kept to the wordings quoted in the header. */
const QUOTA_TEXTS = [
	/insufficient credits/i,
	/rate limit or quota/i,
	/credit balance is too low/i,
];

type FailureClass = "sign-in" | "quota";

/** The classes the harness's own classification already names. */
function structuredClass(
	category: string | null | undefined,
): FailureClass | null {
	if (category === "auth") return "sign-in";
	if (category === "billing" || category === "rate-limit") return "quota";
	return null;
}

/**
 * The action a row earns, or null when it earns none.
 *
 * The text fallback runs only where the row carries no classification of its
 * own (`null`/`undefined`) or one the classifier itself could not decide
 * (`unknown`): a category outside the set is the harness saying this failure
 * is a different kind, and the words of some OTHER error quoted inside its
 * payload are not this row's own cause.
 */
export function providerErrorGuidance(row: {
	/** The row's full text: its headline, and its detail when it has one. */
	text: string;
	/** The incident's classification, when the row is an incident. */
	category?: string | null;
	/** The `provider/model` an incident's head names, when it names one. */
	provider?: string | null;
}): ProviderErrorAction | null {
	const radientNamed =
		(row.provider ?? "").split("/")[0]?.trim().toLowerCase() === "radient" ||
		RADIENT_SIGN_IN.test(row.text);
	let failure: FailureClass | null = structuredClass(row.category);
	if (
		failure === null &&
		(row.category == null || row.category === "unknown")
	) {
		if (RADIENT_SIGN_IN.test(row.text)) failure = "sign-in";
		else if (QUOTA_TEXTS.some((pattern) => pattern.test(row.text)))
			failure = "quota";
	}
	if (failure === null) return null;
	/*
	 * "Sign in to Radient" is only true when the failure is Radient's; every
	 * other sign-in failure (an OAuth provider that refused its refresh token,
	 * say) gets the surface named rather than a specific account assumed.
	 */
	if (failure === "sign-in" && radientNamed)
		return { label: "Sign in to Radient", to: RADIENT_PROVIDER_SETTINGS };
	return {
		label: "Open provider settings",
		to: radientNamed ? RADIENT_PROVIDER_SETTINGS : PROVIDER_SETTINGS,
	};
}
