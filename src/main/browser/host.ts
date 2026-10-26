import { t } from "../../i18n";
import type {
	AddressHistoryRequest,
	AddressHistoryResponse,
} from "../../shared/browser-address-history";
import type {
	HumanTabAction,
	HumanTabActionOutcome,
} from "../../shared/browser-tab-action";
import type { BrowserActionContext, HostFacts } from "./actions/context";
import { requesterOf } from "./actions/context";
import * as downloadActions from "./actions/download";
import { withOriginGate } from "./actions/gate";
import * as geometryActions from "./actions/geometry";
import * as inputActions from "./actions/input";
import * as networkActions from "./actions/network";
import * as pageActions from "./actions/page";
import * as queryActions from "./actions/query";
import * as tabActions from "./actions/tabs";
import * as uploadActions from "./actions/upload";
import { collectAddressHistory, mergeAddressHistory } from "./address-history";
import type { ConsentDecision } from "./approvals";
import { ChromeTabOrder } from "./chrome-tab-order";
import { BrowserHostError } from "./errors";
import {
	type BrowserHistoryStore,
	createBrowserHistoryStore,
} from "./history-store";
import { PageControls, type PageZoomCommand } from "./page-controls";
import { COMMAND_TIMEOUTS_S, type Method, PROTO_VERSION } from "./protocol";
import type { ContentRect, TabRecord } from "./registry";
import { redactToken, surfaceToken } from "./registry";
import type { PersistedTab } from "./session-store";
import { permittedScheme } from "./settle";
import { TabAudioTracker } from "./tab-audio";
import { safeHttpUrl } from "./vendor/driver/origin-policy";

const DUPLICATABLE_WEB_URL = /^https?:\/\//i;

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
	// The structured reads (`styles`, `hit_test`, `ancestors`) describe the
	// CURRENT document exactly as `read` does, so a result that raced a
	// navigation it did not cause must be discarded the same way.
	"styles",
	"hit_test",
	"ancestors",
	"snapshot",
	// `query` is a read of the CURRENT document's DOM (CSS in, descriptors out),
	// so it is authorized against that document on entry and again on the result
	// exactly as `read` is: an answer that raced a navigation it did not cause
	// must be discarded, not reported as the new page's (agent review round 2 on
	// the query slice — the action was missing from BOTH sets).
	"query",
	"screenshot",
	"click",
	"type",
	"scroll",
	"logs",
	// `download` names a control on the CURRENT document (the link or button that
	// starts the file) and `upload` names a file input on it, so both are authorized
	// against that document on entry and again on the result. BOTH are in the
	// NAVIGATING_ACTIONS set below — each reaches its own control by driving the page,
	// and an auto-submitting form turns an attach into a navigation — and NEITHER is
	// in NAVIGATION_ACTIONS (the per-hop gate stays off for both); the set comments
	// say why, and the pair is what replaced the single post-hoc check the round-1
	// review refused (M2).
	"download",
	"upload",
]);

/**
 * The actions whose own work may legitimately change the document the tab is
 * showing, and so the only ones whose epoch change is ADOPTED instead of read as a
 * race with a navigation they did not cause.
 *
 * `click` follows a link or submits a form and `type` can submit one; `download`
 * reaches its click by calling the action directly (`actions/download.ts`), so it
 * can land the tab somewhere new exactly as `click` can. Leaving it out was a real
 * defect (review round 1, M2): its epoch change fell into the non-navigating
 * branch, which refuses the answer with `reason: "changed"` — so the call was
 * refused with NO ORIGIN NAMED and the tab was left sitting on the document it
 * reached, fetched with the user's cookies.
 *
 * `upload` IS THE SAME CASE ON THE SIBLING VERB, and it is the round-2 review's
 * R2-1: attaching files fires the input's `change` handler, and a form that
 * submits itself from that handler — the standard "pick a file and it uploads"
 * shape, and the shape PR A's QA measured failing with Chromium's raw `-32000` —
 * navigates in the same tick. It was left in `DOCUMENT_SCOPED` alone, so an
 * upload that navigated got `reason: "changed"`, no origin named, and no restore,
 * which is exactly the control round 1 refused for `download` ("a control that
 * protects the model's report and not the user's browser"). Membership here is
 * what makes the reached document judged by `documentAllowed` instead: an
 * APPROVED landing passes and an UNAPPROVED one refuses WITH the origin named and
 * the landing reverted.
 *
 * NEITHER IS IN `NAVIGATION_ACTIONS` BELOW, and the reason is the same for both:
 * the per-hop gate decides DOCUMENT-stage requests, and it would refuse the
 * cross-origin URL a download is routinely fetched from (a signed S3 or CDN link)
 * and fail the page's own subresource loads under an upload for no consent gain.
 * See that set's own comment.
 */
const NAVIGATING_ACTIONS: ReadonlySet<string> = new Set([
	"click",
	"type",
	"download",
	"upload",
]);

/**
 * The actions that can start a navigation by themselves, and so the only ones that
 * need the per-hop Document gate armed around them.
 *
 * `open` and `goto` arm it from the navigation itself (`navigateView`), so what is
 * left is the pair that navigates because a PAGE decides to: a click follows a link
 * or submits a form, a type can submit one. Arming `Fetch.enable` around the rest
 * is not free and buys nothing: the rest cannot change which document is current,
 * so there is no agent-initiated hop for the gate to decide, while its
 * Document-stage interception also fails the PAGE's own subresource and
 * third-party-iframe loads with `BlockedByClient` — a side effect on the page the
 * user is watching that the page can observe. Their protection is the entry and
 * result authorization in `authorizedPerform` — where the result is authorized
 * against the document it actually came from — together with this per-hop gate,
 * which is what refuses a page-initiated escape before it is fetched (review round
 * 1, R5).
 *
 * WHY `download` IS DELIBERATELY THE ONE NAVIGATING ACTION OUTSIDE THIS SET, which
 * is a decision rather than an omission (review round 1, M2 weighed it and agreed
 * with the premise): the gate decides DOCUMENT-stage requests, and a download is
 * routinely a cross-origin URL the tab was never approved for — a signed S3 or CDN
 * link — so arming it around the whole capture (which waits up to 600 s) would
 * refuse exactly the downloads this feature exists to make possible, and would
 * hold `Fetch.enable` over the page for the length of a download. WHAT REPLACES IT
 * is the pair in `authorizedPerform`: the epoch is adopted so the document the
 * result came from is authorized and the reached origin is NAMED in the refusal,
 * and a refused landing is REVERTED to the document the call entered on rather
 * than left on screen.
 *
 * `upload` IS THE SECOND SUCH ACTION, on the same reasoning (review round 2,
 * R2-1): its own work does not fetch a document — it hands the browser process
 * local paths — and the navigation an auto-submitting form performs is the PAGE's,
 * which is judged by the same pair. Arming `Fetch.enable` around an attach would
 * intercept that form's own POST and its subresources for no consent gain, which
 * is the side effect this set exists to avoid.
 */
const NAVIGATION_ACTIONS: ReadonlySet<string> = new Set(["click", "type"]);

/** The methods that address one tab and therefore take that tab's command lane. */
const TAB_SCOPED: ReadonlySet<string> = new Set([
	"goto",
	"read",
	"styles",
	"hit_test",
	"ancestors",
	"snapshot",
	"query",
	"screenshot",
	"click",
	"type",
	"scroll",
	"logs",
	"close",
	"retitle",
	// The two file verbs take the tab's lane for the same reason every other
	// tab-addressed action does, and for one more: `download` ARMS the tab for the
	// duration of the call, and two concurrent arms on one tab would be two captures
	// writing into two harness directories with no way to tell which file came from
	// which call.
	"download",
	"upload",
	// Network capture is TAB-scoped and deliberately NOT `DOCUMENT_SCOPED`, for the
	// same reason `logs` is not: its answer describes the tab's TRAFFIC (which
	// spans documents, redirects and third-party subresources), not the document
	// currently loaded. Authorizing it against the current page would refuse a read
	// of traffic the session already watched once the tab navigated elsewhere, and
	// would add no confidentiality — the same metadata is what `logs` exposes.
	"network_start",
	"network_stop",
	"network_read",
	"network_clear",
]);

/**
 * How many restored tabs load at once.
 *
 * Four because a restore is a burst of REAL page loads competing with whatever the
 * user is already doing in the app, and because the tabs are already allocated:
 * this number bounds concurrency, not the size of the restore (review R5 asked for
 * bounded concurrency, not for a queue nobody waits on).
 *
 * Exported for the tests, deliberately: a suite that hard-coded the number would
 * stop testing the concurrency the day it moves (`browser-host.test.mjs` reads it
 * to derive how many tabs a budget expiry should leave queued).
 */
export const RESTORE_CONCURRENCY = 4;

/**
 * How long ONE restored tab may hold up the hydration pass.
 *
 * A restored URL is a fresh navigation (design 7.3), so `history.restore()` on a
 * page that never answers is a wait with no bound of its own. Ten seconds is past
 * any slow-but-working origin and short enough that the pass always finishes.
 * Exported for the tests (see `RESTORE_CONCURRENCY`).
 */
export const RESTORE_TAB_TIMEOUT_MS = 10_000;

/**
 * How long the WHOLE hydration pass may hold the host's attention.
 *
 * Per-tab timeouts compose badly: twenty tabs at four at a time and ten seconds
 * each is fifty seconds of a startup nobody asked for. This is the outer bound, and
 * when it expires the pass stops WAITING rather than stops working — the remaining
 * tabs keep loading and the host is already serving (review R5: one hung page must
 * not withhold the browser host). THE SENTENCE IS MADE TRUE BY THE DRAIN at the end
 * of `hydrateRestored` (2026-09-29): before it, the queued tabs got no load at all
 * and sat `about:blank` forever (RC2b).
 * Exported for the tests (see `RESTORE_CONCURRENCY`).
 */
export const RESTORE_BUDGET_MS = 8_000;

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
 *
 * RE-EVALUATED 2026-10-24 against the current recovery paths. `did-start-loading`
 * clears the mark when a retry (or any new load) starts and `did-navigate` clears
 * it on the commit (`browser/index.ts`), so a stop, a redirect chain and a
 * superseded load never leave a stale panel behind. Measured on Electron 44.3.0:
 * a superseded load rejects with `ERR_ABORTED (-3)` while a redirect chain
 * resolves on its final commit; the read-only `query` action (DOCUMENT_SCOPED and
 * TAB_SCOPED) never navigates, so it cannot produce either. The decision stands:
 * reporting aborts would make the panel cry wolf on ordinary browsing.
 */
export function isReportableLoadFailure(code: number): boolean {
	return code !== 0 && code !== -3;
}

/**
 * Whether a `history.restore()` rejection is the superseded-navigation abort.
 *
 * THE RESTORE PATH DOES NOT GET A NUMERIC NET CODE, unlike `did-fail-load`: the
 * rejection is an `Error` whose message is the only place Electron puts
 * `ERR_ABORTED (-3)`. Matching the message here is deliberate and narrow — the
 * same reason `isReportableLoadFailure` exists one layer down — because a
 * superseding navigation is ordinary browsing, not a restore failure. If that
 * superseding page is then stopped before its `did-navigate`, no commit ever
 * arrives to clear a mark written here, and `lastLoadFailed` would skip the tab
 * on the next launch. The timeout and a deliberate Stop reject with different
 * text (`ERR_FAILED (-2)` for a stop), so they still mark.
 */
function isSupersededRestore(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("ERR_ABORTED (-3)");
}

/**
 * The bare lop session id behind a consent requester, or null.
 *
 * Null for anything that is not a `session:<id>` identity, so an internal request
 * id can never be published as if it named a conversation. See the call site in
 * `chromeState` for why the renderer is given an id at all — and, since
 * `browser/index.ts` publishes the SAME resolution on `browser-consent-attention`
 * so a banner click can land on the conversation that asked, it is exported rather
 * than copied: two spellings of "which session is this requester" is how the
 * badge's conversation and the click's conversation come apart.
 */
export function sessionRequesterOf(requester: string): string | null {
	if (!requester.startsWith("session:")) return null;
	const id = requester.slice("session:".length);
	return id || null;
}

/**
 * A bulk close, as this host executes one (design R5).
 *
 * DECLARED ON BOTH SIDES OF THE PROCESS BOUNDARY, deliberately, following the repo's
 * existing pattern for a cross-process shape (`ContentRect` is declared in
 * `registry.ts` and again in `use-browser-chrome.ts`): main does not import renderer
 * modules, and the IPC boundary VALIDATES the intent it is given rather than trusting
 * a type from the other side — which is what makes the two declarations the same shape
 * without one of them being authority over the other.
 */
export type CloseTabsIntent =
	| { mode: "ids"; tabIds: number[] }
	| { mode: "conversation"; sessionId: string };

export interface BrowserHostOptions {
	registry: BrowserActionContext["registry"];
	cdp: BrowserActionContext["cdp"];
	approvals: BrowserActionContext["approvals"];
	ownership: BrowserActionContext["ownership"];
	/** The per-tab download arm (§8). Injected rather than built here because the
	 * `will-download` handler that feeds it is installed on the SESSION, which this
	 * module deliberately does not own. */
	downloads: BrowserActionContext["downloads"];
	log: (message: string) => void;
	onChanged: () => void;
	facts: () => HostFacts;
	/** Clear one origin's browsing data, for "forget this site" (design 9.4).
	 * Injected from the wiring that owns the session, so this module does not
	 * depend on the session object. */
	forgetSiteData: (origin: string) => Promise<void>;
	/** S4b: the popout's health, supplied by the wiring that owns the overlay
	 * controller. Absent means no controller was built, which is `suspend`. */
	addressOverlayMode?: () => {
		mode: "popout" | "suspend";
		reason: string | null;
	};
	/** Where the persistent suggestion history lives. Absent means no store
	 * (a test or a story): suggestions still come from live tabs, and nothing
	 * is recorded or written. The production wiring passes
	 * `<userData>/browser-history.json`. */
	historyFilePath?: string;
	/**
	 * S6b: the native approvals card, when the launch opt-in built one. Absent
	 * means the shield keeps using the DOM tray/dock, so an ordinary launch is
	 * unchanged.
	 */
	approvalsCard?: {
		open: (input: {
			locale?: string;
			dir?: "ltr" | "rtl";
			theme?: "light" | "dark";
			palette?: string | null;
			requesterLabels?: Readonly<Record<string, string>>;
		}) => void;
		close: () => void;
		setContext: (input: {
			locale?: string;
			dir?: "ltr" | "rtl";
			theme?: "light" | "dark";
			palette?: string | null;
			requesterLabels?: Readonly<Record<string, string>>;
		}) => void;
		state: () => { available: boolean; open: boolean };
	};
}

export class BrowserHost implements BrowserActionContext {
	private readonly chromeTabOrder = new ChromeTabOrder();
	readonly registry: BrowserActionContext["registry"];
	readonly pageControls: PageControls;
	/** Per-tab audio for the strip's mute control (LOH-13 slice C). Main owns
	 * it for the reason `tabLoading` is read here: a background tab's sound
	 * is legible only through this projection.
	 *
	 * ASSIGNED IN THE CONSTRUCTOR, NOT INITIALISED HERE. The shipping main
	 * bundle is compiled to V8 bytecode by electron-vite, and its `vite:bytecode`
	 * transform refuses an arrow function inside a class PROPERTY: "Unable to
	 * transform arrow inside class property". This initialiser was that arrow,
	 * and it failed the v0.35.0 platform builds identically on every OS, so no
	 * update assets shipped. A constructor assignment is inside the transform's
	 * supported shape, keeps the field `readonly`, and preserves the callback's
	 * laziness (the tracker only stores it). Do not move it back to a field
	 * initialiser. Keep arrows out of every non-static class-field initialiser,
	 * not only the direct form: a callback passed to a constructor
	 * (`new X(() => ...)`) or sitting inside an object/array literal value is
	 * refused by the same rule (2026-10-18). */
	readonly tabAudio: TabAudioTracker;
	readonly cdp: BrowserActionContext["cdp"];
	readonly approvals: BrowserActionContext["approvals"];
	readonly ownership: BrowserActionContext["ownership"];
	readonly downloads: BrowserActionContext["downloads"];
	readonly log: (message: string) => void;
	readonly onChanged: () => void;
	readonly facts: () => HostFacts;
	/** The session's per-origin storage clear, injected (see `BrowserHostOptions`). */
	private readonly forgetSiteData: (origin: string) => Promise<void>;
	/** S6b's native card, when the launch built one (see `BrowserHostOptions`). */
	private readonly approvalsCard: BrowserHostOptions["approvalsCard"];
	/** S4b's popout health, read from the controller (or the launch's platform
	 * answer when no controller exists). The strip reads this from the same
	 * projection as the tabs, so the renderer has one source for "child or
	 * fallback" and never guesses from a failed IPC call. */
	private readonly addressOverlayMode: () => {
		mode: "popout" | "suspend";
		reason: string | null;
	};
	/** One instance per host, constructed once in the constructor. `null` when
	 * no path was supplied (see `BrowserHostOptions.historyFilePath`). */
	private readonly historyStore: BrowserHistoryStore | null;

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
		this.pageControls = new PageControls(
			() => this.onChanged(),
			5000,
			(tabId) => this.registry.hiddenByOverlay(tabId),
		);
		this.cdp = options.cdp;
		this.approvals = options.approvals;
		this.ownership = options.ownership;
		this.downloads = options.downloads;
		this.log = options.log;
		this.onChanged = options.onChanged;
		// See the field's doc comment: an arrow in a class-property initialiser is
		// the one shape `vite:bytecode` cannot transform (v0.35.0 publish failure).
		this.tabAudio = new TabAudioTracker(() => this.onChanged());
		this.facts = options.facts;
		this.forgetSiteData = options.forgetSiteData;
		this.approvalsCard = options.approvalsCard;
		this.addressOverlayMode =
			options.addressOverlayMode ??
			(() => ({ mode: "suspend", reason: "unavailable" }));
		this.historyStore = options.historyFilePath
			? createBrowserHistoryStore(options.historyFilePath)
			: null;
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
		// Human find highlights can appear in native screenshots. This executes
		// under the existing tab lane AFTER ownership authorization; human find IPC
		// takes the same lane, so it cannot re-highlight during an agent capture.
		if (typeof params.tab === "string" && TAB_SCOPED.has(method)) {
			const record = this.registry.requireSurface(params.tab);
			this.pageControls.prepareAgent(record);
		}
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
		// The URL this call ENTERED on, which is the one entry authorization just
		// approved. Kept because a refused landing has to be UNDONE (review round 1,
		// M2): refusing the answer while leaving the tab on the page it reached is a
		// control that protects the model's report and not the user's browser.
		const entryUrl = record.view.webContents.getURL();
		const assertDocument = (): URL => {
			const url = new URL(record.view.webContents.getURL() || "about:blank");
			if (record.documentEpoch !== authorizedOn) {
				if (!NAVIGATING_ACTIONS.has(method)) {
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
				// A REFUSED LANDING IS PUT BACK, not merely refused (review round 1, M2).
				// `download` and `upload` are the cases this exists for: their own work is
				// not gated pre-fetch (see `NAVIGATION_ACTIONS`), so without this the page
				// the click or the form's own submit reached stays rendered in the view the
				// user is watching — cookies sent, body fetched — and the only thing that
				// refused was the model's sentence. A `click`/`type` hop is blocked by the
				// gate before it is fetched, so for those this is unreachable-except-by-race
				// and harmless; it is written once, as the rule for an action that can move
				// the tab.
				if (NAVIGATING_ACTIONS.has(method) && url.href !== entryUrl) {
					this.restoreApprovedDocument(record, entryUrl);
				}
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

	/** Put a tab back on the document a call entered on, after that call's work
	 * landed it somewhere it may not hold.
	 *
	 * The restore is a plain load of an already-authorized URL, and it is deliberately
	 * NOT awaited: the caller is on its way to a thrown refusal, and the answer the
	 * model reads is about the refusal rather than about the repaint. A view that died
	 * under the call needs no restore and must not turn into a second error. */
	private restoreApprovedDocument(record: TabRecord, url: string): void {
		if (!url || record.view.webContents.isDestroyed()) return;
		const restore = record.view.webContents.loadURL(url);
		void Promise.resolve(restore).catch((error: unknown) => {
			this.log(
				`[browser] could not restore tab ${record.tabId} to ${url} after refusing a navigation: ${String(error)}`,
			);
		});
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
			case "styles":
				return geometryActions.styles(this, params);
			case "hit_test":
				return geometryActions.hitTest(this, params);
			case "ancestors":
				return geometryActions.ancestors(this, params);
			case "query":
				return queryActions.query(this, params);
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
			case "download":
				return downloadActions.download(this, params);
			case "upload":
				return uploadActions.upload(this, params);
			case "network_start":
				return networkActions.networkStart(this, params, requestId);
			case "network_stop":
				return networkActions.networkStop(this, params, requestId);
			case "network_read":
				return networkActions.networkRead(this, params, requestId);
			case "network_clear":
				return networkActions.networkClear(this, params, requestId);
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

	/**
	 * The ids of tabs with a recorded load failure, for the session capture.
	 *
	 * A copy rather than a live view: `captureTabs` reads the set while it walks
	 * the registry, and a collection that could change underneath the walk would
	 * make "was this row marked" a race. The marks are what stop a dead tab from
	 * being restored on the next launch (`session-store.ts`, `readSession`), so
	 * the set is taken once per capture rather than consulted per row.
	 */
	failedTabIds(): ReadonlySet<number> {
		return new Set(this.loadFailures.keys());
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
		// Audio tracking is pruned against the live set on every projection:
		// the projection is the one enumeration of live tabs main already
		// makes on each change, so a closed tab's listener cannot outlive it.
		this.tabAudio.prune(
			new Set(this.registry.snapshot().map((entry) => entry.tabId)),
		);
		return {
			addressOverlay: this.addressOverlayMode(),
			approvalsCard: this.approvalsCard?.state() ?? {
				available: false,
				open: false,
			},
			pageControls: this.pageControls.state(active),
			tabs: this.chromeTabOrder
				.project(this.registry.snapshot())
				.map((entry, displayOrder) => ({
					...(this.chromeTabOrder.hasCustomOrder ? { displayOrder } : {}),
					tabId: entry.tabId,
					title: this.titleForChrome(entry.title) || "New tab",
					url: entry.url,
					owner: entry.owner,
					// WHICH CONVERSATION THIS TAB BELONGS TO, and the ONLY new field this
					// change adds to the wire. `null` is a real and common value — a restored
					// tab is nobody's (`registry.ts:231`), a user tab never handed over and
					// opened from the route or a draft is nobody's — and it means "not any
					// conversation's", which is why a conversation's scope shows it under no
					// scope but `"all"` (spec 7.2).
					//
					// A TAB HANDED BACK KEEPS ITS CONVERSATION (review round 1, Q2):
					// revocation restores `homeSessionId` rather than writing `null`, so the
					// field is "which conversation this belongs to", not "which session is
					// driving it" — the second question is `handedOver` and `owner`.
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
					// PER TAB, projected with `loading` and for the same reason: a
					// background tab making sound has no other surface. `audible`
					// gates the mute control's visibility; `muted` is its state.
					// Read from the record (guarded like `tabLoading`) because the
					// snapshot carries no webContents.
					audible: (() => {
						const record = this.registry.get(entry.tabId);
						return record && !record.view.webContents.isDestroyed()
							? this.tabAudio.stateFor(record).audible
							: false;
					})(),
					muted: (() => {
						const record = this.registry.get(entry.tabId);
						return record && !record.view.webContents.isDestroyed()
							? this.tabAudio.stateFor(record).muted
							: false;
					})(),
				})),
			activeTabId: activeRecord?.tabId ?? null,
			// The download surface's facts (§16.4): what is in flight, where it went and
			// what was refused, so the chrome row renders from the host's own state rather
			// than from a second copy the renderer would have to keep in step. Shipped in
			// the same projection as the strip for the reason the approvals list is: one
			// subscription is one thing that can go stale. FOR ONE TAB (the active one),
			// which is the round-1 D2 fix: a host-wide projection rendered a decision taken
			// in another tab into this one's chrome.
			transfers: this.downloads.activityFor(active?.tabId ?? null),
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
		await this.createUserTab(sessionId ?? null);
		return this.chromeState();
	}

	/** Human duplicates copy URL ONLY. Session attribution is not a capability,
	 * but copying it would still put an agent's duplicate inside its conversation.
	 * User records have no nonce/handover; an explicit later handover is the only
	 * way they can become agent-drivable. Failure retains that plain user tab. */
	async actOnChromeTab(
		tabId: number,
		action: HumanTabAction,
	): Promise<HumanTabActionOutcome> {
		const record = this.registry.get(tabId);
		if (!record || record.view.webContents.isDestroyed())
			return {
				status: "failed",
				action,
				tabId: null,
				error: { code: "tab_closed", message: t("ui.browser.chrome.tab_gone") },
			};
		let url = "";
		let destinationId: number | null = action === "duplicate" ? null : tabId;
		try {
			// Mute is a per-tab human control, not a page navigation: it lands
			// on the tab it names (background tabs included, which is the
			// whole point — the tab making sound is usually not the active
			// one) and never touches the URL or the presented view.
			if (action === "mute" || action === "unmute") {
				const result = this.tabAudio.setMuted(record, action === "mute");
				if (!result)
					return {
						status: "failed",
						action,
						tabId: null,
						error: {
							code: "tab_closed",
							message: t("ui.browser.chrome.tab_gone"),
						},
					};
				this.onChanged();
				return { status: "completed", action, tabId };
			}
			url = record.view.webContents.getURL();
			if (
				action === "duplicate" &&
				url !== "about:blank" &&
				!DUPLICATABLE_WEB_URL.test(url)
			)
				return {
					status: "failed",
					action,
					tabId: null,
					error: {
						code: "unsupported_page",
						message: t("ui.browser.chrome.duplicate_refused"),
					},
				};

			if (action === "reload") record.view.webContents.reload();
			else {
				// One initial load on the exact newly-created record, not a redundant
				// blank load followed by a target load. Publish its identity before any
				// await so a failed load can be reported without deleting/losing the tab.
				const copy = await this.createUserTab(null, url, (created) => {
					destinationId = created.tabId;
				});
				destinationId = copy.tabId;
			}
			this.onChanged();
			return { status: "completed", action, tabId: destinationId as number };
		} catch {
			if (destinationId !== null && action === "duplicate")
				this.recordLoadFailure(destinationId, {
					code: -2,
					description: "DUPLICATE_NAVIGATION_FAILED",
					url,
				});
			// Operational failure is data, not an uncaught ipcMain handler rejection.
			// The UI uses the established action-error/toast path; no URL/token detail
			// is interpolated into this message or a new log channel.
			return {
				status: "failed",
				action,
				tabId: destinationId,
				error: {
					code: "navigation_failed",
					message: t("ui.browser.chrome.operation_failed", { action }),
				},
			};
		}
	}

	reorderChromeTabs(ids: number[]): Record<string, unknown> {
		if (!this.chromeTabOrder.reorder(this.registry.snapshot(), ids))
			throw new Error(t("ui.browser.chrome.invalid_order"));
		this.onChanged();
		return this.chromeState();
	}

	/** `newTab`'s body, returning the record so `reopenClosed` can navigate the tab
	 * it created rather than whichever tab is active by the time the await ends. */
	private async createUserTab(
		sessionId: string | null,
		initialUrl = "about:blank",
		onCreated?: (record: TabRecord) => void,
	): Promise<TabRecord> {
		const record = this.registry.create({
			owner: "user",
			sessionId,
		});
		onCreated?.(record);
		await record.view.webContents.loadURL(initialUrl);
		await this.cdp.attach(record.view.webContents);
		this.onChanged();
		return record;
	}

	/** Main owns this short-lived UI focus fact; it conveys no page capability. */
	chordFocus = false;
	/**
	 * The tab whose native view last reported focus. Tracked from each view's own
	 * `focus`/`blur` events because `webContents.getFocusedWebContents()` can
	 * answer null while a `WebContentsView` holds focus (measured on Electron
	 * 44.3.0 in a window that is not itself activated). Like `chordFocus`, this
	 * is an input-ownership fact and carries no page capability; `ownsPage`
	 * refuses it unless the tab is the active, presented one.
	 */
	focusedPageTabId: number | null = null;
	onChordFocusChanged?: (focused: boolean) => void;
	/** An explicit tab id fences queued chrome intents: a switch between key
	 * delivery and IPC must never search/zoom the newly active tab instead. */
	async controlPage(
		tabId: number,
		action: "open" | "close" | "search" | "print" | PageZoomCommand,
		query = "",
		forward = true,
		next = false,
	): Promise<Record<string, unknown>> {
		return this.registry.lane(tabId, async () => {
			const active = this.registry.activeTab;
			if (
				!active ||
				active.tabId !== tabId ||
				(!active.presented && !this.registry.hiddenByOverlay(tabId)) ||
				active.view.webContents.isDestroyed()
			)
				throw new Error("The browser tab is no longer presented.");
			if (action === "open") this.pageControls.open(active);
			else if (action === "print") this.pageControls.print(active);
			else if (action === "close") this.pageControls.clear();
			else if (action === "search")
				this.pageControls.search(active, query, forward, next);
			else this.pageControls.zoom(active, action);
			this.onChanged();
			return this.chromeState();
		});
	}
	setChordFocus(focused: boolean): void {
		this.chordFocus = focused;
		this.onChordFocusChanged?.(focused);
	}
	/** One view gained or lost native focus. Only the id that lost it may clear
	 * the fact: a departing view's blur must not erase a successor's focus. */
	setPageFocused(tabId: number, focused: boolean): void {
		if (focused) this.focusedPageTabId = tabId;
		else if (this.focusedPageTabId === tabId) this.focusedPageTabId = null;
	}
	/** The window's own renderer gained focus (the user clicked chrome/chat). */
	clearPageFocus(): void {
		this.focusedPageTabId = null;
	}
	/** Only user URLs survive a close, never a capability, page state or nonce.
	 * Conversation attribution is retained only to find the appropriate scope. */
	private closedUserTabs: Array<{ url: string; sessionId: string | null }> = [];
	private rememberClosed(tabId: number): void {
		const record = this.registry.get(tabId);
		if (!record || record.owner !== "user" || record.handedTo !== null) return;
		const url = record.view.webContents.getURL();
		try {
			if (!permittedScheme(new URL(url))) return;
		} catch {
			return;
		}
		this.closedUserTabs.push({ url, sessionId: record.homeSessionId });
		if (this.closedUserTabs.length > 10) this.closedUserTabs.shift();
	}
	clearChordState(): void {
		this.pageControls.clear();
		this.setChordFocus(false);
		this.clearPageFocus();
		this.closedUserTabs = [];
	}
	/**
	 * Forget remembered closes. Called when the user clears browsing data or forgets
	 * a site, because a closed tab's URL can carry a one-time token or name a page
	 * the user just asked this app to erase: Cmd+Shift+T must not resurrect it
	 * (review R3). `origin` filters to one site; omitted forgets every entry. Clearing
	 * only cookies or only the cache leaves the stack alone: neither erases what the
	 * user visited, and a logged-out reopen simply lands on the site's own login.
	 */
	forgetClosedTabs(origin?: string): void {
		this.closedUserTabs = origin
			? this.closedUserTabs.filter((entry) => {
					try {
						return new URL(entry.url).origin !== origin;
					} catch {
						return false;
					}
				})
			: [];
	}
	async reopenClosed(
		sessionId: string | null,
	): Promise<Record<string, unknown>> {
		// An all-tabs surface may reopen the newest user close; a conversation
		// cannot pull another conversation's URL into its scoped strip.
		const index = this.closedUserTabs.findLastIndex(
			(entry) => sessionId === null || entry.sessionId === sessionId,
		);
		if (index < 0) return this.chromeState();
		// TAKEN BEFORE ANY AWAIT (review R4). Two quick reopens, or a close landing
		// during the awaits below, would otherwise splice by a stale index and drop
		// the wrong entry or reopen the same one twice. Once taken, the entry is the
		// caller's: a navigation that then fails leaves the tab on its failure page,
		// exactly as a typed URL would, instead of a blank tab plus an entry that
		// makes every further Cmd+Shift+T add another blank tab.
		const [entry] = this.closedUserTabs.splice(index, 1);
		const record = await this.createUserTab(sessionId ?? entry.sessionId);
		// The record this call created, never `registry.activeTab`: a tab the user
		// clicked during the await must not be the one navigated.
		await record.view.webContents.loadURL(entry.url);
		this.onChanged();
		return this.chromeState();
	}
	closeTab(tabId: number): Record<string, unknown> {
		this.rememberClosed(tabId);
		this.dropReceipt(tabId);
		this.loadFailures.delete(tabId);
		this.registry.destroy(tabId);
		this.onChanged();
		return this.chromeState();
	}

	/**
	 * Close several tabs as ONE intent (design R5): resolve it, close them, notify once.
	 *
	 * TWO MODES RATHER THAN ONE LIST, and the difference is the race the design names:
	 *
	 * - `ids` is positional — "these tabs, the ones I could see" — and main closes
	 *   exactly those, skipping any that are already gone. A tab an agent opened after the
	 *   press is not in the list and survives, which the strip then shows honestly.
	 * - `conversation` is resolved HERE, at execution time, against the live registry. A
	 *   list computed from a projection the renderer read seconds ago (the band stays open
	 *   while the user reads it) would miss a tab an agent opened in that conversation in
	 *   the meantime — and the user pressed something that said ALL.
	 *
	 * ONE `onChanged()` EITHER WAY, which is the whole point of `registry.destroyMany`: N
	 * closes are N full `chromeState()` builds, N IPC broadcasts, N renderer re-reads and
	 * N `session.json` writes.
	 */
	closeTabs(intent: CloseTabsIntent): Record<string, unknown> {
		const tabIds =
			intent.mode === "ids"
				? intent.tabIds
				: this.registry
						.list()
						.filter((record) => record.sessionId === intent.sessionId)
						.map((record) => record.tabId);
		for (const tabId of tabIds) {
			this.rememberClosed(tabId);
			// Per tab, before the batch drops them: a pending receipt and a last load
			// failure are keyed by tab id, and both are stale the moment the tab is gone.
			this.dropReceipt(tabId);
			this.loadFailures.delete(tabId);
		}
		/*
		 * NO SECOND NOTIFICATION HERE, and the removal of one is the whole claim: the
		 * registry's own `onChanged` IS this host's (`index.ts:312` passes the same
		 * function `BrowserHost` takes as `onChanged`), so `destroyMany` already sent the
		 * ONE `browser-state-changed` this intent owes the renderer. Calling it again here
		 * — which `closeTab` above does, and which is two broadcasts for one user action —
		 * measured as two events for a four-tab batch in `browser-chrome-proof.mjs`, and
		 * the count is the evidence the design's §6.4 asks for: N full `chromeState()`
		 * builds, N broadcasts and N `session.json` writes are exactly what this intent
		 * exists to replace. The state is still returned fresh, which is what the caller
		 * reads; nothing was removed means nothing changed, and nothing is sent.
		 */
		this.registry.destroyMany(tabIds);
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
	 * Start ONE restored tab's load, without waiting for it.
	 *
	 * The one spelling of "how a restored tab gets its page back", shared by
	 * `hydrateOne` (which awaits the promise under the per-tab timeout) and the
	 * budget drain at the end of the pass (which only STARTS it). `null` when the
	 * tab or its view is already gone — the user can close a tab while the pass is
	 * still running, and the drain iterates a queue collected across awaits.
	 */
	private startRestore(
		tabId: number,
		recorded: PersistedTab,
	): Promise<void> | null {
		const record = this.registry.get(tabId);
		if (!record) return null;
		const contents = record.view.webContents;
		if (contents.isDestroyed()) return null;
		const history = contents.navigationHistory;
		const entry = recorded.entries[recorded.activeIndex];
		return history?.restore
			? history.restore({
					entries: recorded.entries,
					index: recorded.activeIndex,
				})
			: // The honest degradation (see `NavigationHistoryLike`): a view with no
				// history API still gets put back on the page it was showing, without
				// its stack and its page state.
				entry
				? contents.loadURL(entry.url)
				: Promise.resolve();
	}

	/**
	 * Apply each restored tab's history and debugger session, bounded.
	 *
	 * `Promise.allSettled` rather than `Promise.all`: the two steps below already turn
	 * a failure into a log line, and a rejection here would be an unhandled rejection
	 * on a promise only a test awaits.
	 *
	 * THE BUDGET STOPS THE PASS WAITING, NEVER THE WORK (2026-09-29, RC2b). When the
	 * deadline expires the workers stop TAKING tabs, and whatever is still queued is
	 * drained below: each remaining tab's load is STARTED, unawaited, so nothing is
	 * left `about:blank` forever. Before the drain, the deadline check ran AFTER the
	 * shift and silently dropped the tab it had just taken, and every other queued
	 * tab got no load at all while the log claimed "they keep loading in the
	 * background" (the field: up to 14 blank tabs from one launch). The constants
	 * above are deliberately unchanged — one hung page must not withhold the host,
	 * so what changed is only what happens AFTER the budget, not the budget.
	 */
	private async hydrateRestored(
		created: Array<{ tabId: number; recorded: PersistedTab }>,
	): Promise<void> {
		const deadline = Date.now() + RESTORE_BUDGET_MS;
		const queue = [...created];
		let reported = false;
		const worker = async (): Promise<void> => {
			for (;;) {
				if (Date.now() >= deadline) {
					// Said once per pass, not once per worker: four copies of one line says
					// nothing the first does not, and this log is read by a support session.
					// The check runs BEFORE the shift, so the count is exactly the set the
					// drain below will start — no tab is taken and dropped on the floor.
					if (queue.length > 0 && !reported) {
						reported = true;
						this.log(
							`[browser] the ${RESTORE_BUDGET_MS}ms restore budget expired with ${queue.length} tab(s) still queued; they start loading in the background`,
						);
					}
					return;
				}
				const next = queue.shift();
				if (!next) return;
				await this.hydrateOne(next.tabId, next.recorded);
			}
		};
		await Promise.allSettled(
			Array.from(
				{ length: Math.min(RESTORE_CONCURRENCY, created.length) },
				worker,
			),
		);
		// THE DRAIN. Every load the budget left queued gets STARTED here and none of
		// it is awaited: a straggler loads or fails visibly (a refusal reaches the
		// ordinary `did-fail-load` wiring) instead of sitting blank, and a failure to
		// even start is a log line rather than an unhandled rejection.
		//
		// THE BOUNDED WAIT IS PART OF THE DRAIN (round-1: m-1 = Q-1 = U1 = D3). It
		// used to start the load and never look at it again, so a drained server that
		// accepts and never answers spun forever OUTSIDE `Close N failed tabs` - one
		// launch left a spinner tail only later launches would clear. The same step
		// the awaited wave runs (`restoreUnderTimeout`) is started here unawaited, so
		// a drained quiet death earns the same Failed mark within
		// `RESTORE_TAB_TIMEOUT_MS` of its start: one launch, one honest close set.
		for (const next of queue) {
			void this.restoreUnderTimeout(next.tabId, next.recorded).catch(
				(error: unknown) => {
					this.log(
						`[browser] could not start the restore of tab ${next.tabId}: ${String(error)}`,
					);
				},
			);
		}
	}

	/**
	 * The bounded half of ONE restore: start the load, wait
	 * `RESTORE_TAB_TIMEOUT_MS`, and record a no-commit death as a load failure.
	 *
	 * Shared by the awaited first wave (`hydrateOne`) and the post-budget drain,
	 * because the failure mode does not care whether anyone awaits it: a server
	 * that accepts and never answers produces no `did-fail-load` and no commit,
	 * so THIS timer is the only thing that can turn it into the strip's Failed
	 * chip and the counted close. The drain ran a private half of this step until
	 * round 1 (m-1 = Q-1 = U1 = D3), which is how stragglers spun outside the
	 * close set.
	 *
	 * WHETHER THIS HYDRATION'S NAVIGATION COMMITTED A DOCUMENT, read from the
	 * event rather than from a property, because neither of the two obvious
	 * reads answers the question: `getURL()` already reports the TARGET url
	 * while the restore is still pending, and `history.restore()`'s promise does
	 * not settle until the load FINISHES, so it is still pending for a page that
	 * committed seconds ago (both measured on Electron 44, 2026-09-29).
	 * `did-navigate` is the commit, and it is what tells "the page came back but
	 * is still fetching something" apart from "nothing ever arrived" — only the
	 * second one is a failure to record (see the catch below).
	 */
	private async restoreUnderTimeout(
		tabId: number,
		recorded: PersistedTab,
	): Promise<void> {
		const record = this.registry.get(tabId);
		if (!record) return;
		const contents = record.view.webContents;
		let committed = false;
		const onCommitted = (): void => {
			committed = true;
		};
		contents.on("did-navigate", onCommitted);
		try {
			const started = this.startRestore(tabId, recorded);
			if (started) await withTimeout(started, RESTORE_TAB_TIMEOUT_MS);
		} catch (error) {
			this.log(`[browser] could not restore tab ${tabId}: ${String(error)}`);
			// THE QUIET DEATH (2026-09-29, RC2a): a hydration that never committed a
			// page is the failure mode the view's own `did-fail-load` can NEVER report —
			// a server that accepts the connection and never answers times out here
			// with no network error at all — so it is recorded as a load failure rather
			// than left as a blank tab the user cannot see, cannot close in bulk, and
			// never stops being restored. The mark draws the strip's Failed chip and
			// feeds the counted close; `failedTabIds` writes `lastLoadFailed` on the
			// next capture, and `readSession` then skips the row. A page that DOES
			// eventually commit past the timeout clears the mark through the ordinary
			// wiring (`did-start-loading`/`did-navigate` call `clearLoadFailure`,
			// `browser/index.ts`), so the panel is never a verdict on a tab that came
			// back.
			//
			// IT DOES NOT OVERWRITE A REFUSAL ALREADY ON RECORD: when the view's own
			// `did-fail-load` fired for this navigation it recorded the SPECIFIC code
			// (`ERR_CONNECTION_REFUSED` and friends) whose description the panel maps
			// to a sentence the user can act on, and this fallback exists only for the
			// failures that path cannot see.
			//
			// AN ABORT IS EXEMPTED HERE TOO. The earlier reading — that a
			// supersede always commits before this catch runs, so the commit
			// guard covers it — was too strong: on Electron 44.3.0 a restore
			// superseded mid-flight rejects `ERR_ABORTED (-3)` at 928ms while
			// the superseding page's `did-navigate` did not arrive until 4960ms
			// (and fast runs showed 611ms vs 678ms). If that superseding load is
			// then stopped, no `did-navigate` ever arrives, so a mark written here
			// would survive and `lastLoadFailed` would skip the tab next launch.
			// The rejection is the ordinary supersede, not a restore failure; the
			// timeout and a deliberate Stop still carry different text and mark.
			if (
				!committed &&
				!isSupersededRestore(error) &&
				!this.loadFailures.has(tabId) &&
				this.registry.get(tabId) &&
				!contents.isDestroyed()
			) {
				const entry = recorded.entries[recorded.activeIndex];
				// `ERR_FAILED` is Chromium's generic refusal and the parenthetical is
				// the part a bug report needs: the panel shows the description verbatim
				// in machine voice (`browser-load-failure.tsx`), and its sentence for
				// this key is the timeout's (the dominant cause here).
				this.recordLoadFailure(tabId, {
					code: -2,
					description: "ERR_FAILED (restore)",
					url: entry?.url ?? contents.getURL(),
				});
				this.log(
					`[browser] tab ${tabId} is marked as failed: the restore did not commit a page`,
				);
			}
		} finally {
			if (!contents.isDestroyed()) {
				contents.removeListener("did-navigate", onCommitted);
			}
		}
	}

	/** One tab's half of the pass: the history stack, then the debugger session. */
	private async hydrateOne(
		tabId: number,
		recorded: PersistedTab,
	): Promise<void> {
		// The user can close a restored tab while its page is still loading, and the
		// `destroyed` path may already have taken it: a hydration step that ran anyway
		// would drive a released `webContents`.
		const record = this.registry.get(tabId);
		if (!record) return;
		const contents = record.view.webContents;
		await this.restoreUnderTimeout(tabId, recorded);
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
	 * Local address suggestions for the field the user is editing.
	 *
	 * THE EXPECTED TAB IS A GUARD, not a hint: a response about tab A rendered
	 * over tab B is how a stale completion navigates a tab the user is no longer
	 * looking at. Main answers the read only when the request still names the
	 * active tab; the renderer separately discards responses whose `activeTabId`
	 * no longer matches, which covers the race between this check and the reply
	 * landing.
	 *
	 * RANKING MOVED HERE with the persistent store: the renderer used to rank a
	 * snapshot of every stack, which cannot scale to a 5000-entry history either
	 * in memory or across IPC. Main now asks the store for its top matches, puts
	 * them ahead of the live-tab rows (`mergeAddressHistory`), and bounds the
	 * answer by `request.limit`. The renderer still derives display text, the
	 * target URL and the inline suffix, because those depend on exactly what the
	 * user typed.
	 */
	addressHistory(request: AddressHistoryRequest): AddressHistoryResponse {
		const activeTabId = this.registry.activeTab?.tabId ?? null;
		if (activeTabId !== request.expectedTabId) {
			throw new BrowserHostError(
				"nav_failed",
				"the active tab changed before suggestions were read",
			);
		}
		const live = collectAddressHistory(
			this.registry.list().map((record) => ({
				tabId: record.tabId,
				sessionId: record.sessionId,
				webContents: record.view.webContents,
				restoreRow: record.restoreRow ?? null,
			})),
			activeTabId,
		);
		const historyMatches =
			this.historyStore?.suggest(request.query, request.limit) ?? [];
		return {
			requestId: request.requestId,
			activeTabId: live.activeTabId,
			entries: mergeAddressHistory(
				live.entries,
				historyMatches,
				request.query,
				request.limit,
			),
		};
	}

	/**
	 * Record one committed top-level navigation.
	 *
	 * Called from the per-view wiring in `index.ts`, which is the only place that
	 * sees the event for every tab. A non-HTTP(S) URL is dropped by the store, so
	 * `about:blank`, `chrome://` and a refused scheme never enter the document.
	 * The title is filled in by `recordHistoryTitle` when Chromium announces it;
	 * recording the visit first is deliberate, because the commit is the fact and
	 * the title is a later, optional update.
	 */
	recordHistoryVisit(url: string): void {
		this.historyStore?.record(url, "");
	}

	/** Update the stored title for a URL that is already in the history. Never
	 * increments a visit: `page-title-updated` fires for a page that has already
	 * been counted, sometimes several times. */
	recordHistoryTitle(url: string, title: string): void {
		this.historyStore?.updateTitle(url, title);
	}

	/** Write any debounced history change now (quit, and the host's own stop). */
	flushHistory(): void {
		this.historyStore?.flush();
	}

	/** "Clear everything" also forgets the suggestion history (`profile.ts` is
	 * the path that calls this, so cookies/cache alone cannot reach it). */
	clearHistory(): void {
		this.historyStore?.clear();
	}

	/** "Forget this site" drops that origin's rows; other origins stay. */
	clearOriginHistory(origin: string): void {
		this.historyStore?.clearOrigin(origin);
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
	async navigateActive(
		rawUrl: string,
		expectedTabId?: number,
	): Promise<Record<string, unknown>> {
		const record = this.registry.activeTab;
		if (!record)
			throw new BrowserHostError("tab_closed", "no browser tab is open");
		// ADDITIVE AND OPTIONAL: the URL bar always supplies the tab its draft belongs
		// to, so a commit that raced a tab switch is refused instead of loading the
		// new active tab with the old tab's address. Agent/legacy callers omit it.
		if (expectedTabId !== undefined && record.tabId !== expectedTabId) {
			throw new BrowserHostError(
				"nav_failed",
				"the active tab changed before the address was submitted",
			);
		}
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

	/**
	 * Home (LOH-13 slice A): return the ACTIVE tab to the browser's start
	 * state. The start state is `about:blank` — what `createUserTab` opens a
	 * new tab on and what the URL bar renders as an empty bar — so Home is a
	 * load of that one allowed `about:` URL, not a navigation to an origin.
	 * It deliberately bypasses `navigateActive`'s http(s)-only rule: that rule
	 * guards typed/agent-reachable origins, and `about:blank` reaches no
	 * origin at all (the same exception `refusesNavigation` makes in
	 * `index.ts`). No consent is involved, for the same reason a typed URL
	 * needs none: this is the user's own press.
	 */
	async goHomeActive(): Promise<Record<string, unknown>> {
		const record = this.registry.activeTab;
		if (!record)
			throw new BrowserHostError("tab_closed", "no browser tab is open");
		await record.view.webContents.loadURL("about:blank");
		this.onChanged();
		return this.chromeState();
	}

	/**
	 * Open a link the user right-clicked in a NEW user tab (LOH-13 slice A,
	 * page context menu). Human-only by construction: it is reached from the
	 * native context menu in `index.ts`, never from IPC or the agent RPC, and
	 * the tab it creates is a plain user tab (no nonce, no handover), so an
	 * agent still cannot drive it without an explicit hand-over. The scheme
	 * rule is the typed-navigation rule (`permittedScheme`): only http(s)
	 * links open, so a `file:`/`javascript:` link cannot ride this path onto
	 * the local filesystem.
	 */
	async openLinkInNewTab(rawUrl: string): Promise<Record<string, unknown>> {
		let url: URL;
		try {
			url = new URL(rawUrl);
		} catch {
			throw new BrowserHostError("nav_failed", "that is not a URL");
		}
		if (!permittedScheme(url)) {
			throw new BrowserHostError(
				"nav_failed",
				"only http:// and https:// can be opened",
			);
		}
		await this.createUserTab(null, url.href);
		return this.chromeState();
	}

	reloadActive(hard = false): Record<string, unknown> {
		const contents = this.registry.activeTab?.view.webContents;
		// Falls back to a plain reload rather than doing nothing: a hard reload that
		// silently vanishes is worse than one that keeps the cache (review R10).
		if (hard && contents?.reloadIgnoringCache) contents.reloadIgnoringCache();
		else contents?.reload();
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
		// A hidden surface is no longer the accelerator's owner; a view can keep a
		// stale focus fact while it is not presented.
		if (rect === null) this.clearPageFocus();
		return this.chromeState();
	}

	/** Full-window overlays hide the view: a native view paints above all DOM, so
	 * an overlay is invisible unless the view goes away (design 11.3).
	 *
	 * `ownPage` is the RENDERER'S REASON for the hide, and the only fact that lets
	 * main tell the browser's own state pages (start page, load failure - hidden so
	 * their DOM can paint) from an overlay covering them. Shortcut ownership keys
	 * on it; presentation does not. See `TabRegistry.chromeVisible`. */
	setViewVisible(
		visible: boolean,
		ownPage = false,
		ownStatePage = ownPage,
	): Record<string, unknown> {
		this.registry.setViewVisible(visible, ownPage, ownStatePage);
		// Suppressed by an overlay: the page must not keep the native key owner.
		// True for a state page too - there is no presented page either way.
		if (!visible) this.clearPageFocus();
		return this.chromeState();
	}

	/** Hand a user tab to a session, minting the capability. The RENDERER never
	 * sees the nonce: it travels to the session through `tabs`, which is what keeps
	 * this the one authority transfer rather than an exposure (design 6.3, 11.7). */
	handOver(tabId: number, sessionId: string): Record<string, unknown> {
		const record = this.registry.get(tabId);
		if (record) this.pageControls.prepareAgent(record);
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

	/**
	 * Open the native approvals card from the shield (S6b).
	 *
	 * The renderer passes the locale and direction it resolved: main has no
	 * catalogue, and the card is a second document whose `lang`/`dir` must follow
	 * the app rather than the device tag (UX U2). The theme is the evidence
	 * palette today; S6b's product path keeps the dark default it was reviewed in.
	 */
	openApprovalsCard(input: unknown): Record<string, unknown> {
		const request =
			input && typeof input === "object"
				? (input as Record<string, unknown>)
				: {};
		const locale =
			typeof request.locale === "string" ? request.locale : undefined;
		const dir =
			request.dir === "rtl" || request.dir === "ltr" ? request.dir : undefined;
		const theme =
			request.theme === "light" || request.theme === "dark"
				? request.theme
				: undefined;
		const palette =
			request.palette === null
				? null
				: typeof request.palette === "string"
					? request.palette
					: undefined;
		this.approvalsCard?.open({ locale, dir, theme, palette });
		// The renderer discards the returned projection for the shield toggle
		// (M2); the push is what makes aria-expanded and the button's selected
		// style follow main. `onChanged` also re-renders a route that mounted
		// after the card opened (U1).
		this.onChanged();
		return { ...this.chromeState() };
	}

	/** Close the native card without deciding (shield's second click / Escape). */
	closeApprovalsCard(): Record<string, unknown> {
		this.approvalsCard?.close();
		this.onChanged();
		return { ...this.chromeState() };
	}

	/** The renderer's resolved locale/theme, pushed on mount and on change (U5). */
	setApprovalsCardContext(input: unknown): void {
		const request =
			input && typeof input === "object"
				? (input as Record<string, unknown>)
				: {};
		const labels =
			request.requesterLabels &&
			typeof request.requesterLabels === "object" &&
			!Array.isArray(request.requesterLabels)
				? (request.requesterLabels as Record<string, string>)
				: undefined;
		this.approvalsCard?.setContext({
			locale: typeof request.locale === "string" ? request.locale : undefined,
			dir:
				request.dir === "rtl" || request.dir === "ltr"
					? request.dir
					: undefined,
			theme:
				request.theme === "light" || request.theme === "dark"
					? request.theme
					: undefined,
			...(request.palette === null
				? { palette: null }
				: typeof request.palette === "string"
					? { palette: request.palette }
					: {}),
			...(labels ? { requesterLabels: labels } : {}),
		});
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
		this.forgetClosedTabs(origin);
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
