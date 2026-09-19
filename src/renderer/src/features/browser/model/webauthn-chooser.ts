/**
 * The passkey chooser's view model.
 *
 * Design: docs/design/browser-challenges-and-passkeys.md. Electron fires the
 * session event `select-webauthn-account` when a `navigator.credentials.get()`
 * matches MORE THAN ONE discoverable credential, and with nothing answering the
 * request is cancelled with `NotAllowedError` — so this surface is what turns a
 * silent failure into a choice. A single matching credential never reaches it:
 * Electron dispatches that one itself.
 *
 * WHY THE ACCOUNTS ARE DESCRIBED HERE RATHER THAN RENDERED AS THEY ARRIVE: main
 * holds Electron's own `WebAuthnAccount` shape (credentialId, name,
 * displayName, userHandle) and the dialog has to say something useful for an
 * account that has none of the human fields, without inventing an identity. The
 * functions below are the whole of that reasoning, kept out of the component so
 * a test can assert the copy.
 *
 * EVERY SENTENCE THE CHOOSER PRINTS IS DERIVED HERE from the request, because
 * design and UX round 1 found the fixed copy contradicting the rows under it:
 * "More than one of your passkeys matches" was said for a one-account request
 * (D3) and for three accounts whose names the OS never supplied (U1), which is
 * exactly the state where the user has nothing to choose by.
 */

/** One offered credential, as the dialog renders it. */
export interface WebauthnAccountChoice {
	/** URL-safe base64, matched against `PublicKeyCredential.id`. Echoed back to
	 * main verbatim: the dialog never interprets it. */
	credentialId: string;
	name: string | null;
	displayName: string | null;
}

/** A passkey request the user has to answer. */
export interface WebauthnChoiceRequest {
	requestId: string;
	/** The relying party's id (the site's registrable domain), as Electron
	 * reports it. Shown so the user knows which site is asking. */
	relyingPartyId: string;
	accounts: WebauthnAccountChoice[];
	/** The tab whose page asked, and that page's title, when main could resolve
	 * them from the event's own frame. Null when it could not: the frame may have
	 * been destroyed, or belong to no tab of this host. */
	tabId: number | null;
	pageTitle: string | null;
}

/** Why a request the surface was showing is gone. The two the USER caused need
 * no explanation; the rest mean it ended without them. */
export type WebauthnSettledOutcome =
	| "chosen"
	| "dismissed"
	| "expired"
	| "host-stopped"
	| "credential-not-offered";

/** Which typographic voice a row's first line is in.
 *
 * `human` is a person's name (`displayName`); `login` is a machine string — a
 * username or an address — and reads in the machine voice; `ordinal` is the
 * positional fallback, which is neither: a position is not an identity and not a
 * machine string either, so it takes the row's own primary ink and lets the
 * explaining sentence below it be the secondary line (design round 2, N2).
 *
 * Branding § 4: monospace is the machine voice and a login is not prose — the
 * model draws that distinction and the frame used to erase it by rendering a
 * `name` fallback at the same weight as a display name (design round 1, D4),
 * which reads an email address as "the person". */
export type AccountVoice = "human" | "login" | "ordinal";

/**
 * What to call one account.
 *
 * `displayName` first because it is the human-palatable one, then `name` (a
 * username or email), and finally a positional fallback: an account whose
 * fields are both empty is still a row the user may need to pick, and an empty
 * button would be unusable. Sentence case, no decoration — the branding
 * contract's rule for anything a person reads.
 */
export function accountChoiceLabel(
	account: WebauthnAccountChoice | null | undefined,
	index: number,
): string {
	const displayName = account?.displayName?.trim() ?? "";
	if (displayName) return displayName;
	const name = account?.name?.trim() ?? "";
	if (name) return name;
	return `Passkey ${index + 1}`;
}

/**
 * The voice the label is read in.
 *
 * A display name is a person's name; a login is a machine string; the positional
 * fallback is a position, which leads the row in the app's own voice rather than
 * the machine one (design round 2, N2).
 */
export function accountChoiceVoice(
	account: WebauthnAccountChoice | null | undefined,
): AccountVoice {
	if ((account?.displayName?.trim() ?? "") !== "") return "human";
	if ((account?.name?.trim() ?? "") !== "") return "login";
	return "ordinal";
}

/** The second line of a row whose site stored no name for the credential.
 *
 * Said rather than left blank (UX round 1, U1; design round 1, D9): a chooser
 * offering three ordinals gives no basis for a choice, and a row that explains
 * it is one the user can at least cancel deliberately. The recovery clause is
 * UX round 2's U8: the row said what the pick decides and not what to do when it
 * is the wrong one, which is the only thing a user in this state can act on. */
export const UNNAMED_ACCOUNT_DETAIL =
	"The site stored no name for this passkey. If it is the wrong one, sign out and ask the site again.";

/**
 * The second line for an account, or null when there is nothing to add.
 *
 * Shown only when it differs from the label: two lines that read the same is
 * noise, and the case it exists for is a passkey whose display name is a
 * person's name and whose login is an email address. An account with NO name of
 * any kind gets the explicit sentence instead of a blank line.
 */
export function accountChoiceDetail(
	account: WebauthnAccountChoice | null | undefined,
	index: number,
): string | null {
	const label = accountChoiceLabel(account, index);
	const candidates = [account?.displayName?.trim(), account?.name?.trim()];
	const detail = candidates.find((value) => value && value !== label) ?? "";
	if (detail) return detail;
	const anonymous =
		!(account?.displayName?.trim() ?? "") && !(account?.name?.trim() ?? "");
	return anonymous ? UNNAMED_ACCOUNT_DETAIL : null;
}

/** Whether every offered account arrived without a name of any kind. */
export function accountsAreNameless(
	accounts: readonly WebauthnAccountChoice[],
): boolean {
	return accounts.every(
		(account) =>
			!(account.displayName?.trim() ?? "") && !(account.name?.trim() ?? ""),
	);
}

/** The chooser's lead sentence, derived from the request it is answering. */
export function chooserLead(request: WebauthnChoiceRequest): string {
	const site = request.relyingPartyId || "A site";
	const count = request.accounts.length;
	if (count === 1) {
		return `${site} asked for a passkey. Pick it to sign in.`;
	}
	if (accountsAreNameless(request.accounts)) {
		return `${site} asked for a passkey. Your Mac holds ${count} passkeys for this site and did not give their names, so the one you pick is the account you sign in as.`;
	}
	return `${site} asked for a passkey. More than one of your passkeys matches, so pick the one to use.`;
}

/** The page the request came from, when main could resolve it.
 *
 * The native view is suppressed while this dialog is up, so the page the
 * decision is ABOUT is the one thing the user cannot see (UX round 1, U3). */
export function chooserPageNote(request: WebauthnChoiceRequest): string | null {
	return request.pageTitle
		? `The page asking is \u201c${request.pageTitle}\u201d.`
		: null;
}

/** How many further requests are waiting behind the one on screen.
 *
 * REQUESTS, not sites (design round 2, N3; UX round 2, U7): main's pending map is
 * keyed by request id with no dedupe by relying party, so two tabs of one site
 * both asking would make "2 more sites" false. The count is real either way. */
export function chooserQueueNote(waiting: number): string | null {
	if (waiting <= 0) return null;
	return waiting === 1
		? "One more passkey request is waiting."
		: `${waiting} more passkey requests are waiting.`;
}

/** The sentence a request that ended without the user leaves behind.
 *
 * Null for `chosen` and `dismissed`: the user knows what they did, and telling
 * them their own answer was registered is the kind of copy the branding
 * contract's voice rule exists to keep out. The other outcomes are the ones the
 * dialog used to swallow — it stayed open, and a later click was discarded
 * silently (design round 1, D2). */
export function settledChooserCopy(
	outcome: WebauthnSettledOutcome,
): { title: string; body: string } | null {
	switch (outcome) {
		case "expired":
			return {
				title: "This passkey request expired",
				body: "Nobody chose a passkey within a minute, so the site's request was cancelled. Ask the site for a passkey again.",
			};
		case "host-stopped":
			return {
				title: "This passkey request was cancelled",
				body: "The browser tab that asked went away before a passkey was chosen, so the request was cancelled.",
			};
		case "credential-not-offered":
			return {
				title: "That passkey was not offered",
				body: "The choice did not name a passkey this site offered, so the request was cancelled. Try again from the site.",
			};
		default:
			return null;
	}
}
