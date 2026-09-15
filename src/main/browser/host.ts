import type { BrowserActionContext, HostFacts } from "./actions/context";
import { requesterOf } from "./actions/context";
import { withOriginGate } from "./actions/gate";
import * as inputActions from "./actions/input";
import * as pageActions from "./actions/page";
import * as tabActions from "./actions/tabs";
import { BrowserHostError } from "./errors";
import { COMMAND_TIMEOUTS_S, type Method, PROTO_VERSION } from "./protocol";
import type { ContentRect, TabRecord } from "./registry";
import { redactToken, surfaceToken } from "./registry";
import { permittedScheme } from "./settle";

/**
 * The command dispatcher, and the operations the app's own chrome uses.
 * Design: docs/design/ui-browser-tab.md 4 (the method matrix), 6.4 (per-tab
 * serialisation), 10.5 (the ownership lane), 11.2 (layout authority).
 *
 * The dispatcher is deliberately thin: it decides what may run concurrently, what
 * the ownership gate applies to, and which action a method names. Every decision
 * with a rule behind it lives in the action, the registry or the approval store.
 *
 * THE ORDER OF THE TWO GATES, which is not arbitrary:
 * 1. the per-tab lane (`busy` rather than a silent queue), because a second
 *    command arriving on a tab must be refused before it does any work at all;
 * 2. the ownership lane, inside the tab lane, because `owner_finish` closing a
 *    tab must not overtake that same owner's in-flight `goto`.
 */

/**
 * The actions whose result describes the CURRENT document, and therefore must be
 * authorized against it — on entry and again on the result (see
 * `authorizedPerform`, and `NAVIGATION_ACTIONS` for the one thing the two
 * families of action answer differently). Narrower than `TAB_SCOPED`: `close` and
 * `retitle` address a tab but say nothing about its document.
 */
const DOCUMENT_SCOPED: ReadonlySet<string> = new Set([
	"read",
	"snapshot",
	"screenshot",
	"click",
	"type",
	"scroll",
	"logs",
]);

/**
 * The actions that can start a navigation by themselves, and so the only ones that
 * need the per-hop Document gate armed around them.
 *
 * `open` and `goto` arm it from the navigation itself (`navigateView`), so what is
 * left is the pair that navigates because a PAGE decides to: a click follows a link
 * or submits a form, a type can submit one. Arming `Fetch.enable` around the rest
 * is not free and buys nothing: they cannot change which document is current, so
 * there is no agent-initiated hop for the gate to decide, while its Document-stage
 * interception also fails the PAGE's own subresource and third-party-iframe loads
 * with `BlockedByClient` — a side effect on the page the user is watching that the
 * page can observe. Their protection is the entry and result authorization in
 * `authorizedPerform` — where the result is authorized against the document it
 * actually came from — together with this per-hop gate, which is what refuses a
 * page-initiated escape before it is fetched (review round 1, R5).
 */
const NAVIGATION_ACTIONS: ReadonlySet<string> = new Set(["click", "type"]);

/** The methods that address one tab and therefore take that tab's command lane. */
const TAB_SCOPED: ReadonlySet<string> = new Set([
	"goto",
	"read",
	"snapshot",
	"screenshot",
	"click",
	"type",
	"scroll",
	"logs",
	"close",
	"retitle",
]);

export interface BrowserHostOptions {
	registry: BrowserActionContext["registry"];
	cdp: BrowserActionContext["cdp"];
	approvals: BrowserActionContext["approvals"];
	ownership: BrowserActionContext["ownership"];
	log: (message: string) => void;
	onChanged: () => void;
	facts: () => HostFacts;
}

export class BrowserHost implements BrowserActionContext {
	readonly registry: BrowserActionContext["registry"];
	readonly cdp: BrowserActionContext["cdp"];
	readonly approvals: BrowserActionContext["approvals"];
	readonly ownership: BrowserActionContext["ownership"];
	readonly log: (message: string) => void;
	readonly onChanged: () => void;
	readonly facts: () => HostFacts;

	constructor(options: BrowserHostOptions) {
		this.registry = options.registry;
		this.cdp = options.cdp;
		this.approvals = options.approvals;
		this.ownership = options.ownership;
		this.log = options.log;
		this.onChanged = options.onChanged;
		this.facts = options.facts;
	}

	/** Answer one wire request. The only place a method name becomes an action. */
	async dispatch(
		method: string,
		params: Record<string, unknown>,
		requestId: string,
	): Promise<Record<string, unknown>> {
		const run = (): Promise<Record<string, unknown>> =>
			this.ownership.withOwnership(method, params, () =>
				this.authorizedPerform(method, params, requestId),
			);
		if (
			TAB_SCOPED.has(method) &&
			typeof params.tab === "string" &&
			params.tab
		) {
			// Resolve the tab FIRST so the lane is keyed on the real tab and a bad
			// handle is refused by the same code path as any other action.
			const record = this.registry.requireSurface(params.tab);
			return this.registry.lane(record.tabId, run);
		}
		return run();
	}

	private async authorizedPerform(
		method: string,
		params: Record<string, unknown>,
		requestId: string,
	): Promise<Record<string, unknown>> {
		if (!DOCUMENT_SCOPED.has(method))
			return this.perform(method, params, requestId);
		const token = String(params.tab ?? "");
		const record = this.registry.requireSurface(token);
		const requester = requesterOf(params, requestId);
		// THE DOCUMENT THE CHECKS BELOW ARE MADE AGAINST, and the one thing the two
		// families of document-scoped action answer differently.
		//
		// A URL check alone cannot say "the same document throughout": a page can
		// leave for an unapproved origin and come straight back, and the return check
		// would then see the approved URL again while the result in hand came from the
		// other one (review round 1, R4). Every top-level navigation bumps
		// `documentEpoch`, so that is the fact that says which document is current,
		// and this baseline is what the pair of URL checks is measured against.
		//
		// For the NON-NAVIGATING read family the baseline is the document the call
		// entered on and must not move: they cannot change which document is current,
		// so a change underneath one means it raced a navigation it did not cause, and
		// nothing they hold may be described as coming from the document they entered
		// on.
		//
		// `click`/`type` are the opposite case and must NOT be held to it: a document
		// change is the EXPECTED consequence of the action — following a link or
		// submitting a form IS the action — and the navigation the action itself
		// performed bumps the same epoch, so holding them to the entry epoch refused
		// every link-following click and form submit on an approved origin and
		// reported a failure that contradicted the state it described (QA round 2,
		// Q2). What they must hold instead is that the document the RESULT comes from
		// is authorized for this action: the baseline follows a navigation, and the
		// authorization below is then applied to the document they landed on — so an
		// unapproved landing fails the same check a read on that page fails, and,
		// being gated `NAVIGATION_ACTIONS`, fails before the hop is fetched rather
		// than after it arrives.
		let authorizedOn = record.documentEpoch;
		const assertDocument = (): URL => {
			const url = new URL(record.view.webContents.getURL() || "about:blank");
			if (record.documentEpoch !== authorizedOn) {
				if (!NAVIGATION_ACTIONS.has(method)) {
					// The document this action is authorized against is gone, so nothing it
					// returns may be described as coming from it. Refused with the code the
					// session already branches on, and a `reason` that names what happened
					// rather than blaming a URL that may well be approved — the round trip is
					// exactly the case whose URL is.
					this.registry.bumpEpoch(record.tabId);
					throw new BrowserHostError(
						"origin_not_allowed",
						"the page navigated while this action was running; its result was discarded",
						{ origin: url.origin, url: url.href, reason: "changed" },
					);
				}
				// The action's own navigation, adopted BEFORE it is authorized so every
				// check either side of `perform` judges the document the result actually
				// describes rather than one that no longer exists. Adopting the epoch is
				// not an exemption from the authorization below, which is why an action
				// that lands somewhere unapproved still fails it.
				authorizedOn = record.documentEpoch;
			}
			if (
				!permittedScheme(url) ||
				!this.approvals.documentAllowed(token, url, requester, authorizedOn)
			) {
				this.registry.bumpEpoch(record.tabId);
				this.approvals.refuseDocument(url);
			}
			return url;
		};
		assertDocument();
		// Entry authorization alone leaks data if a document changes during an
		// await: the result is checked again before it is returned, so an autonomous
		// later navigation has to pass a new check. An action that can start a
		// navigation of its own also gets the per-hop Document gate; see
		// `NAVIGATION_ACTIONS` for why the others are deliberately not wrapped in it.
		const operation = async (): Promise<Record<string, unknown>> => {
			assertDocument();
			const result = await this.perform(method, params, requestId);
			assertDocument();
			return result;
		};
		if (!NAVIGATION_ACTIONS.has(method)) return operation();
		return withOriginGate(
			this,
			record.view,
			requester,
			(url) =>
				this.approvals.documentAllowed(
					token,
					url,
					requester,
					record.documentEpoch,
				),
			operation,
		);
	}

	private async perform(
		method: string,
		params: Record<string, unknown>,
		requestId: string,
	): Promise<Record<string, unknown>> {
		switch (method as Method) {
			case "open":
				return tabActions.open(this, params, requestId);
			case "goto":
				return tabActions.goto(this, params, requestId);
			case "close":
				return tabActions.close(this, params);
			case "tabs":
				return tabActions.tabs(this, params, requestId);
			case "status":
				return tabActions.status(this, params, requestId);
			case "retitle":
				return tabActions.retitle();
			case "read":
				return pageActions.read(this, params);
			case "snapshot":
				return pageActions.snapshot(this, params);
			case "scroll":
				return pageActions.scroll(this, params);
			case "logs":
				return pageActions.logs(this, params);
			case "screenshot":
				return pageActions.screenshot(this, params);
			case "click":
				return inputActions.click(this, params);
			case "type":
				return inputActions.type(this, params);
			case "request_access":
				return this.approvals.requestAccess(
					params.url,
					requesterOf(params, requestId),
					"async",
					requestId,
				);
			case "await_access":
				return this.awaitAccess(params, requestId);
			case "cancel_access":
				return this.approvals.cancelAccess(
					params.url,
					requesterOf(params, requestId),
				);
			case "owner_recover":
			case "owner_finish":
			case "owner_retain":
			case "owner_release":
				// Reaching here means the ownership lane ran the gate and produced no
				// answer of its own. Every `owner_*` method returns from the gate, and a
				// proof-less call is refused by the gate's own `owner_refused` (Q2), so
				// this arm is a backstop for a future method added to the wire without a
				// branch here — a typed refusal beats an undefined result.
				throw new BrowserHostError(
					"owner_refused",
					`${method} is not answered by this host's ownership lane`,
				);
			default:
				throw new BrowserHostError(
					"internal",
					`unsupported method '${method}'`,
				);
		}
	}

	/**
	 * `await_access`: poll in bounded slices.
	 *
	 * The slice cap is the extension's `AWAIT_SLICE_MS` (20 s), and the caller's
	 * own `timeout_ms` may only shorten it. The session loops slices client-side,
	 * which is why this stays an honest per-RPC bound instead of blocking for as
	 * long as the user takes to answer.
	 */
	private async awaitAccess(
		params: Record<string, unknown>,
		requestId: string,
	): Promise<Record<string, unknown>> {
		const requester = requesterOf(params, requestId);
		const requested = Number(params.timeout_ms);
		const sliceMs = Math.min(
			Number.isFinite(requested) && requested > 0 ? requested : AWAIT_SLICE_MS,
			AWAIT_SLICE_MS,
		);
		const deadlineAt = Date.now() + sliceMs;
		for (;;) {
			const current = this.approvals.accessStateFor(params.url, requester);
			if (current.state !== "pending" || Date.now() >= deadlineAt)
				return current;
			await new Promise((resolve) => setTimeout(resolve, 300));
		}
	}

	/** Bounded by the wire's own budget for this method, for the case where a
	 * caller asks for the whole slice. */
	get awaitSliceMs(): number {
		return AWAIT_SLICE_MS;
	}

	// ---- operations the app's own chrome uses (design 11.2, 6.1) -------------

	/**
	 * The projection the renderer renders: the tab strip, the URL bar and the
	 * per-tab ownership markers. It never carries a nonce — the renderer is not an
	 * agent and has no reason to hold a capability (design 11.7).
	 */
	chromeState(): Record<string, unknown> {
		// `active` is dropped when its webContents is already dead: `snapshot()`
		// guards each read the same way, and a read that landed between destruction
		// and the `destroyed` handler would otherwise throw "Object has been
		// destroyed" out of an IPC handler and blank the strip instead of dropping
		// the dead tab (N2). The strip still renders — from `tabs` — which is the
		// honest projection: the tab is gone.
		const activeRecord = this.registry.activeTab;
		const active =
			activeRecord && !activeRecord.view.webContents.isDestroyed()
				? activeRecord
				: null;
		const navigation = active?.view.webContents.navigationHistory;
		return {
			tabs: this.registry.snapshot().map((entry) => ({
				tabId: entry.tabId,
				title: entry.title || "New tab",
				url: entry.url,
				owner: entry.owner,
				active: entry.active,
				restored: entry.restored,
				handedOver: entry.handedTo !== null,
			})),
			activeTabId: activeRecord?.tabId ?? null,
			url: active ? active.view.webContents.getURL() : "",
			title: active ? active.view.webContents.getTitle() : "",
			loading: active ? active.view.webContents.isLoading() : false,
			canGoBack: navigation ? navigation.canGoBack() : false,
			canGoForward: navigation ? navigation.canGoForward() : false,
			// The consent surface (PR 7) renders from this. Exposed now so the
			// transport does not need a second wire change when it lands, and so an
			// evidence run can answer a prompt headlessly.
			pendingConsent: this.approvals.pendingEntries().map((entry) => ({
				entryId: entry.entryId,
				origin: entry.origin,
				authority: entry.displayAuthority,
				broad: entry.broad ?? null,
				expiresAt: entry.expiresAt,
			})),
		};
	}

	/** A user tab: created active, at about:blank, owned by the user and with no
	 * capability until the user hands it over (design 6.1, 6.3). */
	async newTab(): Promise<Record<string, unknown>> {
		const record = this.registry.create({ owner: "user" });
		await record.view.webContents.loadURL("about:blank");
		await this.cdp.attach(record.view.webContents);
		this.onChanged();
		return this.chromeState();
	}

	closeTab(tabId: number): Record<string, unknown> {
		this.dropReceipt(tabId);
		this.registry.destroy(tabId);
		this.onChanged();
		return this.chromeState();
	}

	activateTab(tabId: number): Record<string, unknown> {
		this.registry.activate(tabId);
		this.onChanged();
		return this.chromeState();
	}

	/**
	 * A URL the USER typed goes through here, and it is deliberately different from
	 * an agent navigation in one way and identical in another (design 6.1):
	 *
	 * - no origin gate, and no consent prompt: the user typing their own URL IS the
	 *   consent. An origin can therefore be reachable by the user and refused to the
	 *   agent, which is the intended direction of the gate and something the consent
	 *   copy must say in words rather than leave the user to infer.
	 * - the same scheme rule: non-`http(s)` input is refused, because allowing
	 *   `file:` or `javascript:` here would hand a page (or a paste) a way to reach
	 *   the local filesystem through the app's own URL bar.
	 */
	async navigateActive(rawUrl: string): Promise<Record<string, unknown>> {
		const record = this.registry.activeTab;
		if (!record)
			throw new BrowserHostError("tab_closed", "no browser tab is open");
		let url: URL;
		try {
			url = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`);
		} catch {
			throw new BrowserHostError("nav_failed", "that is not a URL");
		}
		if (!permittedScheme(url)) {
			throw new BrowserHostError(
				"nav_failed",
				"only http:// and https:// can be opened",
			);
		}
		await record.view.webContents.loadURL(url.href);
		this.onChanged();
		return this.chromeState();
	}

	reloadActive(): Record<string, unknown> {
		this.registry.activeTab?.view.webContents.reload();
		return this.chromeState();
	}

	stopActive(): Record<string, unknown> {
		this.registry.activeTab?.view.webContents.stop();
		return this.chromeState();
	}

	historyActive(direction: "back" | "forward"): Record<string, unknown> {
		const navigation =
			this.registry.activeTab?.view.webContents.navigationHistory;
		if (navigation) {
			if (direction === "back") navigation.goBack();
			else navigation.goForward();
		}
		return this.chromeState();
	}

	/** Layout authority is the renderer's (design 11.2): it measures the content
	 * area and reports it, and main applies it to the active tab only. */
	setContentRect(rect: ContentRect | null): Record<string, unknown> {
		this.registry.setContentRect(rect);
		return this.chromeState();
	}

	/** Full-window overlays hide the view: a native view paints above all DOM, so
	 * an overlay is invisible unless the view goes away (design 11.3). */
	setViewVisible(visible: boolean): Record<string, unknown> {
		this.registry.setViewVisible(visible);
		return this.chromeState();
	}

	/** Hand a user tab to a session, minting the capability. The RENDERER never
	 * sees the nonce: it travels to the session through `tabs`, which is what keeps
	 * this the one authority transfer rather than an exposure (design 6.3, 11.7). */
	handOver(tabId: number, sessionId: string): Record<string, unknown> {
		// The hand-over re-mints the nonce, so the token the receipt is keyed on
		// stops existing here; dropping it now keeps the map bounded by LIVE tabs
		// rather than by every token a tab has ever had.
		this.dropReceipt(tabId);
		this.registry.handOver(tabId, sessionId);
		this.onChanged();
		return this.chromeState();
	}

	revokeHandOver(tabId: number): Record<string, unknown> {
		this.dropReceipt(tabId);
		this.registry.revokeHandOver(tabId);
		this.onChanged();
		return this.chromeState();
	}

	/**
	 * Forget whatever document receipt this tab's handle was granted.
	 *
	 * A receipt is bounded by the life of its TOKEN, so every path that ends a
	 * token has to drop it or the store grows for the life of the app. Three paths
	 * end one: an ownership `close`, the chrome's close button, and a webContents
	 * that dies on its own; the two nonce re-mints (hand-over and its revocation)
	 * orphan one the same way. A stale receipt is inert — a new token can never
	 * match it — which is why this is hygiene rather than a leak of authority
	 * (review round 1, N1), and it runs BEFORE the token changes so the entry it
	 * drops is the one that was live.
	 */
	dropReceipt(tabId: number): void {
		const record = this.registry.get(tabId);
		const token = record ? surfaceToken(record) : null;
		if (token) this.approvals.forgetDocument(token);
	}

	/** Answer a pending consent prompt. Reached only from the renderer IPC, whose
	 * handler checks the sender first. */
	respondToConsent(
		entryId: string,
		decision: "once" | "site" | "domain" | "deny",
	): Record<string, unknown> {
		const result = this.approvals.respond(entryId, decision);
		this.onChanged();
		return { ...result, ...this.chromeState() };
	}

	/** The registry's handles, for a diagnostic or the `tabs` listing. */
	handleFor(record: TabRecord): string {
		const token = surfaceToken(record);
		return token ? redactToken(token) : `ui:${record.tabId}:no-handle`;
	}
}

/** The extension's `AWAIT_SLICE_MS`, mirrored so the two hosts bound a poll the
 * same way. */
export const AWAIT_SLICE_MS = 20_000;

/** How long a single command may run before the wire's own budget is exceeded,
 * used by `index.ts` to log a slow command rather than by the dispatcher to kill
 * one: the session's client timeout is the authority on that, and a host-side
 * kill would race it. */
export function budgetFor(method: string): number | undefined {
	return COMMAND_TIMEOUTS_S[method as Method];
}

export { PROTO_VERSION };
