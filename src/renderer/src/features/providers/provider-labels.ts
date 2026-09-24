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
import type { ProviderMethod } from "@shared/api/local-operator/desktop-api";
import {
	type RadientLoginVerdict,
	TUNNEL_LOGIN_PROVIDER,
} from "@shared/hooks/use-radient-session-issue";
import type { RadientAccountRead } from "@shared/hooks/use-radient-user-query";

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
 * The refused badge's long form, which a surface renders as its `title`, because
 * the badge itself cannot wrap. Names the sign-in rather than the account or the
 * machine, and stops short of the remedy the sign-in control beside it offers.
 */
const REFUSED_DETAIL =
	"Radient no longer accepts the sign-in stored on this machine";

/**
 * The unverified badge's long form, for the arm where the app cannot confirm a
 * credential the census counts.
 */
const UNVERIFIED_DETAIL =
	"This app could not confirm the sign-in stored on this machine";

/**
 * The two fields of the app's own account read this module needs, spelled as the
 * hook returns them (`useRadientUserQuery`). `unavailable` is what separates
 * "this machine holds no Radient sign-in" from "this app cannot ask": a
 * capability answer without `radient` disables the read, and a disabled React
 * Query reports `isLoading === false` with no data -- which the hook classifies
 * as `signed-out` because that is the right answer for the surfaces that render
 * its sentence, and the WRONG one to narrow a credential row with.
 */
export type RadientSignInRead = {
	accountRead: RadientAccountRead;
	unavailable: boolean;
};

/**
 * What this app can say about the sign-in a provider row counts.
 *
 * Three answers, and each one exists because collapsing it into another produced
 * a wrong claim:
 *
 * - `working` -- the store's own answer, which is every provider this app has no
 *   verdict about;
 * - `refused` -- the provider itself refuses the stored credential (sign in
 *   again);
 * - `unverified` -- the row counts a credential and this app's OWN account read
 *   answers that no sign-in is stored, so neither "signed in" nor "signed out"
 *   is a claim worth making.
 */
export type ProviderLoginState = "working" | "refused" | "unverified";

/**
 * The sign-in state for one provider row, from the two facts this app holds.
 *
 * WHY THE CENSUS ALONE CANNOT ANSWER THIS. `has_credential` and `configured`
 * are facts about the STORE -- a row is there, and `is_usable()` says so -- and
 * a revoked grant keeps both: the row stays, its access token can still be
 * inside its expiry, and `disabled_cause` stays NULL because nothing on the
 * sign-in path writes it. So the grid asserted "Signed in" in green for a login
 * that was dead, while the composer one screen away said it needed
 * re-authentication and the account section said the user was not signed in
 * (UX U1 on the chat session-issue PR). `GET /v1/auth/status`'s
 * `radient_login` is the fact that separates them.
 *
 * WHY THE ACCOUNT READ IS THE SECOND INPUT, and not more of the same. The
 * verdict is absent on every runtime below the field's first release (backend
 * `5ebd6a53`, i.e. `v0.61.2`), and the desktop route still answers 200 there, so
 * a chip that falls back to the row re-establishes exactly the contradiction
 * this change removes -- design round 1's D3, QA round 1's Q-1, and the code
 * round's M1, which photographed that state on this branch's own head.
 * `signed-out` is the app's own classification of "no Radient credential is
 * stored", from the same machine at the same moment, so a row plus THAT reading
 * is a contradiction this app can see without any verdict at all. It is
 * deliberately the only class used here: a healthy machine's account read fails
 * `unavailable` rather than `signed-out` (design round 1's `r4`), and none of
 * `checking`/`ready` contradicts a credential row.
 *
 * AN ANSWERED `unknown` IS NOT A HEALTH CLAIM EITHER (QA round 1, Q-1, case F2:
 * a row whose token endpoint cannot be reached). `unknown` is the app asking and
 * declining to say `ok`, so the chip may not render the green claim on it; but
 * it may not call it a refusal either, and the label it gets (`unverified`) says
 * only what the app knows -- which is also what the sibling surfaces say on that
 * machine (the account section's read fails `unavailable`, the composer says it
 * needs re-authentication). The distinction that keeps this from misdirecting a
 * WORKING login is the `ok` arm above it: a healthy machine answers `ok`, and
 * the design round's `r4` is that state photographed.
 *
 * AND AN `unknown` THAT NAMES NO CREDENTIAL IS NO VERDICT AT ALL (code round 2,
 * M2). The backend answers `{credential_id: null, state: "unknown"}` whenever no
 * tunnel is configured (`tunnels/report.py::local_payload`; `config.load()`
 * raises with no `config.json`), which is a signed-in, healthy user who has
 * never made a tunnel -- reproduced by the reviewer on backend `v0.62.18` as
 * `login: {'credential_id': None, 'state': 'unknown'} configured: False`. Read as
 * a verdict, that arm told a working sign-in "Needs sign-in" with a tooltip
 * about a sign-in this app could not confirm, which is the incident inverted:
 * the misdirection this whole function exists to remove, in the other direction.
 * A verdict that names no credential is not a claim about one, so it falls
 * through to the account-read arm below, exactly as an absent field does. The
 * `unknown` that DOES name a credential keeps `unverified` -- see the arm itself.
 *
 * A `null`, ABSENT or unreadable verdict with neither of those contradictions
 * keeps the store's own answer, and that is the one case where the chip is still
 * the pre-change claim: it is a runtime below `v0.61.2` whose account read could
 * not be taken either, the PR body states that floor, and the release notes must
 * not imply more than it ships.
 *
 * THE FALLBACK ARM IS BOTH ACCOUNT-READ CLASSES A ROW CAN CONTRADICT, NOT ONE
 * (QA round 2, Q-6). `signed-out` is the class that says no sign-in is stored;
 * `refused` is the class that says Radient refused the one this app holds. Both
 * are answers about the same credential the row counts, both come from this
 * app's own read of the same backend, and leaving `refused` out left the chip
 * rendering the pre-fix green claim on the one machine whose account read names
 * the fault -- reachable on `v0.61.0`/`v0.61.1`, which ship the refused
 * classification without shipping the verdict (measured at both tags), and on any
 * runtime whose `/v1/auth/status` read fails, where the composer callout goes
 * silent and the chip is the only surface still speaking. `unavailable` keeps the
 * store's answer, because a healthy machine's read fails that way and sending it
 * to a sign-in it does not need is the same misdirection in the other direction.
 *
 * WHAT THE ABSENT-VERDICT ARM COSTS, stated rather than hidden: its second input
 * is a query like any other, so on a runtime below `v0.61.2` the chip is the
 * store's answer until that read answers -- a local 409 in the case that
 * narrows, and nothing at all in the cases that do not (`unavailable` and
 * `ready` both keep the store's answer). A surface therefore judges THIS
 * function's settled answer, and the grid does not gate its card list on this
 * read: it is an upstream-backed query with retries, and holding a provider list
 * behind it would cost a second or more on exactly the machines where it changes
 * nothing.
 *
 * The verdict is about ONE provider, so it is joined by id here rather than
 * applied to whichever row is rendering.
 *
 * A SURFACE MUST NOT ASK THIS BEFORE THE VERDICT HAS ANSWERED. The answer here
 * is a claim about a sign-in, and before the read answers the only inputs are
 * the census -- which is the predicate that produced the incident. `useRadientLoginVerdict`
 * exposes `isPending` for exactly that, and both surfaces hold their own paint
 * until it is false (the grid its card list, the panel its badge), which is also
 * what closes design round 1's D6: a green "Signed in" used to be painted for
 * 72-193 ms on a refused machine and then corrected.
 */
export function loginState(
	providerId: string,
	verdict: RadientLoginVerdict | null | undefined,
	account: RadientSignInRead,
): ProviderLoginState {
	if (providerId !== TUNNEL_LOGIN_PROVIDER) return "working";
	if (verdict?.state === "login_required") return "refused";
	// The provider accepting the sign-in is the one answer that lets the row
	// speak for itself.
	if (verdict?.state === "ok") return "working";
	/*
	 * An answered `unknown`: the app asked and declined to confirm. No claim
	 * either way -- see the docblock. Gated on the credential it names, because
	 * the backend's other `unknown` (`credential_id: null`, no tunnel configured)
	 * is not a verdict about any sign-in and belongs on the fallback arm below.
	 */
	if (verdict?.state === "unknown" && verdict.credential_id !== null) {
		return "unverified";
	}
	/*
	 * And the runtime that has no verdict to answer with at all: the row may not
	 * be read as a working sign-in while this app's own account read says no
	 * sign-in is stored, or says Radient refused the one it holds.
	 */
	if (!account.unavailable && account.accountRead === "refused") {
		return "refused";
	}
	if (!account.unavailable && account.accountRead === "signed-out") {
		return "unverified";
	}
	return "working";
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
	tone: "success" | "neutral" | "attention";
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
	 * The sign-in state for this row, from `loginState`. Defaulted to `working`
	 * rather than required, because the facts above are all a surface that has
	 * nothing else to go on has -- and a caller with no verdict is asking a
	 * question about the credential store, which is what this function answered
	 * before the verdict existed.
	 */
	signIn: ProviderLoginState = "working",
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
	/*
	 * The refused state gets its OWN words and its own tone (design round 1, D1,
	 * D2, D4, D5). It used to return the never-configured answer verbatim, which
	 * made the two states the same picture -- measured: the refused card and the
	 * never-signed-in card differ in zero of 4,791,360 pixels, with the only
	 * difference in the DOM an attribute a screenshot cannot contain. The label
	 * says what happened to the sign-in in the sibling surface's own vocabulary
	 * (#416's callout title is "Radient needs re-authentication"), and `attention`
	 * is the variant this app built for "needs your attention, not an error":
	 * `neutral` is what a healthy local provider says (`No key needed`), so on
	 * this grid the hue carried no severity at all. The group stays "Needs
	 * sign-in", because that is the bucket the model picker and the picker's own
	 * filter read, and the remedy IS a sign-in.
	 */
	if (signIn === "refused") {
		/*
		 * The long form names the state the VERDICT reported, and the sentence it
		 * carries names a sign-in stored on this machine. So it is owed only when
		 * the census counts a credential -- the rule the `unverified` branch below
		 * already applies, and for the same reason (code round 2, M4): QA's case D
		 * is a `login_required` verdict on a machine whose census says
		 * `has_credential: false, configured: false` (a removed row), and the
		 * tooltip there told the reader Radient no longer accepts a sign-in this
		 * machine does not have. The LABEL stays: it is the verdict's own words for
		 * one condition (D5), and routing this arm to the never-configured answer
		 * instead would render two different verdicts -- `login_required` and
		 * `unknown` -- as the same card, which is the collapse D1 had to pull apart.
		 */
		if (provider.has_credential || provider.configured) {
			return {
				label: "Needs re-authentication",
				detail: REFUSED_DETAIL,
				tone: "attention",
				group: "Needs sign-in",
			};
		}
		return {
			label: "Needs re-authentication",
			tone: "attention",
			group: "Needs sign-in",
		};
	}
	/*
	 * The row counts a credential and this app's own account read says none is
	 * stored. Nothing here may claim a successful sign-in, and nothing here can
	 * claim a refusal either: what is known is that the app cannot confirm the
	 * sign-in, which is the same thing the section's sentence above it says.
	 *
	 * The long form is owed only when the census counted a credential, because it
	 * names the CONTRADICTION: on a machine that simply has no sign-in, "could not
	 * confirm the sign-in stored on this machine" describes a row that is not
	 * there, and that machine must keep rendering exactly what it rendered before
	 * this change.
	 */
	if (signIn === "unverified") {
		if (provider.has_credential || provider.configured) {
			return {
				label: "Needs sign-in",
				detail: UNVERIFIED_DETAIL,
				tone: "neutral",
				group: "Needs sign-in",
			};
		}
		return { label: "Needs sign-in", tone: "neutral", group: "Needs sign-in" };
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
