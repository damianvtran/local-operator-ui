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
 * two functions below are the whole of that reasoning, kept out of the component
 * so a test can assert the copy.
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
}

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
 * The second line for an account, or null when there is nothing to add.
 *
 * Shown only when it differs from the label: two lines that read the same is
 * noise, and the case it exists for is a passkey whose display name is a
 * person's name and whose login is an email address.
 */
export function accountChoiceDetail(
	account: WebauthnAccountChoice | null | undefined,
	index: number,
): string | null {
	const label = accountChoiceLabel(account, index);
	const candidates = [account?.displayName?.trim(), account?.name?.trim()];
	const detail = candidates.find((value) => value && value !== label) ?? "";
	return detail || null;
}
