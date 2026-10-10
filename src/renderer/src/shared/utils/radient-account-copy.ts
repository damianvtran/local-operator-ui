/**
 * @file radient-account-copy.ts
 * @description
 * The one place the app words the Radient email-verification and top-up
 * prompts, and names the console pages they open.
 *
 * WHY THIS IS SHARED. Two surfaces tell a signed-in user the same account
 * facts: the settings page's verify-to-claim callout (a reminder on the
 * account's own screen) and the chat's out-of-credits row (the same account
 * state, met at the moment a run is refused). They used to be one surface; the
 * second one must not grow a second spelling of the amount, the URLs or the
 * action labels, or the two would drift the first time the backend's wording
 * moved. Everything here is a pure function of the account read, so both
 * surfaces and their node-side tests exercise the same code.
 *
 * WHAT IT MUST TOLERATE. Every input is optional on the wire: an older backend
 * sends no `verification` block, no `first_topup`, no `grant_amount`. Nothing
 * here invents a figure or a state for an absent field - the callers fall back
 * to wording that claims nothing (`freeCreditsText`'s "your free credits", the
 * neutral out-of-credits message).
 */

import type {
	AccountVerification,
	FirstTopUp,
} from "@shared/api/radient/types";

/** Where an unverified account claims its signup grant, when the backend names none. */
export const RADIENT_VERIFY_URL =
	"https://console.radienthq.com/dashboard/verification";

/** Where credits are bought, when the backend names no `first_topup.topup_url`. */
export const RADIENT_BILLING_URL =
	"https://console.radienthq.com/dashboard/billing";

/** The top-up action's own words, shared by the verified and unreadable arms. */
const TOP_UP_LABEL = "Top up in Radient console";

/**
 * Whether the account still has the signup grant to claim by verifying its
 * email.
 *
 * The block's `email_verified` is Radient's OWN Turnstile-gated claim state
 * (see `AccountVerification`), and `signup_grant === "claimed"` is the same fact
 * from the grant's side; either one saying "done" ends the prompt, so a
 * transient disagreement between the two never nags a user who has verified.
 */
export function needsEmailVerification(
	verification: AccountVerification,
): boolean {
	return (
		!verification.email_verified && verification.signup_grant !== "claimed"
	);
}

/**
 * The free-credit amount in words, or a degraded phrase that promises no number.
 *
 * The backend's captured `grant_amount` is what will actually be added; the
 * prices endpoint's default is only what new accounts are advertised, which is
 * why callers pass the capture first and the advertised value as a fallback.
 */
export const freeCreditsText = (amount: number | undefined): string => {
	if (typeof amount !== "number" || !Number.isFinite(amount))
		return "your free credits";
	return `$${amount.toFixed(2)} in free credits`;
};

/**
 * A whole-dollar amount without the trailing cents ("$10"), anything else to
 * the cent. The first-top-up constants are whole today, and "$10.00" would read
 * as a different number than the console's own "$10".
 */
export const formatUsd = (amount: number): string =>
	Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;

/**
 * The free-credit amount as the chat's prompt words it ("$5 in free credits"),
 * in the whole-dollar spelling the verification email's subject uses, so the
 * sentence a user reads here is the one their inbox repeats. The settings
 * callout keeps `freeCreditsText`'s cents spelling, which its committed frames
 * pin; the two surfaces share the VERBS and the URLs, not the figure format.
 */
export const grantAmountText = (amount: number | undefined): string => {
	if (typeof amount !== "number" || !Number.isFinite(amount))
		return "your free credits";
	return `${formatUsd(amount)} in free credits`;
};

/**
 * The URL a console button may open: the backend-named one when it is an
 * `http(s):` URL, else the known default.
 *
 * WHY THE GUARD. The desktop shell's `open-external` handler hands whatever it
 * is given to the OS, and these URLs arrive in an account payload the renderer
 * does not author. A console link has no business being anything but a web page
 * (`http:` stays allowed because a development console is served over it), so
 * any other scheme (a `file:` path, a custom protocol handler) is treated as
 * absent rather than opened.
 */
export function consoleUrl(
	candidate: string | undefined,
	fallback: string,
): string {
	if (!candidate) return fallback;
	try {
		const { protocol } = new URL(candidate);
		return protocol === "https:" || protocol === "http:" ? candidate : fallback;
	} catch {
		return fallback;
	}
}

/**
 * Open a console page in the reader's browser: the preload bridge in the
 * desktop app (the call `use-low-credits-dialog` also makes), the browser's own
 * `window.open` in Storybook and any non-Electron host.
 */
export function openConsolePage(url: string): void {
	if (window.api?.openExternal) {
		void window.api.openExternal(url);
	} else {
		window.open(url, "_blank");
	}
}

/**
 * The settings callout's sentence and action for a grant that is waiting to be
 * claimed. Moved here unchanged from the account section; see the copy's own
 * comments for why each arm says what it says.
 */
export const verifyCopy = (
	grant: AccountVerification["signup_grant"],
	amountText: string,
): { sentence: string; action: string } => {
	if (grant === "pending")
		return {
			sentence: `Verify your email to claim ${amountText}. Check your inbox for the link Radient sent.`,
			action: "Open verification page",
		};
	if (grant === "expired")
		return {
			/*
			 * The window that lapsed is the LINK's, not the grant's: the verification
			 * service's `Reissue` mints a fresh link while the grant is still
			 * unclaimed (agent-server `signup_verification_service.go`), which is why
			 * the amount stays on this arm (`grant_amount` is attached for pending
			 * and expired alike) and the console page is where the new one is asked
			 * for. What drops, rather than weakens, is the instruction to check the
			 * inbox - that mail expired with the window (UX round 1, U1).
			 */
			sentence: `The link to claim ${amountText} has expired. Request a new one from the verification page.`,
			action: "Request a new link",
		};
	/*
	 * `none` (and the gated-out `claimed`, which never reaches this render): no
	 * ticket was ever issued - or none survives - so there is no grant to
	 * promise and nothing that could be called "new". The copy points at the
	 * console to CHECK the account instead, and carries no amount: the frozen
	 * contract attaches `grant_amount` only for pending/expired, and this arm
	 * must not dress a missing answer as a figure (UX round 1, U1; the previous
	 * wording promised a claim the state does not support).
	 */
	return {
		sentence:
			"No signup grant is attached to this account. Open the verification page to check the account.",
		action: "Open verification page",
	};
};

/** What the chat's out-of-credits row says about the account, and what it offers. */
export type OutOfCreditsGuidance = {
	/** Which account state the copy was written for. */
	state: "unverified" | "verified" | "unknown";
	/** The sentences, in reading order; a line is never empty. */
	lines: string[];
	/** The console pages the copy offers, most relevant first. */
	links: { label: string; url: string }[];
};

/**
 * What an out-of-credits refusal should tell the reader, from what the account
 * read says.
 *
 * `verification` is `undefined` for EVERY case the app cannot read the state -
 * signed out, the read failed, still loading, or a backend that predates the
 * block - and all of them take the neutral arm. The block's absence on an older
 * backend is "cannot say", never "verified" or "unverified" (the same rule the
 * settings callout follows), so claiming either would put a false state on
 * screen at the moment the reader is already blocked.
 *
 * `advertisedGrant` is the prices endpoint's default, used only when the
 * backend's own capture is missing.
 */
export function outOfCreditsGuidance(
	verification: AccountVerification | undefined,
	advertisedGrant?: number,
): OutOfCreditsGuidance {
	if (verification === undefined) {
		/*
		 * Both remedies, each worded conditionally: either could be the right one
		 * and the account cannot be asked which. The verification page is named
		 * first because it is the free one.
		 */
		return {
			state: "unknown",
			lines: [
				"You're out of credits. If you haven't verified your email yet, verify it to claim free credits and start using Local Operator for free.",
				"Otherwise, top up in the Radient console.",
			],
			links: [
				{ label: "Open verification page", url: RADIENT_VERIFY_URL },
				{ label: TOP_UP_LABEL, url: RADIENT_BILLING_URL },
			],
		};
	}

	if (needsEmailVerification(verification)) {
		const claimUrl = consoleUrl(verification.claim_url, RADIENT_VERIFY_URL);
		// The action label is a function of the grant state alone; the amount
		// argument only feeds the sentence this row words for itself.
		const { action } = verifyCopy(verification.signup_grant, "");
		if (verification.signup_grant === "none") {
			/*
			 * No ticket exists, so there is no amount to promise (settings UX round 1,
			 * U1): the copy sends the reader to check the account instead of
			 * dressing the absence as a figure.
			 */
			return {
				state: "unverified",
				lines: [
					"You haven't verified your email yet. Open the verification page to check whether free credits are waiting on your account.",
				],
				links: [{ label: action, url: claimUrl }],
			};
		}
		const amountText = grantAmountText(
			verification.grant_amount ?? advertisedGrant,
		);
		return {
			state: "unverified",
			lines: [
				`You haven't verified your email yet. Verify to claim ${amountText} and start using Local Operator for free.`,
				verification.signup_grant === "expired"
					? "The link you were sent has expired. Request a new one on the verification page."
					: "Check your inbox for the link Radient sent.",
			],
			links: [{ label: action, url: claimUrl }],
		};
	}

	const topUp: FirstTopUp | undefined = verification.first_topup;
	const lines = ["You're out of credits. Top up in the Radient console."];
	/*
	 * The bonus line needs BOTH figures and an explicit `false`: an absent
	 * `first_topup` (older backend) or a partial one must read as "no line", not
	 * as an offer the backend never made.
	 */
	if (
		topUp !== undefined &&
		topUp.bonus_received === false &&
		Number.isFinite(topUp.bonus_amount) &&
		Number.isFinite(topUp.minimum_purchase)
	) {
		lines.push(
			`Get an extra ${formatUsd(topUp.bonus_amount)} free on your first top-up of ${formatUsd(topUp.minimum_purchase)} or more.`,
		);
	}
	return {
		state: "verified",
		lines,
		links: [
			{
				label: TOP_UP_LABEL,
				url: consoleUrl(topUp?.topup_url, RADIENT_BILLING_URL),
			},
		],
	};
}
