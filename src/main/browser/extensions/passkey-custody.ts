/**
 * Passkey custody: how a password manager's passkey prompt can appear in a tab
 * an AGENT drives without the agent ever reading or answering it.
 *
 * WHY THIS EXISTS (operator report, 2026-11-11). Microsoft's sign-in
 * (`login.microsoft.com/consumers/fido/get`) sat on "Face, fingerprint, PIN or
 * security key" with Try again disabled in an agent-driven tab, while the SAME
 * sign-in completed in a tab the operator opened. The divergence was ours:
 * `subframe-policy.ts` refuses every `chrome-extension://` subframe in an agent
 * tab, and 1Password answers WebAuthn in page script and shows its passkey
 * prompt in exactly such a subframe. Measured on the installed 0.54.1 with
 * 1Password 8.12.44.33 (synthetic RP on http://localhost): 1Password installs an
 * ACCESSOR `get` on the `navigator.credentials` instance
 * (`async function L(e){return await q(e?.publicKey?.hints)?H(e):d.credentials.get(e…`),
 * so a request it serves never reaches the app's own prototype-level page shim
 * (`passkey-notice.ts`). The only signal that is not raced by the page or the
 * extension is the frame navigation main sees, so custody is decided there.
 *
 * WHAT CUSTODY IS. While a tab is held, the tab is the human's in everything but
 * name: every agent action on it is refused before dispatch (`registry.ts`
 * `requireSurface`), every CDP command except the origin gate's own `Fetch`
 * plumbing and capture TEARDOWN is refused (`cdp.ts`), CDP events stop flowing
 * to subscribers (console and network captures see nothing of the hold), and a
 * command that was already in flight when custody began has its RESULT dropped.
 * A recording is not paused but DISCARDED at the moment the hold begins
 * (`onHold` → `discardRecordingForCustody`): Chromium's default recorder
 * (`Page.startScreenRecording`) encodes the composited surface with no CDP
 * event to filter, so a "paused" clip would still contain the prompt and hand
 * it to the agent at `record_stop` (review R1/Q1). The
 * provider's frame is admitted only AFTER the hold is in place, synchronously in
 * `will-frame-navigate`, so there is no moment at which the frame exists and an
 * agent read is allowed.
 *
 * WHAT IS ADMITTED, and why so narrowly. Only an installed, enabled extension's
 * known prompt documents (`PASSKEY_PROMPT_DOCUMENTS`), measured from the
 * shipped bundle rather than guessed: 1Password 8.12.44.33 shows its passkey
 * sign-in and save prompts in `inline/notification/notification.html`
 * (`passkey-signin-prompt`, `sign-in-with-passkey`, `select-passkey-item`,
 * `use-system-passkeys` in `notification.js`) and finishes them in
 * `inline/universal-sign-on/universal-sign-on.html` (`passkey-completed`, the
 * `webauthnCredential*` errors). The autofill menu (`inline/menu/menu.html`) is
 * NEVER admitted — it renders vault items next to the field an agent focused —
 * and neither is `modal.html`, which carries no passkey route. Every other
 * extension frame stays refused exactly as before.
 *
 * NOT EVERY ADMITTED FRAME IS A REQUEST FOR THE PERSON (operator report
 * 2026-11-17). `notification.html` is 1Password's GENERIC notification host: its
 * URL hash is `type=notificationManager` for every kind, and it also renders the
 * PASSIVE inline autofill card ("Sign in" / Other logins) that appears on any
 * login form. Admitting it the way this file used to — every admission a hold,
 * every hold a full-width "Your password manager needs you" banner, a paused
 * agent and a "Password manager needs you" WAITING row — put several agent tabs
 * on login pages into WAITING at once with nobody asked anything. Two changes:
 *
 *   1. NO ADMISSION BEFORE A PERSON ENGAGES THE TAB. The caller admits only when
 *      a person has clicked into that agent tab (`tab-engagement.ts`). An agent
 *      opening a tab or navigating to a login page produces nothing: the frame is
 *      refused exactly as before custody existed, so the agent runs untouched.
 *   2. TWO KINDS OF HOLD. A `quiet` hold (`notification.html` on its own: the URL
 *      cannot tell the passive card from a passkey prompt) locks the agent out of
 *      THAT tab only — the card shows vault identities, so agent CDP must not
 *      capture it — and says nothing: no notice, no WAITING row. A `ceremony`
 *      hold (`universal-sign-on.html`, which only passkey completion uses, or a
 *      quiet hold PROMOTED by corroborating evidence: the tab's own
 *      `select-webauthn-account` or passkey-notice signal) is the one real
 *      "a person is needed" state: the same lock plus ONE dismissible notice in
 *      the approvals corner card and ONE WAITING row. Dismissing the notice
 *      (`dismiss`) only hides it and the row; it never releases, reloads or
 *      cancels anything.
 *
 * A HOSTILE PAGE can embed the same web-accessible document itself. Before
 * engagement that buys nothing (refused); after it, a quiet lock on a tab the
 * person is already in, never trust: nothing here confirms, clicks or reads
 * anything for the user.
 *
 * HOW IT ENDS. On its own, when the prompt is gone (`sweep`): no admitted
 * frame is alive any more AND the committed frame tree holds no provider frame.
 * That test is what used to gate "Return to agent"'s no-reload path, so the
 * frame can never commit into an agent-readable tab. It runs lazily in `isHeld`
 * (the agent's next action), on the tab's frame navigations and on a liveness
 * interval the host keeps only while a hold exists — a liveness check, not an
 * expiry: an unattended prompt keeps the agent off the tab. Otherwise the tab
 * closing or being handed over ends it. There is no "Return to agent" and no
 * reload any more (2026-11-17): the reload cancelled whatever sign-in the person
 * had half done, and a hold that ends by itself needs no button.
 */

import { BrowserHostError } from "../errors";

/** Main → renderer: the hold `{tabId, at}` ended (prompt gone, or the tab
 * closed). The renderer gives the user back the view it saved for that hold
 * (only when they opened it from its sidebar notification), if they are still
 * where the handoff put them (`passkey-custody-handoff.ts`). */
export const PASSKEY_CUSTODY_ENDED_CHANNEL = "browser-passkey-custody-ended";

/** Chrome Web Store id → the prompt documents (path, query and hash ignored)
 * that may be admitted under custody. Measured per provider; add one only with
 * the same evidence. */
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
 * admitted document is the generic host and starts `quiet`. */
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

/** Which hold an admitted prompt document starts on its own; null when the URL
 * is not an admitted document at all. */
export function passkeyPromptKind(url: string): CustodyKind | null {
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
 * A frame admitted under a hold, as `will-frame-navigate` hands it over
 * (Electron's `WebFrameMain`). Structural so this module stays free of
 * `electron`. Only liveness is read: the frame's URL is not committed yet at
 * admission time, which is exactly why it is tracked (review R3).
 */
export interface AdmittedFrame {
	isDestroyed(): boolean;
}

/**
 * `quiet`: the agent is locked out of the tab and nothing else happens (the
 * passive autofill card, or a prompt the URL cannot classify). `ceremony`: a
 * person is genuinely being asked; one notice and one WAITING row.
 */
export type CustodyKind = "quiet" | "ceremony";

export interface CustodyView {
	tabId: number;
	/** When the hold began: the renderer echoes it back on dismiss, so a click on
	 * a notice from an EARLIER hold cannot touch a later one. */
	at: number;
	providerId: string;
	kind: CustodyKind;
	/** The person closed the notice (X or Esc). Presentation only: the lock
	 * stays until the prompt is gone. */
	dismissed: boolean;
}

interface Hold extends CustodyView {
	webContentsId: number;
	/**
	 * Every provider frame admitted during this hold. A frame admitted moments
	 * ago has not COMMITTED yet, so a walk of the committed frame tree
	 * (`hasProviderFrame`) cannot see it; were the hold lifted then, the prompt
	 * would commit into an agent-readable tab. A frame that is still alive
	 * therefore counts as present, whatever its URL says (fail closed). One that
	 * 1Password removed after the user answered is destroyed and stops counting.
	 */
	frames: AdmittedFrame[];
}

export interface PasskeyCustodyOptions {
	/**
	 * A hold began on this view: end every capture that would keep running
	 * underneath it (a recording). Called synchronously, after the hold is in
	 * place and BEFORE `onBegin`, inside the same `will-frame-navigate` turn, so
	 * the prompt frame's document does not exist yet when the capture ends. Kept
	 * apart from `onBegin` so a failure to project the hold cannot skip it.
	 */
	onHold?: (webContentsId: number) => void;
	/** A hold began. Called after the hold is in place, never before. */
	onBegin?: (view: CustodyView) => void;
	/** A hold changed in place: promoted to `ceremony`, or its notice dismissed. */
	onChange?: (view: CustodyView) => void;
	/** A hold ended (prompt gone, or the tab went away). */
	onEnd?: (view: CustodyView) => void;
	/**
	 * Whether this view's COMMITTED frame tree still holds a provider frame. Read
	 * by `sweep`; absent means "assume yes", so without it no hold ends by itself
	 * (fail closed).
	 */
	hasProviderFrame?: (webContentsId: number) => boolean;
	log?: (message: string) => void;
	now?: () => number;
}

/**
 * Per-tab custody state. Keyed by webContents id because the two enforcement
 * points that must be cheapest (`CdpPool.sendTo`, `routeEvent`) only know the
 * view, not the tab.
 */
export class PasskeyCustody {
	private readonly holds = new Map<number, Hold>();
	/** Bumped at every hold, so a CDP result that was in flight across the start
	 * of a hold can be recognised and dropped (`cdp.ts`). Never reset per view. */
	private readonly epochs = new Map<number, number>();

	constructor(private readonly options: PasskeyCustodyOptions = {}) {}

	/**
	 * Decide one agent-tab extension subframe navigation. Returns true when the
	 * frame may load — and in that case the hold is ALREADY in place.
	 *
	 * The CALLER decides whether to ask at all: only a tab a person has engaged
	 * (`tab-engagement.ts`) may admit. `isInstalled` must answer "installed,
	 * enabled and loaded" for the id: a document of an extension that is not
	 * running cannot be the prompt the user is waiting for. `corroborated` is the
	 * tab's own independent evidence of a passkey ceremony (a pending
	 * `select-webauthn-account` or passkey notice): it starts the hold as a
	 * ceremony even from the generic host.
	 */
	admit(request: {
		webContentsId: number;
		tabId: number;
		url: string;
		isInstalled: (extensionId: string) => boolean;
		/** The navigating frame; absent means "unknown", which is tracked as a frame
		 * that never goes away until the main document changes (fail closed). */
		frame?: AdmittedFrame | null;
		corroborated?: boolean;
	}): boolean {
		const providerId = passkeyPromptProvider(request.url);
		if (!providerId) return false;
		let installed = false;
		try {
			installed = request.isInstalled(providerId);
		} catch {
			installed = false; // fail closed: an unanswerable check refuses
		}
		if (!installed) return false;
		const kind: CustodyKind =
			request.corroborated === true ||
			passkeyPromptKind(request.url) === "ceremony"
				? "ceremony"
				: "quiet";
		const frame: AdmittedFrame = request.frame ?? NEVER_DESTROYED;
		const existing = this.holds.get(request.webContentsId);
		if (existing) {
			existing.frames.push(frame);
			// Same hold identity (`at`), so one notice and one row per prompt: a page
			// that keeps re-embedding the document cannot multiply them. A ceremony
			// document arriving under a quiet hold is the evidence that promotes it.
			if (kind === "ceremony") this.promoteHold(existing);
			return true;
		}
		const hold: Hold = {
			webContentsId: request.webContentsId,
			tabId: request.tabId,
			at: (this.options.now ?? Date.now)(),
			providerId,
			kind,
			dismissed: false,
			frames: [frame],
		};
		this.epochs.set(
			request.webContentsId,
			(this.epochs.get(request.webContentsId) ?? 0) + 1,
		);
		this.holds.set(request.webContentsId, hold);
		this.options.log?.(
			`[browser] tab ${request.tabId}: a ${kind} prompt from extension ${providerId} is up after the user engaged the tab; agent access to the tab is paused`,
		);
		try {
			this.options.onHold?.(request.webContentsId);
		} catch (error) {
			this.options.log?.(
				`[browser] tab ${request.tabId}: could not end a capture at the start of passkey custody: ${String(error)}`,
			);
		}
		try {
			this.options.onBegin?.(viewOf(hold));
		} catch (error) {
			// The hold stands even if projecting it failed.
			this.options.log?.(
				`[browser] tab ${request.tabId}: could not project the passkey custody hold: ${String(error)}`,
			);
		}
		return true;
	}

	/**
	 * Corroborating evidence for this tab (its own `select-webauthn-account`, or
	 * a passkey notice the page shim raised) turns a quiet hold into a ceremony.
	 * False when the tab has no hold or is already a ceremony.
	 */
	promote(tabId: number): boolean {
		const hold = this.holdForTab(tabId);
		return hold ? this.promoteHold(hold) : false;
	}

	private promoteHold(hold: Hold): boolean {
		if (hold.kind === "ceremony") return false;
		hold.kind = "ceremony";
		this.options.log?.(
			`[browser] tab ${hold.tabId}: the password manager prompt is a passkey ceremony; telling the user`,
		);
		this.changed(hold);
		return true;
	}

	/**
	 * The person closed the notice (X or Esc). Hides the notice and its WAITING
	 * row and does NOTHING else: no release, no reload, no CDP — closing a notice
	 * must never cancel the sign-in it describes. A stale `at` (an earlier hold's
	 * notice) is ignored.
	 */
	dismiss(tabId: number, at: number): boolean {
		const hold = this.holdForTab(tabId);
		if (!hold || hold.at !== at || hold.dismissed) return false;
		hold.dismissed = true;
		this.changed(hold);
		return true;
	}

	/**
	 * End this view's hold if its prompt is gone: no admitted frame alive and no
	 * provider frame in the committed tree. Returns whether the view is still
	 * held. Never reloads; an unreadable answer keeps the hold (fail closed).
	 */
	sweep(webContentsId: number): boolean {
		const hold = this.holds.get(webContentsId);
		if (!hold) return false;
		let present = true;
		try {
			present =
				hold.frames.some(isAlive) ||
				(this.options.hasProviderFrame?.(webContentsId) ?? true);
		} catch {
			present = true;
		}
		if (present) return true;
		this.end(hold, "the prompt closed");
		return false;
	}

	/** `sweep` every hold; the host's liveness interval. */
	sweepAll(): void {
		for (const webContentsId of [...this.holds.keys()])
			this.sweep(webContentsId);
	}

	/** Whether any hold exists (the host keeps its liveness interval only then). */
	hasHolds(): boolean {
		return this.holds.size > 0;
	}

	/** Whether agent access to this view is paused. Sweeps first, so the agent's
	 * next action is what lifts a hold whose prompt has already gone. */
	isHeld(webContentsId: number): boolean {
		if (!this.holds.has(webContentsId)) return false;
		return this.sweep(webContentsId);
	}

	/** The hold generation of this view; see `epochs`. */
	epoch(webContentsId: number): number {
		return this.epochs.get(webContentsId) ?? 0;
	}

	/** The hold on this tab, for the chrome projection. */
	viewForTab(tabId: number): CustodyView | null {
		const hold = this.holdForTab(tabId);
		return hold ? viewOf(hold) : null;
	}

	/** Every hold, for the WAITING projection (which keeps only undismissed
	 * ceremonies). */
	views(): CustodyView[] {
		return [...this.holds.values()].map(viewOf);
	}

	/**
	 * The main frame of this view committed a new document. Every frame of the
	 * old document is gone with it, including one admitted without a handle, so
	 * drop those placeholders and let `sweep` decide on what is left.
	 */
	committed(webContentsId: number): void {
		const hold = this.holds.get(webContentsId);
		if (!hold) return;
		hold.frames = hold.frames.filter((frame) => frame !== NEVER_DESTROYED);
		this.sweep(webContentsId);
	}

	/** The view is gone, or the tab changed hands: drop its hold outright. */
	forget(webContentsId: number, why = "tab closed"): void {
		const hold = this.holds.get(webContentsId);
		if (hold) this.end(hold, why);
		if (why === "tab closed") this.epochs.delete(webContentsId);
	}

	private holdForTab(tabId: number): Hold | undefined {
		for (const hold of this.holds.values()) {
			if (hold.tabId === tabId) return hold;
		}
		return undefined;
	}

	private changed(hold: Hold): void {
		try {
			this.options.onChange?.(viewOf(hold));
		} catch {
			// Projection only; the hold's state is already updated.
		}
	}

	private end(hold: Hold, why: string): void {
		this.holds.delete(hold.webContentsId);
		this.options.log?.(
			`[browser] tab ${hold.tabId}: passkey custody ended (${why}); agent access resumes`,
		);
		try {
			this.options.onEnd?.(viewOf(hold));
		} catch {
			// Restoring the user's previous view is a courtesy, never the release.
		}
	}
}

/** Stands in for a frame `will-frame-navigate` did not name: it never reports
 * destroyed, so the hold outlives it until the main document changes
 * (`committed`), the tab closes or changes hands. */
const NEVER_DESTROYED: AdmittedFrame = { isDestroyed: () => false };

function isAlive(frame: AdmittedFrame): boolean {
	try {
		return !frame.isDestroyed();
	} catch {
		return true; // fail closed: an unreadable frame may still be there
	}
}

function viewOf(hold: Hold): CustodyView {
	return {
		tabId: hold.tabId,
		at: hold.at,
		providerId: hold.providerId,
		kind: hold.kind,
		dismissed: hold.dismissed,
	};
}

/** The refusal every agent path answers while a tab is held: one message, so
 * the agent learns what to do (wait, or use another tab) and nothing about the
 * prompt itself. `owner_refused` because the tab is, for now, the user's. */
export const CUSTODY_REFUSAL_REASON = "passkey_custody";

export function custodyRefusal(): BrowserHostError {
	return new BrowserHostError(
		"owner_refused",
		"a password manager prompt is open in that tab for the user, so agent access to it is paused until the prompt closes; wait, or work in another tab",
		{ reason: CUSTODY_REFUSAL_REASON },
	);
}
