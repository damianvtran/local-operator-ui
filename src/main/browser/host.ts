import type { BrowserActionContext, HostFacts } from "./actions/context";
import { requesterOf } from "./actions/context";
import { withOriginGate } from "./actions/gate";
import * as inputActions from "./actions/input";
import * as pageActions from "./actions/page";
import * as tabActions from "./actions/tabs";
import type { ConsentDecision } from "./approvals";
import { BrowserHostError } from "./errors";
import { COMMAND_TIMEOUTS_S, type Method, PROTO_VERSION } from "./protocol";
import type { ContentRect, TabRecord } from "./registry";
import { redactToken, surfaceToken } from "./registry";
import type { PersistedTab } from "./session-store";
import { permittedScheme } from "./settle";
import { safeHttpUrl } from "./vendor/driver/origin-policy";

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

/**
 * How many restored tabs load at once.
 *
 * Four because a restore is a burst of REAL page loads competing with whatever the
 * user is already doing in the app, and because the tabs are already allocated:
 * this number bounds concurrency, not the size of the restore (review R5 asked for
 * bounded concurrency, not for a queue nobody waits on).
 */
const RESTORE_CONCURRENCY = 4;

/**
 * How long ONE restored tab may hold up the hydration pass.
 *
 * A restored URL is a fresh navigation (design 7.3), so `history.restore()` on a
 * page that never answers is a wait with no bound of its own. Ten seconds is past
 * any slow-but-working origin and short enough that the pass always finishes.
 */
const RESTORE_TAB_TIMEOUT_MS = 10_000;

/**
 * How long the WHOLE hydration pass may hold the host's attention.
 *
 * Per-tab timeouts compose badly: twenty tabs at four at a time and ten seconds
 * each is fifty seconds of a startup nobody asked for. This is the outer bound, and
 * when it expires the pass stops WAITING rather than stops working — the remaining
 * tabs keep loading and the host is already serving (review R5: one hung page must
 * not withhold the browser host).
 */
const RESTORE_BUDGET_MS = 8_000;

/**
 * Resolve with `work`, or reject once `ms` has passed.
 *
 * The loser is not cancelled — there is nothing to cancel on a `webContents`
 * navigation that is already under way — so this bounds what the CALLER waits for,
 * which is the property the restore needs. `timer.unref()` so a pass that has
 * already finished cannot keep the process alive on its own.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timed out after ${ms}ms`)),
			ms,
		);
		timer.unref?.();
		work.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

/**
 * Why the active tab's last top-level navigation failed, as the chrome reports it.
 *
 * The REMOTE DOCUMENT CANNOT PAINT THIS. A failed load leaves Chromium's own blank
 * surface in the view — Electron ships no error page for a main-frame refusal — so a
 * user looking at the browser sees an empty white rectangle with a working address
 * bar and no way to tell failure from a successfully loaded blank page (design
 * round 1, D1). The reason is therefore carried in the projection instead, and the
 * chrome renders it as app-owned copy with a retry.
 *
 * `code` is Chromium's net error and rides along verbatim so the panel can say
 * `ERR_EMPTY_RESPONSE` in machine voice beside the sentence in the user's.
 */
export interface LoadFailure {
	code: number;
	description: string;
	/** The URL the failed navigation was for — the attempted address, which is what
	 * the user needs in hand to check it or try it again. */
	url: string;
}

/**
 * Whether Chromium's `did-fail-load` code describes a failure the USER should be
 * told about.
 *
 * `ERR_ABORTED` (-3) is the one that matters, and it is the common case rather than
 * an edge one: a reload, a stop, a click that supersedes a load in flight and every
 * hop of a redirect chain report it. Those are navigation working, so a panel that
 * appeared for each would be wrong far more often than right. `ERR_ABORTED` is
 * still what a user-initiated stop produces, which is a deliberate action with its
 * own visible outcome (the page is where they left it), not a refusal to explain.
 *
 * A zero code is the "provisional load failed" marker Electron also emits; it names
 * no failure either.
 */
export function isReportableLoadFailure(code: number): boolean {
	return code !== 0 && code !== -3;
}

/**
 * The bare lop session id behind a consent requester, or null.
 *
 * Null for anything that is not a `session:<id>` identity, so an internal request
 * id can never be published as if it named a conversation. See the call site in
 * `chromeState` for why the renderer is given an id at all.
 */
function sessionRequesterOf(requester: string): string | null {
	if (!requester.startsWith("session:")) return null;
	const id = requester.slice("session:".length);
	return id || null;
}

export interface BrowserHostOptions {
	registry: BrowserActionContext["registry"];
	cdp: BrowserActionContext["cdp"];
	approvals: BrowserActionContext["approvals"];
	ownership: BrowserActionContext["ownership"];
	log: (message: string) => void;
	onChanged: () => void;
	facts: () => HostFacts;
	/** Clear one origin's browsing data, for "forget this site" (design 9.4).
	 * Injected from the wiring that owns the session, so this module does not
	 * depend on the session object. */
	forgetSiteData: (origin: string) => Promise<void>;
}

export class BrowserHost implements BrowserActionContext {
	readonly registry: BrowserActionContext["registry"];
	readonly cdp: BrowserActionContext["cdp"];
	readonly approvals: BrowserActionContext["approvals"];
	readonly ownership: BrowserActionContext["ownership"];
	readonly log: (message: string) => void;
	readonly onChanged: () => void;
	readonly facts: () => HostFacts;
	/** The session's per-origin storage clear, injected (see `BrowserHostOptions`). */
	private readonly forgetSiteData: (origin: string) => Promise<void>;

	/**
	 * The last main-frame load failure per tab, cleared by the next load.
	 *
	 * Keyed by `tabId` and DROPPED with the tab: this is a statement about a document
	 * that a tab is (or is not) showing, so a recycled id or a closed tab must not be
	 * able to inherit it.
	 */
	private readonly loadFailures = new Map<number, LoadFailure>();

	/**
	 * The background hydration pass, so a caller can wait for it without the host
	 * ever making anyone wait for it. See `restoreTabs`.
	 */
	private hydration: Promise<void> = Promise.resolve();

	constructor(options: BrowserHostOptions) {
		this.registry = options.registry;
		this.cdp = options.cdp;
		this.approvals = options.approvals;
		this.ownership = options.ownership;
		this.log = options.log;
		this.onChanged = options.onChanged;
		this.facts = options.facts;
		this.forgetSiteData = options.forgetSiteData;
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
	 * Record a main-frame load failure for a tab.
	 *
	 * Called from the view's own `did-fail-load`, which is the only place that knows a
	 * navigation was refused by the network rather than by the gate. NOT recorded for
	 * `ERR_ABORTED`, which is what a stop, a redirect chain and a superseded
	 * navigation all report: those are the user's own browsing succeeding at
	 * something, and presenting one as a failure would make the panel cry wolf on
	 * every redirect (see `isReportableLoadFailure`).
	 */
	recordLoadFailure(tabId: number, failure: LoadFailure): void {
		if (!this.registry.get(tabId)) return;
		this.loadFailures.set(tabId, failure);
		this.onChanged();
	}

	/** The next navigation on this tab is under way, so the last failure is stale. */
	clearLoadFailure(tabId: number): void {
		if (!this.loadFailures.delete(tabId)) return;
		this.onChanged();
	}

	/** The failure the chrome shows for the ACTIVE tab, or null. */
	private activeLoadFailure(activeTabId: number | null): LoadFailure | null {
		if (activeTabId === null) return null;
		return this.loadFailures.get(activeTabId) ?? null;
	}

	/**
	 * A tab title the chrome should show, or "" when the document has none.
	 *
	 * Chromium answers `about:blank` as the TITLE of a document that did not name
	 * itself — a new tab, and a restored tab whose page has not committed yet — and
	 * that is a URL the user never visited rather than a page name. The URL bar
	 * already refuses to render it (`displayUrl` in the chrome maps it to an empty
	 * field, for the same reason). Every other window onto a tab's name reads THIS
	 * projection — the strip's label, its `Tab actions for …` and `Close …` labels,
	 * the hand-over dialog's summary and the paused note — so the rule belongs here,
	 * once, rather than five times in the renderer: an untitled tab arrives empty
	 * and each surface falls back to its own words (the strip's "New tab").
	 * (Review round 2, U3: the strip used to read `about:blank` in five places while
	 * the bar showed nothing.)
	 */
	titleForChrome(title: string): string {
		return title === "about:blank" ? "" : title;
	}

	/** Whether a tab is loading right now, false for a tab that is gone or whose
	 * webContents has already been destroyed. Guarded the same way `snapshot()`
	 * guards its reads: a read that lands between destruction and the
	 * `destroyed` handler would otherwise throw "Object has been destroyed" out of
	 * an IPC handler and blank the whole strip instead of dropping one tab. */
	tabLoading(tabId: number): boolean {
		const record = this.registry.get(tabId);
		if (!record || record.view.webContents.isDestroyed()) return false;
		return record.view.webContents.isLoading();
	}

	/**
	 * The projection the renderer renders: the tab strip, the URL bar and the
	 * per-tab ownership markers. It never carries a nonce — the renderer is not an
	 * agent and has no reason to hold a capability (design 11.7).
	 *
	 * `sessionId` IS projected, and the nonce is not, and the difference is the
	 * whole of the rule rather than an inconsistency to iron out. A conversation's
	 * pane has to answer "which of these tabs belong to THIS conversation"
	 * (docs/design/browser-approval-ux.md 7.2), and the registry already answers it
	 * with one field: an agent tab carries the session that created it
	 * (`registry.ts:231`) and a handed-over user tab carries the session it was
	 * handed to (`:371`), so one field answers both questions. That field is a
	 * NAME — the same id the app already puts in its own chat routes, and the same
	 * value `handOver` matches against — while the NONCE is the capability that
	 * lets its holder DRIVE the tab. Projecting the name tells the user which
	 * conversation a tab belongs to; projecting the nonce would hand the renderer
	 * (and anything that can read the renderer's IPC) the ability to act as an
	 * agent, which is exactly what `mayDrive` is the gate for. So the name
	 * travels and the capability does not — `registry.snapshot()` carries it for the
	 * same reason, and THIS projection is the one the UI reads.
	 *
	 * It sits on this member rather than where it was written: it was left as a
	 * detached block after this class's section rule, with `recordLoadFailure`'s own
	 * doc directly beneath it, so the most load-bearing prose in the main-process
	 * change documented nothing (review round 1, NIT B).
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
				title: this.titleForChrome(entry.title) || "New tab",
				url: entry.url,
				owner: entry.owner,
				// WHICH CONVERSATION THIS TAB BELONGS TO, and the ONLY new field this
				// change adds to the wire. `null` is a real and common value — a restored
				// tab is nobody's (`registry.ts:231`), a user tab that was never handed
				// over is nobody's, and a tab handed back goes back to `null` (`:386`) —
				// and it means "not any conversation's", which is why a conversation's
				// scope shows it under no scope but `"all"` (spec 7.2).
				sessionId: entry.sessionId,
				active: entry.active,
				restored: entry.restored,
				handedOver: entry.handedTo !== null,
				// Per TAB, not only for the active one: a background tab whose load was
				// refused has no other way to say so - its page area is blank and the
				// band belongs to the active tab - so the strip carries the mark.
				failed: this.loadFailures.has(entry.tabId),
				// PER TAB, and it is the one projection field this feature adds. The strip
				// could only ever see the ACTIVE tab's loading state before (`loading`
				// below), so a background agent tab that is loading a page showed nothing
				// at all - and since an agent tab is created non-active and only the active
				// tab occupies the content rect (`registry.ts:492-503`), "nothing at all"
				// was the whole of what the user saw of an agent's work. Read from the
				// record rather than the snapshot: `snapshot()` is the diagnostic
				// projection shared with `status`/`tabs`, and this field is chrome.
				loading: this.tabLoading(entry.tabId),
			})),
			activeTabId: activeRecord?.tabId ?? null,
			url: active ? active.view.webContents.getURL() : "",
			title: active
				? this.titleForChrome(active.view.webContents.getTitle())
				: "",
			loading: active ? active.view.webContents.isLoading() : false,
			canGoBack: navigation ? navigation.canGoBack() : false,
			canGoForward: navigation ? navigation.canGoForward() : false,
			// WHY the page area is empty, when it is. Null on a healthy tab, so the
			// chrome's failure panel is driven by a fact rather than by "the page looks
			// blank", which is also what a slow load and an empty document look like.
			navFailure: this.activeLoadFailure(activeRecord?.tabId ?? null),
			// The consent surface (PR 7) renders from this. Exposed now so the
			// transport does not need a second wire change when it lands, and so an
			// evidence run can answer a prompt headlessly.
			pendingConsent: this.approvals.pendingEntries().map((entry) => ({
				entryId: entry.entryId,
				origin: entry.origin,
				authority: entry.displayAuthority,
				broad: entry.broad ?? null,
				expiresAt: entry.expiresAt,
				// WHO IS ASKING, as an id the renderer may resolve and nothing more.
				//
				// The vendored queue says `requester` is an "authority boundary only. Never
				// render or include in ambient notifications", and the consent bar has to
				// tell the user which conversation they are authorising — in a
				// multi-conversation app, "An agent" beside five choices is not a decision
				// anyone can make (design round 1, D2). So what travels is the BARE lop
				// session id, which is not a credential: it is the id the app already puts
				// in its own chat routes, and it is exactly the value `handOver` matches
				// against. The renderer resolves it to a conversation title from the same
				// session list the hand-over dialog uses.
				//
				// STRICTLY `session:`-PREFIXED, which is why this does not reuse
				// `sessionIdOf`: that helper returns any non-session identity unchanged, and
				// a requester that is a bare request id (`actions/context.ts` falls back to
				// one) would then be published to the UI.
				requesterSessionId: sessionRequesterOf(entry.requester),
			})),
			// Which sites an agent may act on as the user RIGHT NOW (design 9.3's
			// honesty requirement). Shipped in the same projection as the strip rather
			// than behind a second channel: the answer is only useful next to the tabs
			// it applies to, and one subscription is one thing that can go stale.
			//
			// The `requester` on a record is deliberately NOT projected. The vendored
			// queue marks it "authority boundary only. Never render or include in
			// ambient notifications", so the list says which SITE and which SCOPE —
			// which is what the user's question is about — and never names a session.
			approvals: this.approvals.grants().map((record) => ({
				origin: record.origin,
				scope: record.scope,
				grantedAt: record.grantedAt,
			})),
		};
	}

	/**
	 * A user tab: created active, at about:blank, owned by the user and with no
	 * capability until the user hands it over (design 6.1, 6.3).
	 *
	 * ATTRIBUTED TO THE CONVERSATION IT WAS OPENED FROM when it has one (design R1).
	 * That is the whole of the main-process half and it takes no new mechanism:
	 * `registry.create` already stores a non-restored tab's `sessionId`
	 * (`registry.ts:231`) and already leaves every user tab's `nonce` null (`:232`).
	 *
	 * WHY THIS CHANGES NO CAPABILITY, and the test that pins it
	 * (`scripts/browser-host.test.mjs`): `mayDrive` requires the session id AND a
	 * nonce (`registry.ts:395-397`), and this tab has the first and not the second, so
	 * an agent in that conversation still cannot drive a tab the user opened. The
	 * `tabs` listing redacts its handle, `agentTabCount()` filters on `owner` and is
	 * unmoved, the agent cap is unmoved, and hand-over stays the only authority
	 * transfer.
	 *
	 * Before this, all three ways a user could open a tab produced one the pane's
	 * "This conversation" scope would never show, because the scope filter reads this
	 * one field.
	 */
	async newTab(sessionId?: string | null): Promise<Record<string, unknown>> {
		const record = this.registry.create({
			owner: "user",
			sessionId: sessionId ?? null,
		});
		await record.view.webContents.loadURL("about:blank");
		await this.cdp.attach(record.view.webContents);
		this.onChanged();
		return this.chromeState();
	}

	closeTab(tabId: number): Record<string, unknown> {
		this.dropReceipt(tabId);
		this.loadFailures.delete(tabId);
		this.registry.destroy(tabId);
		this.onChanged();
		return this.chromeState();
	}

	/**
	 * Re-create the tabs a previous run recorded (design 7).
	 *
	 * THE THREE RULES THIS ENFORCES, each of which has a section behind it:
	 *
	 * 1. **A restored tab is the user's, with a FRESH tabId and NO nonce** (7.3).
	 *    That is `registry.create({owner: "user", restored: true})`, and it is why
	 *    a session holding `ui:<oldTabId>:<oldNonce>` gets the ordinary `tab_closed`
	 *    on its next action instead of silently reclaiming a tab whose authority
	 *    came off a file in `userData`. No special-case code exists for that
	 *    recovery, which is the point: the handle rule already produces it.
	 * 2. **`navigationHistory.restore()` runs before anything navigates** (7.1):
	 *    Electron documents it as "recommended to call this API before any
	 *    navigation entries are created, so ideally before you call `loadURL()`".
	 *    That ordering is load-bearing here because `cdp.attach` gives a document
	 *    to any view that has never navigated — so attach runs AFTER the restore
	 *    has put a document in, or the `<about:blank>` it would load would replace
	 *    the restored stack with one blank entry.
	 * 3. **Restoring does not steal the active tab** (11.4): the recorded active
	 *    tab is activated once, at the end, so a background tab's restore cannot
	 *    take the user's place.
	 *
	 * A restore that fails is logged and left as it is: the tab keeps whatever
	 * Chromium managed to load, which is a blank tab rather than a broken one, and
	 * blocking startup on a page that will not load is exactly what 7.2 forbids.
	 *
	 * TWO PHASES, because they have different clocks (review round 1, R5).
	 *
	 * 1. **Allocate, synchronously.** Every view, every tab id and the active tab are
	 *    settled before this method returns, off a list `readSession` has already
	 *    validated and bounded (`MAX_RESTORED_TABS`). So the strip is correct on the
	 *    first paint and the host can serve — an agent's `open`, the chrome's `state`
	 *    read — while the pages are still loading.
	 * 2. **Hydrate, in the background.** `history.restore()` and `cdp.attach()` per
	 *    tab, four at a time, each with its own timeout, all under one overall budget.
	 *    A page that never answers delays nothing outside its own tab, and the pass
	 *    never withholds a host that is already usable.
	 *
	 * WHY NOT `Promise.all` AND `await`, which is what this was: it created one view
	 * per entry with no concurrency bound and awaited every one of them before RPC
	 * started, so a file with 256 valid rows produced 256 views and one hung page
	 * withheld the browser host entirely. The `catch` around it bounded nothing at
	 * all about the pending case.
	 *
	 * Allocating synchronously is also what keeps rule 3 true: the active tab is
	 * set from the recorded flag before any page has loaded, rather than when the
	 * last tab happens to finish — which was a tab activation arriving after the
	 * user had already started working, taking their place for no reason they
	 * could see.
	 */
	restoreTabs(tabs: PersistedTab[]): Record<string, unknown> {
		if (!tabs.length) {
			// A first run: one blank tab, as before. It is still a real navigation, so it
			// rides the same background pass rather than blocking the host on `about:blank`.
			this.hydration = this.newTab().then(() => undefined);
			return this.chromeState();
		}
		// Phase 1: allocate. `restored: true` is what makes the owner `user` and the
		// nonce null, in the registry, for every restored tab regardless of what the
		// file said. The recorded row travels WITH the record (`restoreRow`) because
		// the change capture below runs before any page has committed: without it that
		// capture is empty by construction and overwrites the very file this restore
		// is reading (review round 2, B2 — see `captureTabs`).
		const created = tabs.map((recorded) => ({
			tabId: this.registry.create({
				owner: "user",
				restored: true,
				restoreRow: recorded,
			}).tabId,
			recorded,
		}));
		const wanted =
			created.find((entry) => entry.recorded.active)?.tabId ??
			created.at(-1)?.tabId;
		if (wanted !== undefined) this.registry.activate(wanted);
		this.onChanged();
		// Phase 2: hydrate, unawaited. The registry's records stay in `created` order,
		// which is the file's order, so the strip does not shuffle as pages land.
		this.hydration = this.hydrateRestored(created);
		return this.chromeState();
	}

	/** Wait for the background hydration pass. For tests and the proof run, which
	 * want the tabs to have finished loading; nothing on a user's path calls it. */
	whenRestored(): Promise<void> {
		return this.hydration;
	}

	/**
	 * Apply each restored tab's history and debugger session, bounded.
	 *
	 * `Promise.allSettled` rather than `Promise.all`: the two steps below already turn
	 * a failure into a log line, and a rejection here would be an unhandled rejection
	 * on a promise only a test awaits.
	 */
	private async hydrateRestored(
		created: Array<{ tabId: number; recorded: PersistedTab }>,
	): Promise<void> {
		const deadline = Date.now() + RESTORE_BUDGET_MS;
		const queue = [...created];
		let reported = false;
		const worker = async (): Promise<void> => {
			for (;;) {
				const next = queue.shift();
				if (!next) return;
				if (Date.now() >= deadline) {
					// Said once per pass, not once per worker: four copies of one line says
					// nothing the first does not, and this log is read by a support session.
					if (!reported) {
						reported = true;
						this.log(
							`[browser] the ${RESTORE_BUDGET_MS}ms restore budget expired with ${queue.length + 1} tab(s) still loading; they keep loading in the background`,
						);
					}
					return;
				}
				await this.hydrateOne(next.tabId, next.recorded);
			}
		};
		await Promise.allSettled(
			Array.from(
				{ length: Math.min(RESTORE_CONCURRENCY, created.length) },
				worker,
			),
		);
	}

	/** One tab's half of the pass: the history stack, then the debugger session. */
	private async hydrateOne(
		tabId: number,
		recorded: PersistedTab,
	): Promise<void> {
		const record = this.registry.get(tabId);
		// The user can close a restored tab while its page is still loading, and the
		// `destroyed` path may already have taken it: a hydration step that ran anyway
		// would drive a released `webContents`.
		if (!record) return;
		const contents = record.view.webContents;
		const history = contents.navigationHistory;
		const entry = recorded.entries[recorded.activeIndex];
		try {
			await withTimeout(
				history?.restore
					? history.restore({
							entries: recorded.entries,
							index: recorded.activeIndex,
						})
					: // The honest degradation (see `NavigationHistoryLike`): a view with no
						// history API still gets put back on the page it was showing, without
						// its stack and its page state.
						entry
						? contents.loadURL(entry.url)
						: Promise.resolve(),
				RESTORE_TAB_TIMEOUT_MS,
			);
		} catch (error) {
			this.log(`[browser] could not restore tab ${tabId}: ${String(error)}`);
		}
		if (!this.registry.get(tabId)) return;
		try {
			await withTimeout(this.cdp.attach(contents), RESTORE_TAB_TIMEOUT_MS);
		} catch (error) {
			this.log(
				`[browser] could not attach to restored tab ${tabId}: ${String(error)}`,
			);
		}
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
		decision: ConsentDecision,
	): Record<string, unknown> {
		const result = this.approvals.respond(entryId, decision);
		this.onChanged();
		return { ...result, ...this.chromeState() };
	}

	/** Revoke one origin's approvals (design 9.4). Separate from closing a tab and
	 * separate from clearing cookies: "stop this agent" and "forget this site" are
	 * different intentions. */
	revokeApproval(origin: string): Record<string, unknown> {
		const removed = this.approvals.revokeOrigin(origin);
		this.onChanged();
		return { removed, origin, ...this.chromeState() };
	}

	/** Revoke every site approval. Does not log the user out (design 9.4). */
	revokeAllApprovals(): Record<string, unknown> {
		const removed = this.approvals.revokeAll();
		this.onChanged();
		return { removed, ...this.chromeState() };
	}

	/**
	 * "Forget this site" (design 9.4): withdraw the approval AND clear what this
	 * app stored for that origin.
	 *
	 * Two effects in one affordance because they are one intention — the user
	 * wanting the site gone from this app — while being explicit that they are two
	 * mechanisms with two consequences: the revoke does not log them out, and the
	 * storage clear does not restore a deny state. The confirmation in the chrome
	 * says both rather than leaving the user to discover the second half.
	 */
	async forgetSite(rawOrigin: string): Promise<Record<string, unknown>> {
		const origin = safeHttpUrl(rawOrigin).origin;
		const removed = this.approvals.revokeOrigin(origin);
		await this.forgetSiteData(origin);
		this.log(`[browser] forgot ${origin}: ${removed} approval(s) revoked`);
		this.onChanged();
		return { origin, removed, ...this.chromeState() };
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
