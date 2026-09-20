/**
 * Provider method labels, derived per provider from its registry row.
 *
 * The label states what THIS provider actually supports — never a universal
 * OAuth claim. A provider with only an `api_key` method says "API key"; one
 * with browser sign-in plus a key says "Sign in or API key". Saying more than
 * the registry row supports is how the old two-gate setup promised Radient
 * sign-in for providers that have no such flow.
 */

import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
import type {
	AuthOperation,
	ProviderMethod,
	RadientLoginVerdict,
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
 * The provider whose sign-in owns this machine's tunnel.
 *
 * Its login is the ONE stored credential this app can get a verdict about
 * (`GET /v1/auth/status`'s `radient_login`, read through the `accounts.list`
 * desktop op), which is what makes the join below possible at all.
 */
export const RADIENT_PROVIDER_ID = "radient";

/**
 * The refused badge's long form, which the grid renders as its `title`, because
 * the badge itself cannot wrap. Names the sign-in rather than the account or the
 * machine, and stops short of the remedy the sign-in control beside it offers.
 */
const REFUSED_DETAIL =
	"Radient no longer accepts the sign-in stored on this machine";

/**
 * Whether the login verdict refuses the credential a provider row counts.
 *
 * WHY THE CENSUS ALONE CANNOT ANSWER THIS. `has_credential` and `configured`
 * are facts about the STORE -- a row is there, and `is_usable()` says so -- and
 * a revoked grant keeps both: the row stays, its access token can still be
 * inside its expiry, and `disabled_cause` stays NULL because nothing on the
 * sign-in path writes it. So the grid asserted "Signed in" in green for a login
 * that was dead, while the composer one screen away said it needed
 * re-authentication and the account section said the user was not signed in
 * (UX U1 on the chat session-issue PR, which is the report this predicate
 * answers). The verdict is the one fact that separates the two.
 *
 * A `null`, absent or unreadable verdict keeps the store's own answer, and so
 * does `unknown`: those are "this machine could not be asked" (an offline
 * refresh, a backend older than the route), and a surface that reads them as a
 * refusal sends a user who is signed in to a sign-in they do not need -- the
 * same misdirection as the green chip, in the other direction.
 *
 * The verdict is about ONE provider, so it is joined by id here rather than
 * applied to whichever row is rendering.
 */
export function loginRefused(
	providerId: string,
	verdict: RadientLoginVerdict | null | undefined,
): boolean {
	return (
		providerId === RADIENT_PROVIDER_ID && verdict?.state === "login_required"
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

export function providerReadiness(
	provider: {
		local: boolean;
		credential_optional: boolean;
		has_credential: boolean;
		configured: boolean;
	},
	/**
	 * Whether the credential this row counts is one the provider itself refuses,
	 * from `loginRefused`. Defaulted rather than required, because the facts
	 * above are all a surface that cannot read the verdict has -- and that is the
	 * answer an absent, unreadable or `unknown` verdict must keep, not a
	 * conservative guess in the other direction.
	 */
	credentialRefused = false,
): ProviderReadiness {
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
	// A credential ROW is not a working sign-in, and this is the only input that
	// can tell the two apart (see `loginRefused`). It comes before the
	// credential branch deliberately: the incident was a row that satisfied that
	// branch while the provider had already stopped accepting it.
	if (credentialRefused) {
		return {
			label: "Needs sign-in",
			detail: REFUSED_DETAIL,
			tone: "neutral",
			group: "Needs sign-in",
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
 *
 * Deliberately NOT given the login verdict (unlike the grid's own call): this
 * predicate decides whether a provider may be OFFERED as a place to run, and
 * removing a provider from the control is a different act from correcting the
 * badge on its row. The verdict belongs here when a surface comes to it with a
 * reason of its own, not as a side effect of a wording fix.
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

/**
 * What the picker knows about the census, in the three states it can be in.
 *
 * Shaped like `CensusInput` in `first-time-user.ts` on purpose: both surfaces
 * decide from the same three facts, and the defect this exists to fix was the
 * picker collapsing two of them into one. There is no `unavailable` member
 * because a backend that never advertised the census does not reach this
 * function at all -- the picker falls to the env-file key list there, which is
 * the same `unavailable` branch `decideFirstTimeUser` takes.
 */
export type HostingCensusState<P> =
	| { status: "loading" }
	/** The backend advertised the census and then failed to serve it. */
	| { status: "failed" }
	| { status: "ready"; providers: P[] };

/**
 * Reduce a census query's flags to the three states the picker distinguishes.
 *
 * `data` outranks `isError` deliberately: a refetch that fails while an earlier
 * census is still cached means we DID find out, once, and the cached answer is
 * better evidence than no answer. Only a census that has NEVER delivered a
 * payload is `failed`. Swapping those two checks blanks a fully-loaded picker
 * the moment a background refetch 5xx's, which is the shape of issue 92.
 *
 * This lives here rather than inline in the component because that ordering is
 * the entire defence against re-shipping 92, and an invariant protected only by
 * a comment is how 92 shipped in the first place. As a pure function it is
 * assertable over `{ data, isError }` set TOGETHER -- the state no behavioural
 * test of either flag alone can reach.
 */
export function hostingCensusStateFrom<P>(census: {
	data?: P[] | undefined;
	isError: boolean;
}): HostingCensusState<P> {
	if (census.data) return { status: "ready", providers: census.data };
	if (census.isError) return { status: "failed" };
	return { status: "loading" };
}

/**
 * Which hosting providers the picker may offer, given the census state.
 *
 * The three states have three different answers, and conflating the last two
 * is issue 93:
 *
 * - **loading** -- filtering is suppressed and every provider is offered. The
 *   census is about to answer, and blanking a populated control for the length
 *   of one request reads as the list breaking. This is the ONLY state in which
 *   an unfiltered list is correct.
 * - **ready** -- the census owns the filter, using the same predicate the
 *   onboarding grid uses, so the two surfaces cannot disagree about a provider.
 * - **failed** -- nothing from the census. A census that did not answer is not
 *   evidence that a provider is usable, and offering all of them turns "we
 *   could not find out" into "yes". That is the same defect class the
 *   onboarding gate fixed by resolving a failed census to `pending` rather
 *   than `first_time`.
 *
 * The failed case deliberately does NOT disable the control or drop the value
 * the user already has -- see `hostingCensusFailureHelperText` and the
 * `isDisabled` gate in `hosting-select.tsx`. Refusing to assert a provider is
 * ready is honest; locking the user out of a control because we could not find
 * out is the same overreach in the other direction.
 */
export function selectableHostingProviders<
	P extends { id: string } & Parameters<typeof hostingProviderSelectable>[0],
	T extends { id: string },
>(all: T[], census: HostingCensusState<P>): T[] {
	if (census.status === "loading") return all;
	if (census.status === "failed") return [];
	const ready = readyHostingIds(census.providers);
	return all.filter((provider) => ready.has(provider.id));
}

/**
 * Why the picker is offering nothing, when the reason is a failed census.
 *
 * Routed through the SAME selector the onboarding grid renders in its error
 * alert, rather than a picker-private sentence, so the two surfaces report one
 * fault in one set of words and point at one remedy. That agreement is
 * assertable by string equality in `scripts/provider-state.test.mjs`, which is
 * the property issue 93 is about: an empty picker beside a grid explaining why
 * is a dead end only if the picker stays silent.
 */
export function hostingCensusFailureHelperText(error: unknown): string {
	return providerLoadErrorMessage(error);
}

/**
 * What to tell the user when the provider list fails to load.
 *
 * The diagnosis and the remedy both come from the shared classification rather
 * than a second `if` over the same status field, because the grid and the
 * compatibility banner previously disagreed: at 401/403 the banner said
 * restart-and-re-pair and withheld its update button, while the grid's two-way
 * split dropped those statuses into its `else` and told the user to install a
 * newer server -- which cannot fix a bearer the running one refuses.
 *
 * This surface's only contribution is the lead sentence, because it speaks
 * about providers rather than about the whole app. The grid used to own a
 * private diagnosis table beside the shared remedy, which let the two halves
 * of one sentence drift apart in wording and in confidence; keeping the split
 * at "scope" rather than at "diagnosis" is what stops that.
 */
export function providerLoadErrorMessage(error: unknown): string {
	return backendLoadErrorMessage("Providers could not be loaded.", error);
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
