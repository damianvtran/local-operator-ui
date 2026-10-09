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
 *
 * A RADIENT 402 IS NEVER A RATE LIMIT. Radient answers an account with no
 * balance as HTTP 402 "insufficient credits", and the runtime's classifier files
 * a relayed refusal under `rate-limit` when the relayed text also says "rate
 * limit or quota exceeded" - so the structured category alone rendered the
 * row as "rate-limit:" with a provider-settings button, which tells a reader
 * with an empty balance to back off. For a Radient-named row the TEXT marker for
 * the balance therefore outranks a `rate-limit` category (and only that one: an
 * `auth` or `network` category still decides, and a non-Radient rate limit is
 * untouched). `radientOutOfCredits` is the single predicate; the row's label,
 * headline and account-aware guidance all key on it.
 *
 * WHERE EACH CLASS LANDS. Sign-in failures point at the providers surface with
 * Radient preselected; Radient billing failures point at the ACCOUNT section,
 * where the balance, the verify-to-claim callout and the console's billing
 * entry live (UX round 1, U3); every other failure points at the providers
 * surface - the one in-app place that can act on it without assuming an
 * account this app does not manage.
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
 *
 * `RADIENT_ACCOUNT_SETTINGS` is the ACCOUNT section, not the providers grid,
 * and the split is the remedy's own geography (UX round 1, U3): an out-of-
 * credits failure is repaired where the balance, the verify-to-claim callout
 * and the console's billing entry live - the provider grid only signs a
 * provider in. The sign-in class keeps the grid because that is exactly where
 * signing in happens.
 */
const PROVIDER_SETTINGS = "/settings?section=providers";
const RADIENT_PROVIDER_SETTINGS =
	"/settings?section=providers&provider=radient";
const RADIENT_ACCOUNT_SETTINGS = "/settings?section=radient";

/** The desktop plane's sentinel sentence for a refused Radient credential. */
const RADIENT_SIGN_IN = /sign in to radient/i;

/** The out-of-credit family: failures whose remedy is the account's balance. */
const BILLING_TEXTS = [/insufficient credits/i, /credit balance is too low/i];

/**
 * The rate-limit family, kept to the wordings quoted in the header. `rate
 * limit or quota exceeded` stays here rather than in `BILLING_TEXTS`: it is
 * the relayed 429 the runtime classifies as `rate-limit`, and its remedy is
 * backing off or switching provider rather than topping up.
 */
const QUOTA_TEXTS = [/rate limit or quota/i];

/**
 * The markers that say a RADIENT failure is the balance. "insufficient
 * credits" is the 402 body; "HTTP 402" is the status the runtime prefixes onto
 * a relayed refusal whose body was dropped. Both are tied to a Radient-named
 * row by the caller - a bare "402" in some other provider's text is not ours to
 * reinterpret.
 */
const RADIENT_BALANCE_TEXTS = [/insufficient credits/i, /\bHTTP 402\b/i];

type FailureClass = "sign-in" | "billing" | "quota";

/** Whether the row's head names Radient as the provider that failed. */
function namesRadient(provider: string | null | undefined): boolean {
	return (provider ?? "").split("/")[0]?.trim().toLowerCase() === "radient";
}

/**
 * Whether a row is Radient refusing a request because the account has no
 * balance - from the harness's own `billing` class, or from the text marker when
 * the category says `rate-limit` (see the header) or says nothing.
 *
 * Deliberately NOT true for other categories: `auth`, `network`, `mcp` and the
 * rest are the classifier saying this failure is a different kind, and a quoted
 * "insufficient credits" inside their payload is some other error's words.
 */
export function radientOutOfCredits(row: {
	text: string;
	category?: string | null;
	provider?: string | null;
}): boolean {
	if (!namesRadient(row.provider)) return false;
	if (row.category === "billing") return true;
	const open =
		row.category == null ||
		row.category === "unknown" ||
		row.category === "rate-limit";
	return open && RADIENT_BALANCE_TEXTS.some((marker) => marker.test(row.text));
}

/**
 * What the row says it is, given what it is: the ledger label and the headline.
 *
 * Only a Radient out-of-credits row is rewritten (`null` otherwise, so every
 * other row keeps the runtime's words untouched). The relayed label "rate limit
 * or quota exceeded" is the symptom of the misclassification, not a fact about
 * the account, so it is replaced by the cause; everything else the vendor said
 * (the status, the body) stays, because the reader may quote it to support. A
 * headline that never carried the rate-limit label (the `billing` class's own
 * "HTTP 402: insufficient credits") already reads correctly and is left alone.
 */
export function radientOutOfCreditsWording(row: {
	text: string;
	headline: string;
	category?: string | null;
	provider?: string | null;
}): { label: string; headline: string } | null {
	if (!radientOutOfCredits(row)) return null;
	const relayed = /rate limit or quota( exceeded)?\s*/i;
	if (!relayed.test(row.headline))
		return { label: "billing", headline: row.headline };
	/*
	 * The relayed shape is `<label> (HTTP 402): <body>` (`ProviderError.render`
	 * in the runtime's `providers/failover.py`). The status and the body are the
	 * vendor's facts and survive in the same order; only the label is replaced.
	 */
	const rest = row.headline.replace(relayed, "").trim();
	const parts = /^\((HTTP \d{3})\):?\s*(.*)$/i.exec(rest);
	const body = (parts ? parts[2] : rest.replace(/^:\s*/, "")).trim();
	const status = parts ? ` (${parts[1]})` : "";
	return {
		label: "billing",
		headline: body
			? `Out of credits${status}: ${body}`
			: `Out of credits${status}: Radient refused the request`,
	};
}

/** The classes the harness's own classification already names. */
function structuredClass(
	category: string | null | undefined,
): FailureClass | null {
	if (category === "auth") return "sign-in";
	if (category === "billing") return "billing";
	if (category === "rate-limit") return "quota";
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
		namesRadient(row.provider) || RADIENT_SIGN_IN.test(row.text);
	let failure: FailureClass | null = structuredClass(row.category);
	// The balance outranks a `rate-limit` category on a Radient row (header).
	if (radientOutOfCredits(row)) failure = "billing";
	if (
		failure === null &&
		(row.category == null || row.category === "unknown")
	) {
		if (RADIENT_SIGN_IN.test(row.text)) failure = "sign-in";
		else if (BILLING_TEXTS.some((pattern) => pattern.test(row.text)))
			failure = "billing";
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
	/*
	 * The billing class lands on the account section when the failure is
	 * Radient's: that surface carries the balance, the verify-to-claim callout
	 * and the console's own billing entry, while the provider grid carries only
	 * sign-in (UX round 1, U3). A non-Radient balance failure is that provider's
	 * billing, which no surface of this app can top up, so the grid stays the
	 * honest in-app destination.
	 */
	if (failure === "billing" && radientNamed)
		return { label: "Open Radient account", to: RADIENT_ACCOUNT_SETTINGS };
	return {
		label: "Open provider settings",
		to: radientNamed ? RADIENT_PROVIDER_SETTINGS : PROVIDER_SETTINGS,
	};
}
