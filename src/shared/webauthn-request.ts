/**
 * The WebAuthn chooser's wire contract, shared by the preload and its tests.
 *
 * WHY IT IS IN `src/shared/` RATHER THAN INLINE IN THE PRELOAD: both channels
 * that carry a chooser — the push that raises one and the pull that recovers one
 * raised while nothing was mounted — have to agree byte for byte about the shape,
 * and a validator tested through a copy of itself is not tested. The preload is
 * where every inbound payload is validated; this is the module it validates WITH,
 * which is also what lets a test import the parser without standing up Electron.
 *
 * WHAT TRAVELS AND WHAT DOES NOT: a request id main minted, the relying party, the
 * offered credentials' public fields, and the page the request came from when main
 * could resolve it from the event's frame. There is no secret here and no
 * authority: the renderer chooses among the ids main already offered, and main
 * re-validates the choice against its own record.
 */

/** One offered credential, as Electron reports it. */
export interface WebauthnAccountChoice {
	/** URL-safe base64, matched against `PublicKeyCredential.id`. */
	credentialId: string;
	name: string | null;
	displayName: string | null;
}

/** A chooser request the renderer has to answer. */
export interface WebauthnRequestPayload {
	requestId: string;
	relyingPartyId: string;
	accounts: WebauthnAccountChoice[];
	/** The tab whose page asked, and that page's title, when main could resolve
	 * them; null when the frame belonged to no tab of this host. */
	tabId: number | null;
	pageTitle: string | null;
}

/** Why a chooser main was holding is gone.
 *
 * There is no `no-accounts` member: a request Electron raises with nothing to
 * offer is answered before it is ever pending, so no chooser was on screen to
 * explain and the state could not be rendered even if it were sent (agent review
 * round 2, R2). */
export type WebauthnSettledOutcome =
	| "chosen"
	| "dismissed"
	| "expired"
	| "host-stopped"
	| "credential-not-offered";

const SETTLED_OUTCOMES: readonly WebauthnSettledOutcome[] = [
	"chosen",
	"dismissed",
	"expired",
	"host-stopped",
	"credential-not-offered",
];

export function isWebauthnSettledOutcome(
	value: unknown,
): value is WebauthnSettledOutcome {
	return (
		typeof value === "string" &&
		(SETTLED_OUTCOMES as readonly string[]).includes(value)
	);
}

/**
 * Validate one inbound chooser payload. Returns null rather than throwing.
 *
 * Main is trusted, but a malformed payload must not reach the renderer as a
 * dialog with no accounts to show — and a request with no credential to offer is
 * nothing the user could answer either way.
 */
export function parseWebauthnRequest(
	raw: unknown,
): WebauthnRequestPayload | null {
	if (typeof raw !== "object" || raw === null) return null;
	const payload = raw as Record<string, unknown>;
	if (typeof payload.requestId !== "string" || !payload.requestId) return null;
	if (!Array.isArray(payload.accounts)) return null;
	const accounts = payload.accounts
		.filter(
			(account): account is Record<string, unknown> =>
				typeof account === "object" && account !== null,
		)
		.map((account) => ({
			credentialId:
				typeof account.credentialId === "string" ? account.credentialId : "",
			name: typeof account.name === "string" ? account.name : null,
			displayName:
				typeof account.displayName === "string" ? account.displayName : null,
		}))
		.filter((account) => account.credentialId !== "");
	if (accounts.length === 0) return null;
	return {
		requestId: payload.requestId,
		relyingPartyId:
			typeof payload.relyingPartyId === "string" ? payload.relyingPartyId : "",
		accounts,
		tabId: typeof payload.tabId === "number" ? payload.tabId : null,
		pageTitle:
			typeof payload.pageTitle === "string" && payload.pageTitle
				? payload.pageTitle
				: null,
	};
}
