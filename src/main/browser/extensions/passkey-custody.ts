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
 * plumbing is refused (`cdp.ts`), CDP events stop flowing to subscribers (so
 * screencast frames, console and network captures pause), and a command that
 * was already in flight when custody began has its RESULT dropped. The
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
 * KNOWN, ACCEPTED SIDE EFFECT. `notification.html` is 1Password's generic
 * notification host (its URL hash is `type=notificationManager` for every
 * kind), so a "save this login?" prompt after an agent signs in is admitted the
 * same way and also puts the tab in the human's custody. That prompt is the
 * human's decision too; the cost is that the agent waits for the user.
 *
 * A HOSTILE PAGE can embed the same web-accessible document itself. That buys it
 * custody (the agent pauses and the tab is brought to the user), never trust:
 * nothing here confirms, clicks or reads anything for the user.
 *
 * HOW IT ENDS. Only by a human: the "Return to agent" action in the tab's
 * custody notice (sender-checked IPC, no RPC method), or the tab closing. There
 * is no timer: an unattended prompt keeps the agent off the tab rather than
 * exposing it. A release that still finds a provider frame in the tab reloads
 * the page FIRST and lifts the hold only once the new document has committed
 * (the old document, and the frame with it, is gone by then).
 */

import { BrowserHostError } from "../errors";

/** Main → renderer: a hold began; bring this tab's conversation and browser
 * pane forward (the renderer half of the raise, like `browser-consent-attention`). */
export const PASSKEY_CUSTODY_ATTENTION_CHANNEL =
	"browser-passkey-custody-attention";

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

/** The extension id of a frame URL that is a known passkey prompt document of
 * a provider, or null. Pure: whether that provider is INSTALLED is the caller's
 * question (`admit`). */
export function passkeyPromptProvider(url: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== "chrome-extension:") return null;
	const documents = PASSKEY_PROMPT_DOCUMENTS.get(parsed.hostname);
	if (!documents) return null;
	return documents.includes(parsed.pathname) ? parsed.hostname : null;
}

export interface CustodyView {
	tabId: number;
	/** When the hold began: the renderer echoes it back on release, so a click on
	 * a notice from an EARLIER hold cannot end a later one. */
	at: number;
	providerId: string;
}

interface Hold extends CustodyView {
	webContentsId: number;
	/** Set while a release is waiting for the reload's commit. */
	releasing: boolean;
}

export type CustodyRelease =
	| { ok: true; reloaded: boolean }
	| { ok: false; reason: "not_held" | "stale" };

export interface PasskeyCustodyOptions {
	/** A hold began: bring the tab to the user. Called after the hold is in
	 * place, never before. */
	onBegin?: (view: CustodyView) => void;
	/** A hold ended (released or the tab went away). */
	onEnd?: (view: CustodyView) => void;
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
	 * `isInstalled` must answer "installed, enabled and loaded" for the id: a
	 * document of an extension that is not running cannot be the prompt the user
	 * is waiting for.
	 */
	admit(request: {
		webContentsId: number;
		tabId: number;
		url: string;
		isInstalled: (extensionId: string) => boolean;
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
		const existing = this.holds.get(request.webContentsId);
		if (existing && !existing.releasing) return true;
		if (existing?.releasing) {
			// A prompt reappeared while a release waits for its reload: keep the hold
			// and cancel the pending release, the user has something to answer again.
			existing.releasing = false;
			return true;
		}
		const hold: Hold = {
			webContentsId: request.webContentsId,
			tabId: request.tabId,
			at: (this.options.now ?? Date.now)(),
			providerId,
			releasing: false,
		};
		this.epochs.set(
			request.webContentsId,
			(this.epochs.get(request.webContentsId) ?? 0) + 1,
		);
		this.holds.set(request.webContentsId, hold);
		this.options.log?.(
			`[browser] tab ${request.tabId}: a passkey prompt from extension ${providerId} needs the user; agent access to the tab is paused`,
		);
		try {
			this.options.onBegin?.(viewOf(hold));
		} catch (error) {
			// The hold stands even if bringing the tab forward failed.
			this.options.log?.(
				`[browser] tab ${request.tabId}: could not bring the passkey prompt to the user: ${String(error)}`,
			);
		}
		return true;
	}

	/** Whether agent access to this view is paused. */
	isHeld(webContentsId: number): boolean {
		return this.holds.has(webContentsId);
	}

	/** The hold generation of this view; see `epochs`. */
	epoch(webContentsId: number): number {
		return this.epochs.get(webContentsId) ?? 0;
	}

	/** The hold on this tab, for the chrome projection. */
	viewForTab(tabId: number): CustodyView | null {
		for (const hold of this.holds.values()) {
			if (hold.tabId === tabId) return viewOf(hold);
		}
		return null;
	}

	/**
	 * The user's "Return to agent". `hasProviderFrame` reads the tab's frames NOW;
	 * when one is still there, `reload` starts a navigation and the hold stays
	 * until `committed` is called for that view.
	 */
	release(request: {
		tabId: number;
		at: number;
		hasProviderFrame: (webContentsId: number) => boolean;
		reload: (webContentsId: number) => void;
	}): CustodyRelease {
		const hold = [...this.holds.values()].find(
			(candidate) => candidate.tabId === request.tabId,
		);
		if (!hold) return { ok: false, reason: "not_held" };
		if (hold.at !== request.at) return { ok: false, reason: "stale" };
		let framePresent = true;
		try {
			framePresent = request.hasProviderFrame(hold.webContentsId);
		} catch {
			framePresent = true; // fail closed: unknown means reload first
		}
		if (!framePresent) {
			this.end(hold, "returned by the user");
			return { ok: true, reloaded: false };
		}
		hold.releasing = true;
		this.options.log?.(
			`[browser] tab ${hold.tabId}: returning to the agent after a reload, so no extension frame outlives the hold`,
		);
		try {
			request.reload(hold.webContentsId);
		} catch (error) {
			hold.releasing = false;
			this.options.log?.(
				`[browser] tab ${hold.tabId}: reload before release failed, the hold stays: ${String(error)}`,
			);
			return { ok: false, reason: "not_held" };
		}
		return { ok: true, reloaded: true };
	}

	/** The main frame of this view committed a new document. Lifts a hold that
	 * was waiting for exactly that; a hold the user has not returned stays (the
	 * sign-in's own redirect does not end it). */
	committed(webContentsId: number): void {
		const hold = this.holds.get(webContentsId);
		if (hold?.releasing) this.end(hold, "returned by the user after a reload");
	}

	/** The view is gone: drop its hold without any release ceremony. */
	forget(webContentsId: number): void {
		const hold = this.holds.get(webContentsId);
		if (hold) this.end(hold, "tab closed");
		this.epochs.delete(webContentsId);
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

function viewOf(hold: Hold): CustodyView {
	return { tabId: hold.tabId, at: hold.at, providerId: hold.providerId };
}

/** The refusal every agent path answers while a tab is held: one message, so
 * the agent learns what to do (wait, or use another tab) and nothing about the
 * prompt itself. `owner_refused` because the tab is, for now, the user's. */
export const CUSTODY_REFUSAL_REASON = "passkey_custody";

export function custodyRefusal(): BrowserHostError {
	return new BrowserHostError(
		"owner_refused",
		"a passkey prompt in that tab is waiting for the user, so agent access to it is paused until they return it; wait, or work in another tab",
		{ reason: CUSTODY_REFUSAL_REASON },
	);
}
