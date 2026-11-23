/**
 * Pending authentication requests: how a password manager's or the platform's
 * passkey prompt can appear in a tab an AGENT drives WITHOUT pausing the agent.
 *
 * WHY THIS FILE REPLACES `passkey-custody.ts` (operator reports 2026-11-11,
 * 2026-11-17 and the round-5 review). Two failures, in opposite directions:
 *
 *   1. The measured one. `notification.html` is 1Password's GENERIC
 *      notification host: it renders the PASSIVE inline autofill card ("Sign
 *      in" / other logins) on any login form as well as the real passkey
 *      prompt. Treating every admission as "a person is needed" put several
 *      agent tabs on login pages into a WAITING row with nobody asked
 *      anything, and a hold that refused every agent action.
 *   2. The correction of that failure overshot. Refusing every provider
 *      document in an agent tab stopped a REAL 1Password passkey sign-in from
 *      completing where it started and told the user to open a human-owned tab
 *      instead (review R5 BLOCKER).
 *
 * WHAT A TAB IS NOW. Never held. An agent-owned tab keeps serving its agent:
 * query, screenshot, click, type and navigate all continue while a passkey
 * prompt is on screen, and no projection is raised for a passive autofill card.
 * What a live ceremony keeps is REQUEST-scoped and TAB-scoped: exactly three
 * actions are refused, and each of them would destroy or hijack the request
 * the person is answering:
 *
 *   - `close`    — the tab's document (and the in-flight `credentials.get()`)
 *                  disappears with it;
 *   - `navigate` — same, from the agent's side;
 *   - `prompt_document` — the provider's own prompt document is never an
 *                  agent's to read or drive, whatever the tab's state
 *                  (`actions/frames.ts` `assertNotExtensionFrame` is the third,
 *                  independent line; this is the typed form of the refusal).
 *
 * Everything else — including a whole-tab screenshot that happens to include
 * the prompt — is allowed, because the operator's requirement is that the agent
 * continues its work in that tab and no "Return to Agent" control exists. That
 * trade-off is deliberate and is NOT true before a person engages the tab: see
 * "WHAT IS ADMITTED" below.
 *
 * WHAT IS ADMITTED, and why the document alone cannot decide it. Only an
 * installed, enabled extension's known prompt documents
 * (`PASSKEY_PROMPT_DOCUMENTS`), measured from the shipped bundle rather than
 * guessed: 1Password 8.12.44.33 shows its passkey sign-in and save prompts in
 * `inline/notification/notification.html` (`passkey-signin-prompt`,
 * `sign-in-with-passkey`, `select-passkey-item`, `use-system-passkeys` in
 * `notification.js`) and finishes them in
 * `inline/universal-sign-on/universal-sign-on.html` (`passkey-completed`, the
 * `webauthnCredential*` errors). The autofill menu (`inline/menu/menu.html`) is
 * NEVER admitted — it renders vault items next to the field an agent focused —
 * and neither is `modal.html`, which carries no passkey route. Every other
 * extension frame stays refused exactly as before.
 *
 * The GENERIC host document cannot tell its passive card from its passkey
 * prompt: the URL hash is `type=notificationManager` for every kind. So the
 * lock is not on the document alone, it is on the PERSON: a provider document
 * loads in an agent tab only after a trusted click into that tab
 * (`tab-engagement.ts`, itself driven from app chrome rather than a page's own
 * focus or input events, which CDP can imitate). Before that engagement the
 * frame is refused outright — the agent can neither read nor drive provider UI
 * it never caused to exist. After it, the person has put that tab in front of
 * themselves and the prompt may load.
 *
 * A passive card is then a NON-EVENT: it loads, it is never projected, it
 * raises no notice, no WAITING row and no refusal. Only a CEREMONY — a document
 * only passkey completion uses (`universal-sign-on.html`), or a request
 * corroborated by the tab's own evidence — is recorded here, and only a
 * ceremony is projected as the one dismissible corner notice.
 *
 * HOW IT ENDS. On its own when the prompt is gone (no admitted frame alive and
 * no provider frame in the committed tree), when the tab's main document
 * commits, when the tab closes, or when the tab changes hands. `dismiss` only
 * hides the notice and its row: it never releases, reloads or cancels anything.
 * There is no "Return to agent" and no reload — dismissing a notice must not
 * cancel the sign-in it describes (review U1/D3).
 */

import type { PendingAuthRequestView } from "../../../shared/browser-passkey-notice";
import { BrowserHostError } from "../errors";

/* The view the chrome paints is the SHARED wire type (`src/shared/
 * browser-passkey-notice.ts`), not a second copy: main and the renderer must
 * agree on this shape, and a local duplicate is how they stop agreeing. */
export type { PendingAuthRequestView };

/** Chrome Web Store id → the prompt documents (path, query and hash ignored)
 * that may be admitted into an agent tab. Measured per provider from the shipped
 * bundle; add one only with the same evidence. */
export const PASSKEY_PROMPT_DOCUMENTS: ReadonlyMap<string, readonly string[]> =
	new Map([
		[
			"aeblfdkhhhdcdjpifhhbdiojplfjncoa", // 1Password (measured 8.12.44.33)
			[
				"/inline/notification/notification.html",
				"/inline/universal-sign-on/universal-sign-on.html",
			],
		],
	]);

/** The subset of `PASSKEY_PROMPT_DOCUMENTS` that only a passkey ceremony uses,
 * so its admission alone means a person is being asked something
 * (`universal-sign-on.html` finishes 1Password's passkey sign-in). Every other
 * admitted document is the generic host and is never a request on its own. */
const CEREMONY_DOCUMENTS: ReadonlyMap<string, readonly string[]> = new Map([
	[
		"aeblfdkhhhdcdjpifhhbdiojplfjncoa",
		["/inline/universal-sign-on/universal-sign-on.html"],
	],
]);

/** The extension id of a frame URL that is a known passkey prompt document of
 * a provider, or null. Pure: whether that provider is INSTALLED is the caller's
 * question (`admit`). */
export function passkeyPromptProvider(url: string): string | null {
	const parsed = extensionUrl(url);
	if (!parsed) return null;
	const documents = PASSKEY_PROMPT_DOCUMENTS.get(parsed.hostname);
	if (!documents) return null;
	return documents.includes(parsed.pathname) ? parsed.hostname : null;
}

/** Whether an admitted document is a ceremony on its own, or only the generic
 * host that needs corroboration; null when the URL is not an admitted document
 * at all. */
export function passkeyPromptKind(url: string): "quiet" | "ceremony" | null {
	if (!passkeyPromptProvider(url)) return null;
	const parsed = extensionUrl(url);
	if (!parsed) return null;
	return CEREMONY_DOCUMENTS.get(parsed.hostname)?.includes(parsed.pathname)
		? "ceremony"
		: "quiet";
}

function extensionUrl(url: string): URL | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	return parsed.protocol === "chrome-extension:" ? parsed : null;
}

/**
 * A frame admitted as a provider prompt, as `will-frame-navigate` hands it over
 * (Electron's `WebFrameMain`). Structural so this module stays free of
 * `electron`. Only liveness is read: the frame's URL is not committed yet at
 * admission time, which is exactly why it is tracked (review R3).
 */
export interface AdmittedFrame {
	isDestroyed(): boolean;
}

/** The actions that can destroy or hijack a live request. Anything not in this
 * union is never refused: that is the whole point of this module. */
export type ConflictingAction = "close" | "navigate" | "prompt_document";

interface Request extends PendingAuthRequestView {
	webContentsId: number;
	/** The Chrome Web Store id of the prompt's extension, or null for a request
	 * with no provider document (a native/host request). Never shown to the
	 * renderer: the notice names no provider, so the copy never claims which
	 * manager is asking. */
	providerId: string | null;
	/**
	 * Every provider frame admitted for this request. A frame admitted moments
	 * ago has not COMMITTED yet, so a walk of the committed frame tree
	 * (`hasProviderFrame`) cannot see it; were the request ended then, the
	 * prompt would commit into a tab the agent is driving with nothing pending.
	 * A frame that is still alive therefore counts as present, whatever its URL
	 * says (fail closed). One that 1Password removed after the user answered is
	 * destroyed and stops counting.
	 */
	frames: AdmittedFrame[];
}

export interface AuthRequestOptions {
	/** A ceremony began. Called after the request is recorded, never before. */
	onBegin?: (view: PendingAuthRequestView) => void;
	/** A ceremony changed in place (its notice was dismissed). */
	onChange?: (view: PendingAuthRequestView) => void;
	/** A ceremony ended (prompt gone, tab closed or handed over). */
	onEnd?: (view: PendingAuthRequestView) => void;
	/**
	 * Whether this view's COMMITTED frame tree still holds a provider frame.
	 * Read by `sweep`; absent means "assume yes", so without it no request ends
	 * by itself (fail closed).
	 */
	hasProviderFrame?: (webContentsId: number) => boolean;
	log?: (message: string) => void;
	now?: () => number;
}

/**
 * Per-tab ceremony state. Keyed by webContents id because the enforcement
 * points that must be cheapest (`CdpPool.sendTo`) only know the view, not the
 * tab; `tabId` answers the projections.
 */
export class AuthRequests {
	private readonly requests = new Map<number, Request>();
	private sequence = 0;

	constructor(private readonly options: AuthRequestOptions = {}) {}

	/**
	 * Decide one provider-document navigation inside a tab. Returns true when
	 * the frame may load. A ceremony starts a request; a generic document
	 * (the passive autofill card) loads with NOTHING recorded, which is the fix
	 * for the reported bug: no notice, no WAITING row, no refusal, no pause.
	 *
	 * The CALLER decides whether to ask at all: only a tab a person has engaged
	 * (`tab-engagement.ts`) may admit. `isInstalled` must answer "installed,
	 * enabled and loaded" for the id: a document of an extension that is not
	 * running cannot be the prompt the user is waiting for.
	 */
	admit(request: {
		webContentsId: number;
		tabId: number;
		url: string;
		engaged: boolean;
		isInstalled: (extensionId: string) => boolean;
		/** The navigating frame; absent means "unknown", which is tracked as a
		 * frame that never goes away until the main document changes (fail
		 * closed). */
		frame?: AdmittedFrame | null;
		/** The tab's own independent evidence of a passkey ceremony (a pending
		 * `select-webauthn-account` or passkey notice): it starts a request even
		 * from the generic host. */
		corroborated?: boolean;
	}): boolean {
		const providerId = passkeyPromptProvider(request.url);
		if (!providerId) return false;
		// Engagement is the lock on the ambiguous document: an agent that opens a
		// tab or navigates to a login page admits nothing, so the passive card
		// never enters a tab nobody is looking at.
		if (!request.engaged) return false;
		let installed = false;
		try {
			installed = request.isInstalled(providerId);
		} catch {
			installed = false; // fail closed: an unanswerable check refuses
		}
		if (!installed) return false;
		const ceremony =
			request.corroborated === true ||
			passkeyPromptKind(request.url) === "ceremony";
		if (!ceremony) return true; // passive card: nothing to record, no hold
		const frame: AdmittedFrame = request.frame ?? NEVER_DESTROYED;
		const existing = this.requests.get(request.webContentsId);
		if (existing) {
			existing.frames.push(frame);
			return true;
		}
		this.sequence += 1;
		const requestId = `auth-${request.tabId}-${this.sequence}`;
		const record: Request = {
			webContentsId: request.webContentsId,
			tabId: request.tabId,
			requestId,
			at: (this.options.now ?? Date.now)(),
			kind: "ceremony",
			dismissed: false,
			providerId,
			frames: [frame],
		};
		this.requests.set(request.webContentsId, record);
		this.options.log?.(
			`[browser] tab ${request.tabId}: a passkey request from extension ${providerId} is live; the agent keeps working in this tab`,
		);
		this.project(() => this.options.onBegin?.(viewOf(record)), request.tabId);
		return true;
	}

	/**
	 * Record a request that has no provider document of its own: a
	 * native/host WebAuthn request this tab's document started. Idempotent per
	 * `requestId`, so the two callers that can see the same request cannot
	 * project it twice.
	 */
	beginNative(request: {
		webContentsId: number;
		tabId: number;
		requestId: string;
	}): PendingAuthRequestView | null {
		if (this.requests.has(request.webContentsId)) return null;
		const record: Request = {
			webContentsId: request.webContentsId,
			tabId: request.tabId,
			requestId: request.requestId,
			at: (this.options.now ?? Date.now)(),
			kind: "ceremony",
			dismissed: false,
			providerId: null,
			frames: [],
		};
		this.requests.set(request.webContentsId, record);
		this.project(() => this.options.onBegin?.(viewOf(record)), request.tabId);
		return viewOf(record);
	}

	/**
	 * A request with no provider document of its own was answered, expired or
	 * cancelled by the host (`WebauthnChooser`'s `onSettled`). Ends only THAT
	 * request: another tab's, or a newer request on this tab, is untouched.
	 */
	settleByRequestId(requestId: string): boolean {
		for (const record of this.requests.values()) {
			if (record.requestId !== requestId) continue;
			this.end(record, "the request was answered or expired");
			return true;
		}
		return false;
	}

	/**
	 * The person closed the notice (X or Esc). Hides the notice and its WAITING
	 * row and does NOTHING else: no release, no reload, no CDP — closing a
	 * notice must never cancel the sign-in it describes. A stale `requestId` (an
	 * earlier request's notice) is ignored.
	 */
	dismiss(tabId: number, requestId: string): boolean {
		const record = this.forTab(tabId);
		if (!record || record.requestId !== requestId || record.dismissed)
			return false;
		record.dismissed = true;
		this.project(() => this.options.onChange?.(viewOf(record)), tabId);
		return true;
	}

	/**
	 * End this view's request if its prompt is gone: no admitted frame alive and
	 * no provider frame in the committed tree. Returns whether a request is
	 * still live. Never reloads; an unreadable answer keeps the request (fail
	 * closed).
	 */
	sweep(webContentsId: number): boolean {
		const record = this.requests.get(webContentsId);
		if (!record) return false;
		let present = true;
		try {
			present =
				record.frames.some(isAlive) ||
				(this.options.hasProviderFrame?.(webContentsId) ?? true);
		} catch {
			present = true;
		}
		if (present) return true;
		this.end(record, "the request finished or its prompt closed");
		return false;
	}

	/** `sweep` every request; the host's liveness interval. */
	sweepAll(): void {
		for (const webContentsId of [...this.requests.keys()])
			this.sweep(webContentsId);
	}

	/** Whether any request is live (the host keeps its liveness interval only
	 * then). */
	hasRequests(): boolean {
		return this.requests.size > 0;
	}

	/**
	 * The one refusal every interfering action answers, or null when nothing
	 * here is in the way. Scoped to (request, action, tab): an unrelated action
	 * on the same tab, and every other tab, is untouched.
	 *
	 * Sweeps first, so an agent's own action is what clears a request whose
	 * prompt has already gone ("stale projections clear on agent continuation").
	 */
	conflict(
		webContentsId: number,
		action: ConflictingAction,
	): BrowserHostError | null {
		if (!this.requests.has(webContentsId)) return null;
		if (!this.sweep(webContentsId)) return null;
		const record = this.requests.get(webContentsId);
		return record ? authRequestRefusal(record, action) : null;
	}

	/** The request on this tab, for the chrome projection. */
	viewForTab(tabId: number): PendingAuthRequestView | null {
		const record = this.forTab(tabId);
		return record ? viewOf(record) : null;
	}

	/**
	 * The main frame of this view committed a new document. Every frame of the
	 * old document is gone with it, including one admitted without a handle, so
	 * drop those placeholders and let `sweep` decide on what is left. A page
	 * navigation is also the ordinary way a site's own request ends.
	 */
	committed(webContentsId: number): void {
		const record = this.requests.get(webContentsId);
		if (!record) return;
		record.frames = record.frames.filter((frame) => frame !== NEVER_DESTROYED);
		this.sweep(webContentsId);
	}

	/** The view is gone, or the tab changed hands: drop its request outright. */
	forget(webContentsId: number, why = "tab closed"): void {
		const record = this.requests.get(webContentsId);
		if (record) this.end(record, why);
	}

	private forTab(tabId: number): Request | undefined {
		for (const record of this.requests.values()) {
			if (record.tabId === tabId) return record;
		}
		return undefined;
	}

	private project(run: () => void, tabId: number): void {
		try {
			run();
		} catch (error) {
			// Projection only: the request's state is already updated, and a
			// presentation failure must never cancel the sign-in it describes.
			this.options.log?.(
				`[browser] tab ${tabId}: could not project the pending passkey request: ${String(error)}`,
			);
		}
	}

	private end(record: Request, why: string): void {
		this.requests.delete(record.webContentsId);
		this.options.log?.(
			`[browser] tab ${record.tabId}: the passkey request ended (${why})`,
		);
		this.project(() => this.options.onEnd?.(viewOf(record)), record.tabId);
	}
}

/** Stands in for a frame `will-frame-navigate` did not name: it never reports
 * destroyed, so the request outlives it until the main document changes
 * (`committed`), the tab closes or changes hands. */
const NEVER_DESTROYED: AdmittedFrame = { isDestroyed: () => false };

function isAlive(frame: AdmittedFrame): boolean {
	try {
		return !frame.isDestroyed();
	} catch {
		return true; // fail closed: an unreadable frame may still be there
	}
}

function viewOf(record: Request): PendingAuthRequestView {
	return {
		requestId: record.requestId,
		tabId: record.tabId,
		at: record.at,
		kind: record.kind,
		dismissed: record.dismissed,
	};
}

/** The one typed refusal an interfering action answers. `auth_request_pending`
 * rather than a bare ownership refusal, because the tab is NOT the user's: the
 * agent keeps it and only this action is in the way. The message names the
 * action so the agent can choose the other one instead of retrying. */
export const AUTH_REQUEST_REFUSAL_REASON = "auth_request_pending";

const ACTION_LABEL: Record<ConflictingAction, string> = {
	close: "closing that tab",
	navigate: "navigating that tab away",
	prompt_document: "reading or driving the password manager's prompt",
};

export function authRequestRefusal(
	request: PendingAuthRequestView,
	action: ConflictingAction,
): BrowserHostError {
	return new BrowserHostError(
		"owner_refused",
		`${ACTION_LABEL[action]} would cancel a passkey request the user is completing in that tab. The tab is still yours: query, screenshot, click, type and work in other tabs all continue, and this action works again when the request ends.`,
		{ reason: AUTH_REQUEST_REFUSAL_REASON, requestId: request.requestId },
	);
}
